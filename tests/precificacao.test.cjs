const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

// Carrega só a parte de regras da ferramenta (antes da INTERFACE), sem tela.
function loadEngine(){
  const context = vm.createContext({ window: {}, console });
  const source = fs.readFileSync(path.join(root, 'ferramentas/precificacao/precificacao.js'), 'utf8');
  const engine = source.slice(0, source.indexOf('/* ======================== INTERFACE'));
  vm.runInContext(engine + '\nreturn { LOJA_NOMES, BASE_COLUNAS, chave, brNum, dataHoje, dataIso, eanValido, codigoBarras, nomeEtiqueta, lerBaseCsv, paraMapa, lojasDaBase, baseParaCsv, lerPlanilhaMatriz, lojaPeloNome, detectarLoja, conciliar, atualizarBase, filtrar, contar, criarEtiquetaManual, paginar, PAPEIS, acharDatas, dataNaPlanilha, dataDoArquivo, dataDasEtiquetas }; };', context);
  return context.window.__tool_init_precificacao();
}
module.exports = { loadEngine };

const e = loadEngine();
const CAB = ['Código', 'Cód. Barras', 'Descrição', 'Fabricante', 'Classificação', 'Grupo de Preço', 'Ctr Preço', 'Ctr Lista', 'ABC', 'Est. Disp.', 'Prc. Venda'];
const linha = (cod, ean, desc, classe, est, preco) => [cod, ean, desc, 'FAB', classe, 'G', 'C', 'P', 'ZZ', est, preco];

// Base com duas lojas e 60 produtos cada, estoques diferentes por loja (para a detecção funcionar).
function baseExemplo(){
  const recs = [];
  for(const loja of [1, 7]){
    for(let i = 1; i <= 60; i++){
      recs.push({ loja, codigo: String(i), ean: '78900000' + String(i).padStart(5, '0'), descricao: 'PRODUTO ' + i, classificacao: i % 2 ? 'PERFUMARIA' : 'GENERICO', estoque: loja === 1 ? i : 100 + i, venda: 10 + i });
    }
  }
  return e.paraMapa(recs);
}
function planilhaDaLoja(base, loja, mudar = {}){
  const linhas = [CAB];
  base.forEach(r => { if(r.loja === loja) linhas.push(linha(r.codigo, r.ean, r.descricao, r.classificacao, r.estoque, mudar[r.codigo] ?? r.venda)); });
  return linhas;
}

test('números no formato do Infarma e do Excel', () => {
  assert.equal(e.brNum('22.99'), 22.99);
  assert.equal(e.brNum('7,49'), 7.49);
  assert.equal(e.brNum('1.299,90'), 1299.9);
  assert.equal(e.brNum(12), 12);
  assert.ok(Number.isNaN(e.brNum('abc')));
});

test('planilha de Produtos é lida pelas colunas do Infarma', () => {
  const recs = e.lerPlanilhaMatriz([
    CAB,
    linha('26069', '7899547544541', '*ANLODIPINO 5 30CP PRA', 'ESPECIAIS', 1, 7.99),
    linha('22855', 300651481198, 'SYSTANE 10ML', 'PERFUMARIA', '3', '106,21'),
    linha('', '', '', '', '', '')
  ]);
  assert.equal(recs.length, 2);
  assert.deepEqual({ ...recs[0] }, { codigo: '26069', ean: '7899547544541', descricao: '*ANLODIPINO 5 30CP PRA', classificacao: 'ESPECIAIS', estoque: 1, venda: 7.99 });
  assert.equal(recs[1].ean, '300651481198');
  assert.equal(recs[1].venda, 106.21);
  assert.throws(() => e.lerPlanilhaMatriz([['Nome', 'Valor']]), /Código.*Prc\. Venda/);
});

