const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { lerLinhasPdf, lerMatrizXls, lerAbasXlsx } = require('./ler-arquivos-exemplo.cjs');
const root = path.resolve(__dirname, '..');

// Motor da conciliação (cartão e PIX) carregado do mesmo arquivo usado pela tela.
function loadEngine(){
  const context = vm.createContext({ window: {}, pdfjsLib: { GlobalWorkerOptions: {} }, console });
  const shared = fs.readFileSync(path.join(root, 'js/shared.js'), 'utf8');
  vm.runInContext(shared.slice(shared.indexOf('function fmtBRL')), context);
  const source = fs.readFileSync(path.join(root, 'ferramentas/conciliacao/conciliacao.js'), 'utf8');
  vm.runInContext(source.slice(0, source.indexOf('var dropzone =')) + '\nreturn { isRelacaoPix, parseRelacaoPix, parseExtratoPix, conciliarPix, planilhasPix, pixLadoALado, PIX_STATUS, storeName }; };', context);
  return context.window.__tool_init_conciliacao();
}
const engine = loadEngine();
const S = engine.PIX_STATUS;
const plain = value => JSON.parse(JSON.stringify(value));

/* ------------------------------------------------------------------ dados inventados */
const cabecalho = ['FARMÁCIA TESTE Pagina : 0001', 'Relação de Vendas por Período Emissao: 06/11/2026', '** Período: 05/11/26 a 05/11/26 ** Forma Pagto.: CARTEIRA DIGITAL - <Todas>'];
const venda = (registro, sit, hora, valor) => `${registro} ${sit} ${Number(registro) + 1000} 05/11/2026 ${hora} 1/ 1 50 0,0% Cart. Dig ${valor}`;
const extrato = (conta, lancamentos) => [
  ['Associado:', 'EMPRESA TESTE'], ['Conta:', conta], ['Dados referentes ao período de 05/11/2026 a 06/11/2026.'], [],
  ['Data', 'Descrição', 'Documento', 'Valor (R$)', 'Saldo (R$)'], ['', 'Saldo Anterior', '', '', 100],
  ...lancamentos.map(([data, pagador, valor]) => [data, 'RECEBIMENTO PIX ' + pagador, 'PIX_CRED', valor, 0])
];
const extratoLido = (conta, lancamentos) => engine.parseExtratoPix(extrato(conta, lancamentos), { arquivo: 'extrato ' + conta + '.xls', primeiraLinha: 1 });

test('Relação de CARTEIRA DIGITAL é reconhecida como PIX; a de cartão magnético, não', () => {
  assert.equal(engine.isRelacaoPix([...cabecalho, '1-LOJA 1 TESTE', venda(100, 'Bal', '10:00', '10,00')]), true);
  assert.equal(engine.isRelacaoPix(['Relação de Vendas por Período', '1-LOJA 1 JIE', '1232063 Bal 347920 04/11/2026 06:54 3/ 1 106 0,0% Cartao Mag 13,99']), false);
  assert.equal(engine.isRelacaoPix(['Relação de Vendas por Período', '1-LOJA 1 TESTE', venda(100, 'Bal', '10:00', '10,00')]), true);
});

