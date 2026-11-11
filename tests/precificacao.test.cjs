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
  vm.runInContext(engine + '\nreturn { LOJA_NOMES, BASE_COLUNAS, chave, brNum, dataHoje, dataIso, eanValido, codigoBarras, nomeEtiqueta, lerBaseCsv, paraMapa, lojasDaBase, baseParaCsv, lerPlanilhaMatriz, lojaPeloNome, detectarLoja, conciliar, atualizarBase, filtrar, contar }; };', context);
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