test('base salva e lida de novo sem perder nada (EAN com zero à esquerda incluso)', () => {
  const base = e.paraMapa([
    { loja: 1, codigo: '40', ean: '07896007551019', descricao: 'ABS; INTIMUS', classificacao: 'PERFUMARIA', estoque: 3, venda: 5.99 },
    { loja: 7, codigo: '300', ean: '7891024132128', descricao: 'CRM DENT', classificacao: 'PERFUMARIA', estoque: 0, venda: 8.99 }
  ]);
  const csv = e.baseParaCsv(base, '10/11/2026');
  assert.equal(csv.split('\n')[0], e.BASE_COLUNAS.join(';'));
  const lida = e.lerBaseCsv('﻿' + csv);
  assert.equal(lida.data, '10/11/2026');
  assert.equal(lida.recs.length, 2);
  assert.equal(lida.recs[0].ean, '07896007551019');
  assert.equal(lida.recs[0].descricao, 'ABS, INTIMUS');
  assert.equal(lida.recs[1].venda, 8.99);
  assert.throws(() => e.lerBaseCsv('loja;codigo;descricao;venda\n1;7891;X;9,99'), /colunas loja, codigo, ean e venda/);
});

test('detecta a loja pelo estoque, mesmo com o nome do arquivo errado', () => {
  const base = baseExemplo();
  const recs = e.lerPlanilhaMatriz(planilhaDaLoja(base, 7));
  const det = e.detectarLoja(recs, base);
  assert.equal(det.loja, 7);
  assert.equal(det.p, 1);
  assert.equal(e.lojaPeloNome('loja 4.xls'), 4);
  assert.equal(e.lojaPeloNome('LOJA07.xls'), 7);
  assert.equal(e.lojaPeloNome('produtos.xls'), null);
  assert.equal(e.detectarLoja(recs.slice(0, 10), base), null, 'poucos produtos não bastam para detectar');
});

test('conciliação separa baixou, subiu, novo e igual por loja', () => {
  const base = baseExemplo();
  const matriz = planilhaDaLoja(base, 1, { 1: 9.5, 2: 15 });
  matriz.push(linha('999', '7891000000999', 'NOVO PRODUTO', 'PERFUMARIA', 2, 4.99));
  const recs = e.lerPlanilhaMatriz(matriz);
  const { linhas, avisos } = e.conciliar([{ nome: 'loja 1.xls', loja: 1, recs }], base);
  const c = e.contar(linhas);
  assert.deepEqual({ ...c }, { down: 1, up: 1, new: 1, eq: 58 });
  const baixou = linhas.find(r => r.tipo === 'down');
  assert.equal(baixou.codigo, '1'); assert.equal(baixou.de, 11); assert.equal(baixou.por, 9.5);
  assert.equal(linhas.find(r => r.tipo === 'new').de, null);
  assert.match(avisos.join(' '), /Sem planilha hoje para: LOJA 7 MEG 4/);
});

test('arquivo sem loja fica de fora e dois arquivos na mesma loja geram aviso', () => {
  const base = baseExemplo();
  const recs = e.lerPlanilhaMatriz(planilhaDaLoja(base, 1));
  const r1 = e.conciliar([{ nome: 'x.xls', loja: null, recs }], base);
  assert.equal(r1.linhas.length, 0);
  assert.match(r1.avisos[0], /Escolha a loja do arquivo/);
  const r2 = e.conciliar([{ nome: 'a.xls', loja: 1, recs }, { nome: 'b.xls', loja: 1, recs }], base);
  assert.match(r2.avisos.join(' '), /Dois arquivos foram marcados como/);
});