test('Relação PIX: lojas 7 e 6 viram Loja 4 e Loja 5, loja continua na página seguinte e Total da Loja é conferido', () => {
  const rel = engine.parseRelacaoPix([
    ...cabecalho,
    '1-LOJA 1 TESTE', venda(100, 'Bal', '10:00', '10,00'), venda(101, 'Dom', '11:00', '20,00'), 'Total da Loja ...: 30,00',
    '6-LOJA 6 TESTE', venda(300, 'Bal', '09:00', '5,00'),
    'FARMÁCIA TESTE Pagina : 0002', venda(301, 'Bal', '09:30', '7,00'), 'Total da Loja ...: 12,00',
    '7-LOJA 7 TESTE', venda(500, 'Bal', '08:00', '3,00'), 'Total da Loja ...: 4,00',
    'Total Geral .....: 46,00'
  ]);
  assert.deepEqual(plain(rel.vendas.map(v => [v.id, engine.storeName(v.loja), v.registro, v.pagina, v.delivery])), [
    ['S001', 'Loja 1', '100', 1, false], ['S002', 'Loja 1', '101', 1, true],
    ['S003', 'Loja 4', '500', 2, false],
    ['S004', 'Loja 5', '300', 1, false], ['S005', 'Loja 5', '301', 2, false]
  ]);
  assert.deepEqual(plain(rel.periodo), { inicio: '2026-11-05', fim: '2026-11-05' });
  assert.equal(rel.avisos.length, 2);
  assert.match(rel.avisos[0], /Loja 4 \(7-LOJA 7 TESTE\) é R\$ 3,00, mas o "Total da Loja" do PDF é R\$ 4,00/);
  assert.match(rel.avisos[1], /todas as vendas PIX lidas é R\$ 45,00, mas o "Total Geral" do PDF é R\$ 46,00/);
});

test('Relação PIX recusa loja sem conta cadastrada e relatório sem vendas Cart. Dig', () => {
  assert.throws(() => engine.parseRelacaoPix([...cabecalho, '8-LOJA 8 TESTE', venda(1, 'Bal', '10:00', '1,00')]), /8-LOJA 8 TESTE, sem conta PIX cadastrada/);
  assert.throws(() => engine.parseRelacaoPix([...cabecalho, '1-LOJA 1 TESTE', 'Total da Loja ...: 0,00']), /Nenhuma venda "Cart\. Dig"/);
});

test('Extrato: conta pelo cabeçalho, só RECEBIMENTO PIX (mesmo com documento PIX_CRE) e linha do Excel', () => {
  const matriz = [
    ['', ''], ['Associado:', 'EMPRESA TESTE'], ['Cooperativa:', '0000'], ['Conta:', '87041-2'], ['Dados referentes ao período de 05/11/2026 a 06/11/2026.'],
    ['Data', 'Descrição', 'Documento', 'Valor (R$)', 'Saldo (R$)'], ['', 'Saldo Anterior', '', '', 100],
    ['05/11/2026', 'CIELO DEBITO VISA', '123', 50, 150],
    ['05/11/2026', 'RECEBIMENTO PIX 12345678901 CLIENTE TESTE A', 'PIX_CRED', 10, 160],
    ['05/11/2026', 'PAGAMENTO PIX 12345678901 FORNECEDOR TESTE', 'PIX_DEB', -5, 155],
    ['05/11/2026', 'TRANSF ENTRE CONTAS 12345678901 TESTE', 'CX1', 30, 185],
    ['05/11/2026', 'RECEBIMENTO PIX 12345678000199 EMPRESA TESTE B', 'PIX_CRE', 20, 205],
    ['06/11/2026', 'RECEBIMENTO PIX 98765432100 CLIENTE TESTE C', 'PIX_CRED', 7.5, 212.5],
    [], ['Saldo da Conta em 06/11/2026'], ['05/11/2026', 'RECEBIMENTO PIX 11111111111 NAO ENTRA', 'PIX_CRED', 99, 0]
  ];
  const ex = engine.parseExtratoPix(matriz, { arquivo: 'teste.xls', primeiraLinha: 2 });
  assert.equal(ex.conta, '87041-2');
  assert.deepEqual(plain(ex.periodo), { inicio: '2026-11-05', fim: '2026-11-06' });
  assert.deepEqual(plain(ex.pix.map(p => [p.linha, p.data, p.centavos, p.documento, p.pagadorDoc, p.pagadorNome])), [
    [10, '2026-11-05', 1000, 'PIX_CRED', '12345678901', 'CLIENTE TESTE A'],
    [13, '2026-11-05', 2000, 'PIX_CRE', '12345678000199', 'EMPRESA TESTE B'],
    [14, '2026-11-06', 750, 'PIX_CRED', '98765432100', 'CLIENTE TESTE C']
  ]);
  assert.throws(() => engine.parseExtratoPix([['Data', 'Descrição', 'Valor']], { arquivo: 'sem-conta.xls' }), /Conta:/);
});

function cenario(){
  const rel = engine.parseRelacaoPix([
    ...cabecalho,
    '1-LOJA 1 TESTE', venda(10, 'Bal', '10:00', '10,00'), venda(11, 'Dom', '11:00', '20,00'), venda(12, 'Bal', '12:00', '10,00'),
    '2-LOJA 2 TESTE', venda(20, 'Bal', '09:00', '8,00'),
    '3-LOJA 3 TESTE', venda(30, 'Bal', '09:00', '12,00'),
    '6-LOJA 6 TESTE', venda(60, 'Bal', '08:00', '30,00'), venda(61, 'Dom', '13:00', '14,98'), venda(62, 'Bal', '14:00', '43,98'), venda(63, 'Bal', '15:00', '9,94'),
    '7-LOJA 7 TESTE', venda(70, 'Bal', '09:30', '8,00')
  ]);
  const extratos = [
    extratoLido('87041-2', [['05/11/2026', '11111111111 CLIENTE A', 10]]),
    extratoLido('75073-5', [['05/11/2026', '22222222222 CLIENTE B', 8], ['05/11/2026', '33333333333 CLIENTE C', 8]]),
    extratoLido('75079-4', [['05/11/2026', '44444444444 CLIENTE D', 12], ['05/11/2026', '55555555555 CLIENTE E', 50], ['06/11/2026', '66666666666 CLIENTE F', 12]]),
    extratoLido('83679-6', [
      ['05/11/2026', '77777777777 CLIENTE G', 30], ['05/11/2026', '88888888888 CLIENTE H', 20], ['05/11/2026', '99999999999 CLIENTE I', 15],
      ['05/11/2026', '12121212121 CLIENTE J', 5], ['05/11/2026', '12121212121 CLIENTE J', 39], ['05/11/2026', '13131313131 CLIENTE K', 10]
    ])
  ];
  return engine.conciliarPix(rel, extratos);
}

test('regras: valor exato, Dom na conta da Loja 5, pagamento dividido, centavos até 0,05 e Pix usado uma vez', () => {
  const r = cenario();
  const porRegistro = Object.fromEntries(r.vendas.map(v => [v.registro, v]));
  assert.equal(porRegistro['10'].status, S.conciliado);
  assert.equal(porRegistro['12'].status, S.naoEncontrado, 'o único Pix de 10,00 da conta da Loja 1 já foi usado');
  assert.equal(porRegistro['11'].status, S.outraConta);
  assert.equal(porRegistro['11'].contaRecebida, '83679-6');
  assert.equal(porRegistro['20'].status, S.conciliado);
  assert.equal(porRegistro['70'].status, S.conciliado, 'a Loja 4 recebe na conta da Loja 2');
  assert.equal(porRegistro['70'].contaRecebida, '75073-5');
  assert.equal(porRegistro['61'].status, S.diferenca);
  assert.equal(porRegistro['61'].diferenca, 2);
  assert.equal(porRegistro['62'].status, S.diferenca);
  assert.deepEqual(plain(porRegistro['62'].pix.map(p => p.centavos)), [500, 3900]);
  assert.match(porRegistro['62'].observacao, /Pago em 2 Pix do mesmo pagador \(5,00 \+ 39,00 = 44,00\) para venda de 43,98: recebido 0,02 a mais/);
  assert.equal(porRegistro['63'].status, S.naoEncontrado, '9,94 contra 10,00 passa de 5 centavos');
  assert.deepEqual(plain(r.semVenda.map(p => [p.conta, p.centavos])), [['75079-4', 5000], ['83679-6', 1000]]);
  assert.equal(r.foraDoPeriodo.length, 1);
  assert.equal(new Set(r.pix.filter(p => p.venda).map(p => p.id)).size, r.pix.filter(p => p.venda).length);

  const contas = Object.fromEntries(r.porConta.map(c => [c.conta, c]));
  assert.equal(contas['87041-2'].diferenca, -3000);
  assert.deepEqual(plain(contas['87041-2'].composicao.map(x => [x.tipo, x.valor])), [['outraConta', -2000], ['naoEncontradas', -1000]]);
  assert.equal(contas['75073-5'].diferenca, 0);
  assert.equal(contas['75079-4'].diferenca, 5000);
  assert.equal(contas['83679-6'].diferenca, 2010);
  assert.deepEqual(plain(contas['83679-6'].composicao.map(x => [x.tipo, x.valor])), [['centavos', 4], ['outrasLojas', 2000], ['semVenda', 1000], ['naoEncontradas', -994]]);
  r.porConta.forEach(c => assert.equal(c.composicao.reduce((s, x) => s + x.valor, 0), c.diferenca, c.conta));
  assert.equal(r.ponte.checagem, 0);
  // Só a venda sem Pix deixa a loja pendente: Pix a mais, centavos a mais e outra conta não.
  assert.deepEqual(plain(r.porLoja.map(l => [l.nome, l.situacao])), [['Loja 1', 'PENDENTE'], ['Loja 2', 'CONCILIADO'], ['Loja 3', 'CONCILIADO'], ['Loja 4', 'CONCILIADO'], ['Loja 5', 'PENDENTE']]);
});