test('filtros: tipo, classificação, estoque, preço mínimo, busca e loja', () => {
  const base = baseExemplo();
  const recs = e.lerPlanilhaMatriz(planilhaDaLoja(base, 1, { 1: 9.5, 2: 15, 3: 0.5 }));
  const { linhas } = e.conciliar([{ nome: 'l1', loja: 1, recs }, { nome: 'l7', loja: 7, recs: e.lerPlanilhaMatriz(planilhaDaLoja(base, 7)) }], base);
  const f = (o) => e.filtrar(linhas, { loja: 'todas', tipo: 'changed', classe: '', soEstoque: true, minimo: 1, busca: '', ...o });
  assert.equal(f().length, 2, 'o preço de 0,50 é ignorado pelo mínimo de R$ 1');
  assert.equal(f({ minimo: 0 }).length, 3);
  assert.equal(f({ classe: 'PERFUMARIA' }).length, 1);
  assert.equal(f({ tipo: 'down' })[0].codigo, '1');
  assert.equal(f({ tipo: 'all', loja: 7 }).length, 60);
  assert.equal(f({ tipo: 'all', busca: 'produto 12' }).length, 2);
});

test('base atualizada guarda o preço de hoje e zera o estoque do que sumiu', () => {
  const base = baseExemplo();
  const matriz = planilhaDaLoja(base, 1, { 1: 9.5 }).filter(r => r[0] !== '60');
  const recs = e.lerPlanilhaMatriz(matriz);
  const nova = e.atualizarBase(base, [{ nome: 'l1', loja: 1, recs }]);
  assert.equal(nova.get(e.chave(1, '1')).venda, 9.5);
  assert.equal(nova.get(e.chave(1, '60')).estoque, 0);
  assert.equal(nova.get(e.chave(1, '60')).venda, 70, 'mantém o último preço conhecido');
  assert.equal(nova.get(e.chave(7, '1')).venda, 11, 'outras lojas não mudam');
  assert.equal(base.get(e.chave(1, '1')).venda, 11, 'a base original não é alterada');
  const amanha = e.conciliar([{ nome: 'l1', loja: 1, recs }], nova);
  assert.equal(e.contar(amanha.linhas).down, 0, 'no dia seguinte a mesma alteração não aparece de novo');
});

test('etiqueta: nome limpo, código de barras e datas', () => {
  assert.equal(e.nomeEtiqueta('*OMEPRAZOL 20 56CP CIM ( P )'), 'OMEPRAZOL 20 56CP CIM');
  assert.ok(e.eanValido('7896007540600'));
  assert.ok(!e.eanValido('7896007540601'));
  assert.equal(e.codigoBarras('07896007551019'), '7896007551019');
  assert.equal(e.codigoBarras('0000000001555'), '');
  assert.equal(e.codigoBarras('123'), '');
  assert.equal(e.dataIso('10/11/2026'), '2026-11-10');
  assert.equal(e.dataHoje(new Date(2026, 10, 9)), '09/11/2026');
  assert.equal(e.LOJA_NOMES[7], 'LOJA 7 MEG 4');
});

test('etiqueta manual: valida os campos e só aceita preço anterior maior que o atual', () => {
  const ok = e.criarEtiquetaManual({ codigo: ' 24638 ', descricao: 'cetoconazol shp 100ml', ean: '7897-848500969', por: '19,99', de: 'R$ 27,99', loja: '6', quantidade: '3' });
  assert.equal(ok.erro, undefined);
  assert.equal(ok.etiqueta.descricao, 'CETOCONAZOL SHP 100ML');
  assert.equal(ok.etiqueta.codigo, '24638');
  assert.equal(ok.etiqueta.ean, '7897848500969');
  assert.equal(ok.etiqueta.de, 27.99);
  assert.equal(ok.etiqueta.por, 19.99);
  assert.equal(ok.etiqueta.tipo, 'down');
  assert.equal(ok.etiqueta.loja, 6);
  assert.equal(ok.etiqueta.quantidade, 3);
  const simples = e.criarEtiquetaManual({ descricao: 'Shampoo', por: '12.5', de: '' });
  assert.equal(simples.etiqueta.tipo, 'eq');
  assert.equal(simples.etiqueta.de, null);
  assert.equal(simples.etiqueta.quantidade, 1);
  assert.match(e.criarEtiquetaManual({ descricao: '', por: '10' }).erro, /descrição/);
  assert.match(e.criarEtiquetaManual({ descricao: 'X', por: '0' }).erro, /preço/);
  assert.match(e.criarEtiquetaManual({ descricao: 'X', por: '10', de: '9,99' }).erro, /maior que o preço atual/);
  assert.match(e.criarEtiquetaManual({ descricao: 'X', por: '10', de: 'abc' }).erro, /não é um valor válido/);
  assert.equal(e.criarEtiquetaManual({ descricao: 'X', por: '10', quantidade: 999 }).etiqueta.quantidade, 200);
});