test('vendas lidas lado a lado por loja: delivery de outra loja, Pix a mais na altura do extrato e lojas da mesma conta separadas', () => {
  const r = cenario();
  const linhas = loja => engine.pixLadoALado(r, loja).linhas.map(l => [l.venda ? l.venda.registro : 'sem venda', l.pix.map(p => p.centavos).join('+'), l.pendente ? 'pendente' : l.atencao ? 'atenção' : l.extra ? 'a mais' : 'ok', l.outraLoja ? 'outra loja' : l.outraConta ? 'outra conta' : '']);
  assert.deepEqual(plain(linhas('1')), [['10', '1000', 'ok', ''], ['11', '2000', 'ok', 'outra conta'], ['12', '', 'pendente', '']]);
  assert.deepEqual(plain(linhas('6')), [
    ['60', '3000', 'ok', ''], ['11', '2000', 'ok', 'outra loja'], ['61', '1500', 'ok', ''],
    ['62', '500+3900', 'ok', ''], ['sem venda', '1000', 'a mais', ''], ['63', '', 'pendente', '']
  ]);
  assert.deepEqual(plain(linhas('2')), [['20', '800', 'ok', '']], 'a venda da Loja 4 fica só na aba da Loja 4');
  assert.deepEqual(plain(linhas('7')), [['70', '800', 'ok', '']]);
  assert.deepEqual(plain(linhas('3')), [['30', '1200', 'ok', ''], ['sem venda', '5000', 'a mais', '']]);
  const l5 = engine.pixLadoALado(r, '6');
  assert.deepEqual([l5.vendas, l5.pix, l5.pendentes, l5.atencao, l5.extras, l5.observacoes], [4, 6, 1, 0, 1, 3]);
});

test('Pix a mais não acusa pendência; recebido a menos pede conferência sem deixar a venda pendente', () => {
  const rel = engine.parseRelacaoPix([...cabecalho, '3-LOJA 3 TESTE', venda(1, 'Bal', '10:00', '10,03'), venda(2, 'Bal', '11:00', '20,00')]);
  const r = engine.conciliarPix(rel, [extratoLido('75079-4', [
    ['05/11/2026', '11111111111 CLIENTE A', 10], ['05/11/2026', '22222222222 CLIENTE B', 20], ['05/11/2026', '33333333333 CLIENTE C', 99]
  ])]);
  assert.deepEqual(plain(r.vendas.map(v => [v.status, v.diferenca])), [[S.diferenca, -3], [S.conciliado, 0]]);
  assert.equal(r.naoEncontradas.length, 0);
  assert.equal(r.aMenos.length, 1);
  const loja3 = r.porLoja.find(l => l.loja === '3');
  assert.deepEqual(plain([loja3.situacao, loja3.qtdAMenos, loja3.valorAMenos]), ['CONCILIADO', 1, 3]);
  const lado = engine.pixLadoALado(r, '3');
  assert.deepEqual([lado.pendentes, lado.atencao, lado.extras], [0, 1, 1]);
});

test('centavos: 0,05 entra; 0,06 não; dois Pix de pagadores diferentes não somam', () => {
  const rel = engine.parseRelacaoPix([...cabecalho, '3-LOJA 3 TESTE', venda(1, 'Bal', '10:00', '10,00'), venda(2, 'Bal', '11:00', '20,00'), venda(3, 'Bal', '12:00', '30,00')]);
  const r = engine.conciliarPix(rel, [extratoLido('75079-4', [
    ['05/11/2026', '11111111111 CLIENTE A', 10.05], ['05/11/2026', '22222222222 CLIENTE B', 20.06],
    ['05/11/2026', '33333333333 CLIENTE C', 15], ['05/11/2026', '44444444444 CLIENTE D', 15]
  ])]);
  assert.deepEqual(plain(r.vendas.map(v => v.status)), [S.diferenca, S.naoEncontrado, S.naoEncontrado]);
  assert.equal(r.vendas[0].diferenca, 5);
  assert.deepEqual(plain(r.semVenda.map(p => p.centavos)), [2006, 1500, 1500]);
  assert.ok(r.avisos.some(a => /Falta o extrato da conta 87041-2/.test(a)));
});

test('extrato de conta fora do cadastro ou repetido é recusado', () => {
  const rel = engine.parseRelacaoPix([...cabecalho, '1-LOJA 1 TESTE', venda(1, 'Bal', '10:00', '10,00')]);
  assert.throws(() => engine.conciliarPix(rel, [extratoLido('99999-9', [])]), /99999-9, que não está no cadastro PIX/);
  assert.throws(() => engine.conciliarPix(rel, [extratoLido('87041-2', []), extratoLido('87041-2', [])]), /dois extratos da conta 87041-2/);
});

/* ------------------------------------------------------------------ arquivos reais (05/11/2026) */
// A pasta exemplos/ fica fora do Git (dados de clientes). Sem ela, estes testes são pulados.
const pasta = path.join(root, 'exemplos/pix-dia-05');
const semExemplos = !fs.existsSync(pasta) && 'exemplos/pix-dia-05 não está nesta máquina (fica fora do Git)';
const ARQUIVOS_EXTRATO = ['extrato loja 1.xls', 'extrato loja 2.xls', 'extrato loja 3.xls', 'extrato loja 5.xls'];
let real = null;
function exemplo(){
  if(real) return real;
  const relacao = engine.parseRelacaoPix(lerLinhasPdf(path.join(pasta, 'Relação de Vendas por Período.PDF')));
  const extratos = ARQUIVOS_EXTRATO.map(arquivo => {
    const { matriz, primeiraLinha } = lerMatrizXls(path.join(pasta, arquivo));
    return engine.parseExtratoPix(matriz, { arquivo, primeiraLinha });
  });
  real = { relacao, extratos, resultado: engine.conciliarPix(relacao, extratos) };
  return real;
}

test('PROVA 05/11/2026: diferença Banco − Sistema por conta', { skip: semExemplos }, () => {
  const contas = Object.fromEntries(exemplo().resultado.porConta.map(c => [c.nome, c.diferenca]));
  assert.deepEqual(contas, {
    'Loja 1': -3720,          // venda Dom da Loja 1 (37,20) caiu na conta da Loja 5
    'Loja 2 + Loja 4': 0,
    'Loja 3': 10499,          // Pix sem venda no sistema
    'Loja 5': 3724            // 37,20 da Loja 1 + dois troquinhos de 0,02
  });
});