const itens = (n, p = '') => Array.from({ length: n }, (_, i) => p + i);
// Os arrays nascem dentro do vm (outro realm); a cópia deixa o deepEqual comparar só os valores.
const simples = v => JSON.parse(JSON.stringify(v));
const porFolha = pag => simples(pag.folhas.map(f => f.blocos.reduce((t, b) => t + b.itens.length, 0)));

test('folhas: quantas etiquetas cabem em cada tamanho de papel', () => {
  const um = (lw, lh, papel) => e.paginar([{ titulo: 'LOJA 1', itens: itens(1) }], lw, lh, papel);
  assert.equal(um(63.5, 32, 'a4').colunas, 3);
  assert.equal(um(63.5, 32, 'a4').porFolha, 24, 'média: 3 × 8');
  assert.equal(um(47, 30, 'a4').porFolha, 32, 'pequena: 4 × 8 (a 9ª linha não cabe no A4)');
  assert.equal(um(95, 32, 'a4').porFolha, 16, 'grande: 2 × 8');
  assert.equal(um(72, 32, 'termica').colunas, 1);
  assert.equal(um(72, 32, 'termica').porFolha, 8);
  const p = um(63.5, 32, 'a4');
  assert.equal(p.largura, 198, 'A4 menos 6 mm de margem de cada lado');
  assert.ok(p.altura < 297 - 12, 'a folha fica um pouco menor que a área útil, para não sobrar folha em branco');
});

test('folhas: total de folhas e a loja que continua na folha seguinte', () => {
  const pag = e.paginar([{ titulo: 'LOJA 1', itens: itens(675) }], 63.5, 32, 'a4');
  assert.equal(pag.folhas.length, 29, '675 etiquetas ÷ 24 por folha');
  assert.deepEqual(porFolha(pag).slice(0, 2), [24, 24]);
  assert.equal(porFolha(pag)[28], 675 - 28 * 24);
  assert.equal(pag.folhas[0].blocos[0].continua, false);
  assert.equal(pag.folhas[1].blocos[0].continua, true, 'o nome da loja se repete na folha seguinte');
  assert.equal(pag.folhas[1].blocos[0].total, 675);
  assert.deepEqual(simples(pag.folhas.flatMap(f => f.blocos.flatMap(b => b.itens))), itens(675), 'nenhuma etiqueta some nem troca de ordem');
  assert.equal(e.paginar([], 63.5, 32, 'a4').folhas.length, 0);
});

test('folhas: a loja seguinte só começa na mesma folha se couber pelo menos uma linha', () => {
  const junta = e.paginar([{ titulo: 'A', itens: itens(3, 'a') }, { titulo: 'B', itens: itens(20, 'b') }], 63.5, 32, 'a4');
  assert.equal(junta.folhas.length, 2);
  assert.deepEqual(simples(junta.folhas[0].blocos.map(b => [b.titulo, b.itens.length])), [['A', 3], ['B', 18]], 'perde uma linha para o nome da loja B');
  assert.deepEqual(simples(junta.folhas[1].blocos.map(b => [b.titulo, b.itens.length, b.continua])), [['B', 2, true]]);
  const separa = e.paginar([{ titulo: 'A', itens: itens(21, 'a') }, { titulo: 'B', itens: itens(3, 'b') }], 63.5, 32, 'a4');
  assert.deepEqual(simples(separa.folhas.map(f => f.blocos.map(b => b.titulo))), [['A'], ['B']], 'com 7 linhas de A não cabe o nome de B e mais uma linha');
});