test('arquivos reais: PDF e extratos lidos por inteiro, com os totais impressos conferidos', { skip: semExemplos }, () => {
  const { relacao, extratos } = exemplo();
  assert.equal(relacao.vendas.length, 121);
  assert.equal(relacao.totalLido, 358918);
  assert.deepEqual(plain(relacao.avisos), []);
  assert.deepEqual(plain(relacao.lojas.map(l => [l.nomePdf, l.totalLido, l.totalImpresso])), [
    ['1-LOJA 1 JIE', 63141, 63141], ['2-LOJA 2 MEG 1', 54601, 54601], ['3-LOJA 3 L E', 55073, 55073],
    ['7-LOJA 7 MEG 4', 81981, 81981], ['6-LOJA 6 MEG 5', 104122, 104122]
  ]);
  assert.deepEqual(plain(extratos.map(e => [e.arquivo, e.conta, e.pix.length])), [
    ['extrato loja 1.xls', '87041-2', 20], ['extrato loja 2.xls', '75073-5', 65], ['extrato loja 3.xls', '75079-4', 23], ['extrato loja 5.xls', '83679-6', 49]
  ]);
  assert.ok(extratos[1].pix.some(p => p.documento === 'PIX_CRE'), 'o documento cortado PIX_CRE também entra');
});

test('arquivos reais: status, casos especiais e ponte Sistema × Banco', { skip: semExemplos }, () => {
  const r = exemplo().resultado;
  assert.deepEqual(plain(r.contagem), {
    vendas: { [S.conciliado]: 118, [S.outraConta]: 1, [S.diferenca]: 2 },
    pix: { [S.conciliado]: 122, [S.foraDoPeriodo]: 34, [S.semVenda]: 1 }
  });
  const v = id => r.vendas.find(x => x.id === id);
  assert.deepEqual(plain([v('S018').registro, v('S018').status, v('S018').contaRecebida, v('S018').pix.map(p => p.linha)]), ['1232335', S.outraConta, '83679-6', [41]]);
  assert.deepEqual(plain([v('S098').registro, v('S098').status, v('S098').diferenca, v('S098').pix.map(p => p.linha)]), ['353863', S.diferenca, 2, [20, 21]]);
  assert.deepEqual(plain([v('S113').registro, v('S113').status, v('S113').diferenca, v('S113').pix.map(p => p.linha)]), ['353922', S.diferenca, 2, [42]]);
  assert.deepEqual(plain(r.semVenda.map(p => [p.id, p.conta, p.linha, p.centavos])), [['E092', '75079-4', 20, 10499]]);
  assert.deepEqual(plain(r.ponte), { totalSistema: 358918, centavos: 4, semVenda: 10499, naoEncontradas: 0, totalExtratos: 369421, esperado: 369421, checagem: 0 });
  assert.deepEqual(plain(r.porLoja.map(l => [l.nome, l.diferenca, l.situacao])), [
    ['Loja 1', 0, 'CONCILIADO'], ['Loja 2', 0, 'CONCILIADO'], ['Loja 3', 0, 'CONCILIADO'],
    ['Loja 4', 0, 'CONCILIADO'], ['Loja 5', 4, 'CONCILIADO']
  ]);
  assert.deepEqual([r.naoEncontradas.length, r.aMenos.length, r.observacoes.length], [0, 0, 3]);
  assert.deepEqual(plain(r.avisos), []);
  const abas = engine.planilhasPix(r);
  assert.deepEqual(plain(abas.map(a => [a.nome, a.linhas.length])), [['Conciliação PIX', 28], ['Venda a venda', 123], ['Pix sem venda', 2], ['Extratos PIX', 159], ['Vendas Sistema PIX', 123]]);
});

test('arquivos reais: venda a venda igual ao gabarito da conferência manual', { skip: semExemplos }, () => {
  const r = exemplo().resultado;
  const gabarito = lerAbasXlsx(path.join(pasta, 'LJ 2 - Relatorio_Detalhado_Vendas_06-11-2026_.xlsx'));
  const contaDoArquivo = { 'extrato loja 1.xls': '87041-2', 'extrato loja 2.xls': '75073-5', 'extrato loja 3.xls': '75079-4', 'extrato loja 5.xls': '83679-6' };
  const c = x => Math.round(Number(x) * 100);
  const divergencias = [];

  const detalhe = gabarito['Conciliação PIX'].filter(l => /^S\d{3}$/.test(l[0]));
  assert.equal(detalhe.length, 121);
  detalhe.forEach(l => {
    const v = r.vendas.find(x => x.id === l[0]);
    const esperado = { registro: String(l[2]), valor: c(l[7]), conta: contaDoArquivo[l[9]] || '', banco: c(l[12]), diferenca: c(l[13]), status: l[14] };
    const obtido = v ? { registro: v.registro, valor: v.centavos, conta: v.contaRecebida, banco: v.banco, diferenca: v.diferenca, status: v.status } : null;
    if(JSON.stringify(esperado) !== JSON.stringify(obtido)) divergencias.push(l[0] + ' gabarito ' + JSON.stringify(esperado) + ' × ferramenta ' + JSON.stringify(obtido));
  });

  const extratos = gabarito['Extratos PIX'].filter(l => /^E\d{3}$/.test(l[0]));
  assert.equal(extratos.length, 157);
  extratos.forEach(l => {
    const p = r.pix.find(x => x.id === l[0]);
    // Com valores repetidos na mesma conta e dia, qual Pix fica com qual venda é indiferente.
    const repetido = r.pix.filter(x => x.noPeriodo && p && x.conta === p.conta && x.centavos === p.centavos).length > 1;
    const esperado = { conta: l[2], linha: Number(l[3]), valor: c(l[6]), situacao: l[8], venda: repetido ? '*' : l[7] };
    const obtido = p ? { conta: p.conta, linha: p.linha, valor: p.centavos, situacao: p.situacao, venda: repetido ? '*' : (p.venda ? p.venda.id : '') } : null;
    if(JSON.stringify(esperado) !== JSON.stringify(obtido)) divergencias.push(l[0] + ' gabarito ' + JSON.stringify(esperado) + ' × ferramenta ' + JSON.stringify(obtido));
  });
  assert.deepEqual(divergencias, [], 'Linhas diferentes do gabarito:\n' + divergencias.join('\n'));
});

test('arquivos reais: vendas lidas lado a lado de cada loja', { skip: semExemplos }, () => {
  const r = exemplo().resultado;
  const resumo = loja => { const l = engine.pixLadoALado(r, loja); return [l.linhas.length, l.vendas, l.pix, l.pendentes, l.atencao, l.extras, l.observacoes]; };
  assert.deepEqual(plain(['1', '2', '3', '7', '6'].map(resumo)), [[20, 20, 20, 0, 0, 0, 1], [20, 20, 20, 0, 0, 0, 0], [19, 18, 19, 0, 0, 1, 0], [30, 30, 30, 0, 0, 0, 0], [34, 33, 35, 0, 0, 0, 3]]);
  const loja3 = engine.pixLadoALado(r, '3').linhas;
  const i = loja3.findIndex(l => !l.venda);
  assert.deepEqual(plain([loja3[i].pix[0].id, loja3[i - 1].venda.id, loja3[i + 1].venda.id]), ['E092', 'S046', 'S047'], 'o Pix sem venda fica entre as vendas das linhas 19 e 22 do extrato');
  const delivery = engine.pixLadoALado(r, '6').linhas.find(l => l.outraLoja);
  assert.deepEqual(plain([delivery.venda.id, delivery.pix[0].linha]), ['S018', 41]);
  assert.equal(engine.pixLadoALado(r, '1').linhas.find(l => l.outraConta).venda.id, 'S018');
});