test('data: reconhece datas em vários formatos e ignora datas impossíveis', () => {
  assert.deepEqual(simples(e.acharDatas('Emitido em 24/11/2026 10:35')), ['24/11/2026']);
  assert.deepEqual(simples(e.acharDatas('loja 1 5-11-2026.xls')), ['05/11/2026']);
  assert.deepEqual(simples(e.acharDatas('LOJA1_2026-11-24.xlsx')), ['24/11/2026']);
  assert.deepEqual(simples(e.acharDatas('loja 1.xls')), []);
  assert.deepEqual(simples(e.acharDatas('31/02/2026 e 7891000315507')), [], 'dia que não existe e código de barras não viram data');
});

test('data: escrita na planilha, depois nome do arquivo, depois dia em que foi salva', () => {
  const matriz = [['Relatório de Produtos', 'Data: 24/11/2026'], CAB, linha('1', '', 'X', 'P', 1, 9.99), linha('2', '', 'VALIDADE 01/01/2030', 'P', 1, 9.99)];
  assert.equal(e.dataNaPlanilha(matriz), '24/11/2026', 'só olha acima das colunas, não nos produtos');
  assert.equal(e.dataNaPlanilha([CAB, linha('1', '', 'X 01/01/2030', 'P', 1, 9.99)]), '');
  const salvo = new Date(2026, 10, 23, 8, 15).getTime();
  assert.equal(e.dataDoArquivo({ dentro: '24/11/2026', nome: 'loja 25-11-2026.xls', salvo }).data, '24/11/2026');
  assert.equal(e.dataDoArquivo({ dentro: '', nome: 'loja 25-11-2026.xls', salvo }).origem, 'pela data no nome do arquivo');
  const pelaGravacao = e.dataDoArquivo({ dentro: '', nome: 'loja 1.xls', salvo });
  assert.equal(pelaGravacao.data, '23/11/2026');
  assert.match(pelaGravacao.origem, /salva/);
  assert.equal(e.dataDoArquivo({ dentro: '', nome: 'loja 1.xls' }), null);
});

test('data das etiquetas: hoje sem planilha; a das planilhas quando houver; aviso se forem de dias diferentes', () => {
  const arq = (nome, data, extra = {}) => ({ nome, loja: 1, recs: [1], data: { data, origem: 'pelo dia em que a planilha foi salva' }, ...extra });
  assert.deepEqual({ ...e.dataDasEtiquetas([], '27/11/2026') }, { data: '27/11/2026', origem: 'data de hoje', aviso: '' });
  const ontem = e.dataDasEtiquetas([arq('l1.xls', '26/11/2026'), arq('l2.xls', '26/11/2026')], '27/11/2026');
  assert.equal(ontem.data, '26/11/2026', 'planilhas de ontem imprimem a data de ontem');
  assert.equal(ontem.aviso, '');
  const misturado = e.dataDasEtiquetas([arq('l1.xls', '26/11/2026'), arq('l2.xls', '20/11/2026')], '27/11/2026');
  assert.equal(misturado.data, '26/11/2026', 'usa a mais recente');
  assert.match(misturado.aviso, /dias diferentes.*l2\.xls.*20\/11\/2026/);
  const ignorados = e.dataDasEtiquetas([arq('erro.xls', '01/01/2026', { erro: 'x' }), arq('sem-loja.xls', '02/01/2026', { loja: null })], '27/11/2026');
  assert.equal(ignorados.data, '27/11/2026', 'arquivo com erro ou sem loja não conta');
});
