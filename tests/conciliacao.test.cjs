const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function loadEngine(){
  const context = vm.createContext({ window: {}, pdfjsLib: { GlobalWorkerOptions: {} }, console });
  const shared = fs.readFileSync(path.join(root, 'js/shared.js'), 'utf8');
  vm.runInContext(shared.slice(shared.indexOf('function fmtBRL')), context);
  const source = fs.readFileSync(path.join(root, 'ferramentas/conciliacao/conciliacao.js'), 'utf8');
  vm.runInContext(source.slice(0, source.indexOf("var dropzone =")) + '\n' + source.slice(source.indexOf('function buildCardGroups('), source.indexOf('function cardGroups(')) + '\nreturn { brandLabel, paymentLabel, parseCardLaunchLines, aggregateCardLaunches, parseCaixaLines, parseCieloPdfLines, matchCardTransactions, buildCardAudit, cardRangeWarning, buildCardGroups, buildCardChannelGroups, reconcile, launchCoverageMessage, linkLaunches, assignCieloStores, reconcileStores, storeName }; };', context);
  return context.window.__tool_init_conciliacao();
}
module.exports = { loadEngine };

const engine = loadEngine();
const sale = (valor, hora, registro = '1427') => ({ valor, hora, data: '2026-09-09', registro, documento: registro, loja: '7', modalidade: 'Cartao' });
const bank = (valor, hora) => ({ valor, hora, data: '2026-09-09', modalidade: 'Credito', bandeira: 'Mastercard', parcelas: 2, origem: 'Cielo' });
const launchFixture = [
  'Periodo: 09/09/2026 a 09/09/2026 ** Loja: 7-LOJA 7 MEG 4', '09/09/2026',
  '1 - MASTERCARD 1427 2 92,48 1,99 90,64 000500014',
  '1 - MASTERCARD 1427 2 92,47 1,99 90,63 000500014', 'Total Geral...: 2 184,95'
];

test('Relação preserva Cx/Tu e código do vendedor para identificar o responsável', () => {
  const [parsed] = engine.parseCaixaLines(['3-LOJA 3', '1225926 Bal 342150 19/09/2026 07:31 3/ 1 53 0,0% Cartao Mag 60,96']);
  assert.equal(parsed.caixa, '3');
  assert.equal(parsed.turno, '1');
  assert.equal(parsed.caixaTurno, '3/1');
  assert.equal(parsed.codigoVendedor, '53');

  const result = engine.reconcile([parsed], [], [{ ...bank(59.96, '07:31'), data: parsed.data }]);
  assert.equal(result.divergences[0].caixaTurno, '3/1');
  assert.equal(result.divergences[0].codigoVendedor, '53');
});

test('parcelas se somam em centavos, com NSU preservado e total impresso validado', () => {
  const lines = engine.parseCardLaunchLines(launchFixture);
  const groups = engine.aggregateCardLaunches(lines);
  assert.equal(groups.length, 1); assert.equal(groups[0].valor, 184.95);
  assert.equal(groups[0].nsu, '000500014'); assert.equal(groups[0].linhas.length, 2);
  assert.throws(() => engine.parseCardLaunchLines(launchFixture.filter((_, i) => i !== 2)), /total impresso/);
});
test('parcelas idênticas são preservadas e registros de lojas diferentes não se misturam', () => {
  const lines = engine.parseCardLaunchLines(['7-LOJA 7', '09/09/2026', '1 - MASTERCARD 1553 2 41,74 1,99 40,91 000500085', '1 - MASTERCARD 1553 2 41,74 1,99 40,91 000500085']);
  assert.equal(engine.aggregateCardLaunches(lines)[0].valor, 83.48);
  assert.equal(engine.aggregateCardLaunches([...lines, { ...lines[0], loja: '8' }]).length, 2);
});
test('valor repetido é associado pelo horário, sem usar bandeira como critério', () => {
  const a = sale(14.99, '08:31', '1422'), b = sale(14.99, '17:02', '1512');
  const x = { ...bank(14.99, '17:01'), bandeira: 'American Express' }, y = bank(14.99, '08:30');
  const result = engine.matchCardTransactions([a, b], [x, y]);
  assert.equal(result.matched.find(p => p.caixa === a).banco, y);
  assert.equal(result.matched.find(p => p.caixa === b).banco, x);
});
test('empate de valor e horário fica pendente, sem falsa confirmação', () => {
  const result = engine.matchCardTransactions([sale(10, '10:00'), sale(10, '10:00', '2')], [bank(10, '10:00'), bank(10, '10:00')]);
  assert.equal(result.matched.length, 0); assert.equal(result.ausentes.length, 2);
  assert.equal(result.divergValor.length, 0);
});
test('vendas sem evidência temporal não são forçadas como valor divergente', () => {
  const result = engine.matchCardTransactions([sale(10, '10:00')], [bank(20, '17:00')]);
  assert.equal(result.divergValor.length, 0); assert.equal(result.ausentes.length, 1); assert.equal(result.sobras.length, 1);
});
test('mesmo valor em horário distante não certifica dados do cartão', () => {
  const lines = engine.parseCardLaunchLines(launchFixture), a = sale(184.95, '08:49'), b = bank(184.95, '18:49');
  const audit = engine.buildCardAudit([a], lines, [b], engine.matchCardTransactions([a], [b]));
  assert.ok(audit.rows[0].issues.some(i => /vínculo/.test(i))); assert.equal(audit.rows[0].brand, false);
});
test('classificação divergente é detectada mesmo quando os valores fecham', () => {
  const lines = engine.parseCardLaunchLines(launchFixture), a = sale(184.95, '08:49'), b = { ...bank(184.95, '08:49'), bandeira: 'Visa', modalidade: 'Debito', parcelas: 1 };
  const result = engine.reconcile([a], [], [b]);
  assert.equal(result.divergences.length, 0);
  const row = engine.buildCardAudit([a], lines, [b], result.pairs).rows[0];
  assert.equal(row.brand, true); assert.equal(row.mode, true); assert.equal(row.installments, true);
});
test('valores e totais por categoria vêm da Relação, mesmo se o lançamento tiver outro valor', () => {
  const lines = engine.parseCardLaunchLines(launchFixture).map(line => ({ ...line, valor: line.valor - 1 }));
  const a = sale(184.95, '08:49'), b = bank(184.95, '08:49');
  const result = engine.reconcile([a], [], [b]);
  const audit = engine.buildCardAudit([a], lines, [b], result.pairs);
  const groups = engine.buildCardGroups(audit, [b]);
  assert.equal(result.divergences.length, 0);
  assert.equal(audit.rows[0].issues.length, 0);
  assert.equal(groups.find(group => group.qtdSistema === 1).sistema, 18495);
});
test('cobertura incompleta não vira classificação conferida', () => {
  const a = sale(184.95, '08:49'), b = bank(184.95, '08:49');
  const row = engine.buildCardAudit([a], [], [b], engine.matchCardTransactions([a], [b])).rows[0];
  assert.ok(row.issues.includes('Sem lançamento interno')); assert.equal(row.internalOK, false);
});
test('registro duplicado ou parcela faltante fica pendente', () => {
  const lines = engine.parseCardLaunchLines(launchFixture), a = sale(184.95, '08:49'), b = bank(184.95, '08:49');
  const duplicateAudit = engine.buildCardAudit([a, { ...a, hora: '12:00' }], lines, [b], engine.matchCardTransactions([a], [b]));
  assert.ok(duplicateAudit.rows[0].issues.includes('Registro repetido na Relação'));
  const partial = [{ ...lines[0], valor: 184.95 }];
  const row = engine.buildCardAudit([a], partial, [b], engine.matchCardTransactions([a], [b])).rows[0];
  assert.ok(row.issues.includes('Parcelas internas incompletas ou repetidas'));
});
test('Cielo preserva bandeira, débito pré-pago, parcelas e líquido', () => {
  const parsed = engine.parseCieloPdfLines(['09/09/2026 16:23 3002105343 13.286.582/0004-09 Débito pré-pago Visa R$ 22,99 -R$ 0,20 R$ 22,79 Aprovada', '09/09/2026 09:01 3002105343 13.286.582/0004-09 Crédito parcelado loja 03x 03 Mastercard R$ 183,97 -R$ 2,94 R$ 181,03 Aprovada', '09/09/2026 11:00 Débito Visa R$ 10,00 Cancelada']);
  assert.equal(parsed.length, 2); assert.equal(parsed[0].bandeira, 'Visa'); assert.equal(parsed[0].modalidade, 'Debito'); assert.equal(parsed[0].valorLiquido, 22.79); assert.equal(parsed[1].parcelas, 3);
});
test('venda "Não aprovada" é descartada e não disputa o vínculo com a aprovada', () => {
  const cielo = engine.parseCieloPdfLines([
    '2 R$ 19,98 -R$ 0,10 R$ 9,89',
    '21/10/2026 08:56 1029024402 11.719.336/0001-25 Crédito à vista Elo R$ 9,99 R$ 0,00 R$ 0,00 Não aprovada',
    '21/10/2026 08:56 1029024402 11.719.336/0001-25 Débito à vista Elo R$ 9,99 -R$ 0,10 R$ 9,89 Aprovada'
  ]);
  assert.equal(cielo.length, 1); assert.equal(cielo[0].modalidade, 'Debito');
  const [caixa] = engine.parseCaixaLines(['1-LOJA 1 JIE', '1230234 Bal 346201 21/10/2026 08:57 3/ 1 106 0,0% Cartao Mag 9,99']);
  const result = engine.matchCardTransactions([caixa], cielo);
  assert.equal(result.matched.length, 1); assert.equal(result.sobras.length, 0);
});
test('novo cadastro separa POS/TEF e reconhece abreviações, débito e faixas de crédito', () => {
  const lines = engine.parseCardLaunchLines([
    '1-LOJA 1', '28/09/2026',
    '25 - POS MASTER 1X 1001 1 10,00 1,39 9,86 123',
    '29 - POS MASTER DÉBITO 1002 1 20,00 0,85 19,83 124',
    '15 - TEF HIPERC 2X - 3X 1003 2 15,00 1,60 14,76 125',
    '15 - TEF HIPERC 2X - 3X 1003 2 15,00 1,60 14,76 125',
    '9 - TEF CABAL 1X 1004 1 40,00 1,39 39,44 126'
  ]);
  assert.deepEqual(Array.from(lines, line => [line.canal, line.bandeira, line.modalidade, line.cadastroValido]), [
    ['POS', 'Mastercard', 'Credito', true], ['POS', 'Mastercard', 'Debito', true],
    ['TEF', 'Hipercard', 'Credito', true], ['TEF', 'Hipercard', 'Credito', true],
    ['TEF', 'Cabal', 'Credito', true]
  ]);
  assert.deepEqual(Array.from(lines[2].faixaParcelas), [2, 3]);
  const sales = [10, 20, 30, 40].map((valor, i) => ({ ...sale(valor, '10:00', String(1001 + i)), data: '2026-09-28', loja: '1' }));
  const audit = engine.buildCardAudit(sales, lines, [], { matched: [], divergValor: [], sobras: [] });
  assert.deepEqual(Array.from(engine.buildCardChannelGroups(audit), group => [group.canal, group.qtd, group.total]), [
    ['POS', 2, 3000], ['TEF', 2, 7000]
  ]);
});
test('parcela fora da faixa do cartão cadastrado aparece sem perder o vínculo com a venda', () => {
  const launches = engine.parseCardLaunchLines([
    '1-LOJA 1', '28/09/2026',
    '1 - TEF MASTER 1X 1001 2 43,97 1,99 43,10 123',
    '1 - TEF MASTER 1X 1001 2 43,97 1,99 43,10 123'
  ]);
  const system = { ...sale(87.94, '07:56', '1001'), data: '2026-09-28', loja: '1' };
  const cielo = { ...bank(87.94, '07:56'), data: '2026-09-28' };
  const row = engine.buildCardAudit([system], launches, [cielo], engine.matchCardTransactions([system], [cielo])).rows[0];
  assert.ok(row.issues.includes('Parcelas fora da faixa do cartão cadastrado'));
  assert.equal(row.internalOK, true);
  assert.equal(row.installments, false);
  const warning = engine.cardRangeWarning(row);
  assert.equal(warning.title, 'Venda em 2x; cartão selecionado de 1x');
  assert.match(warning.detail, /O caixa registrou 2x para a venda \(coluna Parc\. dos Lançamentos\)/);
  assert.match(warning.detail, /“TEF MASTER 1X” \(cód\. 1\), cadastrado para 1x/);
  assert.match(warning.detail, /A Cielo também informa 2x/);
  assert.match(warning.detail, /cartão escolhido nessa segunda etapa/);
  assert.doesNotMatch(engine.cardRangeWarning({ ...row, confidence: 'valor' }).detail, /A Cielo também informa/);
});
test('indicadores ficam alinhados e somente divergências recebem destaque', () => {
  const posCredit = engine.paymentLabel({ canal: 'POS', modalidade: 'Credito', parcelas: 3 }, { mode: true, installments: true });
  const tefDebit = engine.paymentLabel({ canal: 'TEF', modalidade: 'Debito', parcelas: 1 }, { mode: true, installments: true });
  assert.match(posCredit, /^<span class="card-payment-row">/);
  assert.match(posCredit, /card-channel pos/);
  assert.match(posCredit, /payment-label credit field-warning/);
  assert.match(posCredit, /installment-label three field-warning/);
  assert.match(tefDebit, /card-channel tef/);
  assert.match(tefDebit, /payment-label debit field-warning/);
  assert.match(tefDebit, /installment-label one field-warning/);
  const wrongCardRange = engine.paymentLabel({ canal: 'TEF', modalidade: 'Credito', parcelas: 2, faixaParcelas: [1] }, { mode: false, installments: false });
  assert.match(wrongCardRange, /installment-label two field-warning/);
  assert.doesNotMatch(wrongCardRange, /payment-label credit field-warning/);
  const matched = engine.paymentLabel({ canal: 'TEF', modalidade: 'Credito', parcelas: 2, faixaParcelas: [2, 3] }, { mode: false, installments: false });
  assert.doesNotMatch(matched, /field-warning/);
  assert.doesNotMatch(engine.brandLabel('Mastercard', false), /field-warning/);
  assert.match(engine.brandLabel('Mastercard', true), /brand-label field-warning/);
  assert.match(engine.brandLabel('Hipercard', false), /hipercard-shape/);
  assert.match(engine.brandLabel('Hipercard', true), /brand-label field-warning/);
});
// Amostra real de 04/11/2026: o filtro "04/11/2026" dos Lançamentos foi lido
// como 11 de abril, enquanto Relação e Cielo são de 4 de novembro.
const relacaoNov = engine.parseCaixaLines([
  '1-LOJA 1 JIE',
  '1232063 Bal 347920 04/11/2026 06:54 3/ 1 106 0,0% Cartao Mag 13,99',
  '1232065 Bal 347922 04/11/2026 07:02 3/ 1 106 0,0% Cartao Mag 27,98'
]);
const cieloNov = engine.parseCieloPdfLines([
  '04/11/2026 06:53 1029024402 11.719.336/0001-25 Crédito à vista Visa R$ 13,99 -R$ 0,25 R$ 13,74 Aprovada',
  '04/11/2026 07:01 1029024402 11.719.336/0001-25 Débito à vista Visa R$ 27,98 -R$ 0,25 R$ 27,73 Aprovada'
]);
const lancamentosAbr = engine.parseCardLaunchLines([
  'Periodo: 04/11/2026 a 04/11/2026 ** Loja: 1-LOJA 1 JIE', '11/04/2026', '1 - LOJA 1 JIE',
  '4 - TEF AMEX 1X 1204345 1 62,94 2,52 61,35 000000002',
  '1 - TEF MASTER 1X 1204343 1 48,99 1,99 48,02 000000001',
  'Total Geral...: 2 111,93'
]);

test('Lançamentos de outro dia não viram pendências falsas e a inversão dia/mês é explicada', () => {
  const result = engine.reconcile(relacaoNov, [], cieloNov);
  assert.equal(result.pairs.matched.length, 2);
  const audit = engine.buildCardAudit(relacaoNov, lancamentosAbr, cieloNov, result.pairs);
  assert.equal(audit.blocked, true);
  assert.equal(audit.rows.length, 0);
  assert.equal(audit.coverage.linked, 0);
  assert.equal(audit.coverage.swappedDate, true);
  assert.deepEqual(Array.from(audit.coverage.lancamentos.datas), ['2026-04-11']);
  assert.equal(audit.coverage.lancamentos.registroMin, 1204343);
  assert.equal(audit.coverage.relacao.registroMax, 1232065);

  const message = engine.launchCoverageMessage(audit.coverage);
  assert.match(message.detail, /Nenhum dos 2 registros dos Lançamentos/);
  assert.match(message.detail, /Os Lançamentos são de 11\/04\/2026, mas a Relação e a Cielo são de 04\/11\/2026/);
  assert.match(message.detail, /As bandeiras também não batem: os Lançamentos têm American Express \(1 venda\) e Mastercard \(1 venda\), que não aparecem na Cielo; a Cielo tem Visa \(2 vendas\), que não aparece nos Lançamentos\./);
  assert.match(message.action, /para 04\/11\/2026/);
  assert.match(message.action, /mês\/dia/);
  assert.match(message.action, /digitar 11\/04\/2026/);
  assert.match(message.action, /a data acima das linhas deve ser 04\/11\/2026 e os registros devem ficar perto de 1232063 a 1232065/);
  assert.equal(message.facts[0].bandeiras, 'American Express 1 · Mastercard 1');
  assert.equal(message.facts[2].bandeiras, 'Visa 2');
  assert.deepEqual(Array.from(message.facts, f => f.label), ['Lançamentos de Cartão', 'Relação de Vendas', 'Cielo']);
  assert.equal(message.facts[0].local, 'Loja 1 · Registros 1204343 a 1204345');
  assert.equal(message.facts[2].local, 'Estab. 1029024402');
});

test('Lançamentos de outra loja pedem o relatório da loja certa, sem sugerir inversão de data', () => {
  const outraLoja = lancamentosAbr.map(line => ({ ...line, loja: '3', data: '2026-11-04' }));
  const audit = engine.buildCardAudit(relacaoNov, outraLoja, cieloNov, engine.reconcile(relacaoNov, [], cieloNov).pairs);
  assert.equal(audit.blocked, true);
  assert.equal(audit.coverage.sameStore, false);
  const message = engine.launchCoverageMessage(audit.coverage);
  assert.match(message.detail, /loja 3 e a Relação é da loja 1/);
  assert.match(message.action, /da loja 1 para 04\/11\/2026/);
  assert.doesNotMatch(message.action, /mês\/dia/);
  assert.doesNotMatch(message.action, /perto de/);
});

test('Lançamentos do mesmo dia seguem para a conferência e datas extras são apontadas', () => {
  const mesmoDia = engine.parseCardLaunchLines([
    '1-LOJA 1 JIE', '04/11/2026',
    '2 - TEF VISA 1X 1232063 1 13,99 1,78 13,74 000000001',
    '6 - TEF VISA DÉBITO 1232065 1 27,98 0,89 27,73 000000002',
    '05/11/2026',
    '6 - TEF VISA DÉBITO 1232300 1 10,00 0,89 9,91 000000003'
  ]);
  const result = engine.reconcile(relacaoNov, [], cieloNov);
  const audit = engine.buildCardAudit(relacaoNov, mesmoDia, cieloNov, result.pairs);
  assert.notEqual(audit.blocked, true);
  assert.equal(audit.coverage.linked, 2);
  assert.deepEqual(Array.from(audit.coverage.foraDoPeriodo), ['2026-11-05']);
  const sales = audit.rows.filter(row => row.sale);
  assert.equal(sales.length, 2);
  assert.ok(sales.every(row => row.issues.length === 0), JSON.stringify(sales.map(row => row.issues)));
  assert.ok(audit.rows.some(row => !row.sale && row.issues.includes('Lançamento sem venda na Relação')));
});

// Amostra de 29/09/2026 com várias lojas: Relação e Lançamentos com todas as
// lojas e uma Cielo por loja. Loja 4 = código 7 e Loja 5 = código 6 no sistema.
// Listas vindas do motor (outro contexto vm) são comparadas como dados simples.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
const relacaoGeral = [
  '1-LOJA 1 JIE',
  '1227272 Bal 343418 29/09/2026 07:55 3/ 1 106 0,0% Cartao Mag 16,98',
  '1227327 Dom 343470 29/09/2026 17:42 3/ 2 35 0,0% Cartao Mag 154,96',
  '2-LOJA 2 MEG 1',
  '537784 Bal 230644 29/09/2026 07:32 2/ 1 103 0,0% Cartao Mag 7,99',
  '6-LOJA 6 MEG 5',
  '349277 Bal 243609 29/09/2026 07:16 1/ 1 113 0,0% Cartao Mag 40,98',
  '349379 Dom 243700 29/09/2026 17:55 1/ 2 63 0,0% Cartao Mag 108,97',
  '349417 Dom 243736 29/09/2026 21:53 1/ 2 35 0,0% Cartao Mag 5,99',
  '7-LOJA 7 MEG 4',
  '3888 Bal 3623 29/09/2026 07:43 1/ 1 117 0,0% Cartao Mag 11,99',
  '3932 Bal 3664 29/09/2026 13:09 1/ 1 117 0,0% Cartao Mag 29,96',
  'Cartao Mag 60,00'
];
const lancamentosGerais = [
  'Periodo: 29/09/2026 a 29/09/2026 ** Loja: <Todas>', '29/09/2026',
  '1 - LOJA 1 JIE',
  '26 - POS VISA 1X 1227327 1 154,96 1,39 152,81 02484223',
  '1 - TEF MASTER 1X 1227272 1 16,98 1,99 16,64 000500004',
  '2 - LOJA 2 MEG 1',
  '8 - POS AMEX 1X 537784 1 7,99 2,12 7,82 02514654',
  '6 - LOJA 6 MEG 5',
  '30 - POS VISA DÉBITO 349379 1 108,97 0,85 108,04 161699',
  '30 - POS VISA DÉBITO 349417 1 5,99 0,85 5,94 5226',
  '6 - TEF VISA DÉBITO 349277 1 40,98 0,85 40,63 000500001',
  '7 - LOJA 7 MEG 4',
  '8 - POS AMEX 1X 3932 1 60,00 2,12 58,73 337265',
  '8 - POS AMEX 1X 3932 1 60,00 2,12 58,73 337265',
  '8 - POS AMEX 1X 3932 1 29,96 2,12 29,32 02484224',
  '8 - POS AMEX 1X 3932 1 29,96 2,12 29,32 02484224',
  '1 - TEF MASTER 1X 3888 1 11,99 1,39 11,82 000500001'
];
const cieloLoja1 = ['29/09/2026 07:54 1029024402 11.719.336/0001-25 Débito à vista Elo R$ 16,98 -R$ 0,17 R$ 16,81 Aprovada'];
const cieloLoja4 = ['29/09/2026 07:42 3002105343 13.286.582/0004-09 Crédito à vista Mastercard R$ 11,99 -R$ 0,17 R$ 11,82 Aprovada'];
const cieloLoja5 = [
  '29/09/2026 07:16 2800327299 13.286.582/0002-47 Débito à vista Visa R$ 40,98 -R$ 0,32 R$ 40,66 Aprovada',
  '29/09/2026 16:42 2800327299 13.286.582/0002-47 Crédito à vista Visa R$ 154,96 -R$ 2,43 R$ 152,53 Aprovada',
  '29/09/2026 12:58 2800327299 13.286.582/0002-47 Débito à vista Elo R$ 60,00 -R$ 0,56 R$ 59,44 Aprovada',
  '29/09/2026 12:59 2800327299 13.286.582/0002-47 Crédito à vista Mastercard R$ 29,96 -R$ 0,47 R$ 29,49 Aprovada',
  '29/09/2026 17:08 2800327299 13.286.582/0002-47 Débito à vista Visa R$ 118,97 -R$ 0,92 R$ 118,05 Aprovada',
  '29/09/2026 07:20 2800327299 13.286.582/0002-47 Crédito à vista American Express R$ 7,99 -R$ 0,17 R$ 7,82 Aprovada'
];
const geral = () => ({ caixa: engine.parseCaixaLines(relacaoGeral), lanc: engine.parseCardLaunchLines(lancamentosGerais) });
const cielo = (...sets) => engine.parseCieloPdfLines([].concat(...sets));

test('cada Cielo é ligada à loja pelo estabelecimento; Loja 4 e Loja 5 têm outro código no sistema', () => {
  const { caixa } = geral();
  const assigned = engine.assignCieloStores(caixa, cielo(cieloLoja1, cieloLoja4, cieloLoja5));
  same(Array.from(new Set(assigned.map(t => t.loja))), ['1', '7', '6']);
  assert.equal(engine.storeName('7'), 'Loja 4');
  assert.equal(engine.storeName('6'), 'Loja 5');
  const desconhecida = cielo(['29/09/2026 07:54 9999999999 11.719.336/0001-25 Débito à vista Elo R$ 16,98 -R$ 0,17 R$ 16,81 Aprovada']);
  assert.throws(() => engine.assignCieloStores(caixa, desconhecida), /9999999999 não está ligado a nenhuma loja/);
  // Loja única, como antes: o estabelecimento fora do cadastro vale para a loja da Relação.
  assert.equal(engine.assignCieloStores(caixa.filter(t => t.loja === '1'), desconhecida)[0].loja, '1');
});

test('6 arquivos: vendas POS das lojas 1 e 4 caem na Cielo da Loja 5 e ficam explícitas', () => {
  const { caixa, lanc } = geral();
  const r = engine.reconcileStores(caixa, cielo(cieloLoja1, cieloLoja4, cieloLoja5), lanc);
  assert.equal(r.multi, true);
  same(r.views.map(v => v.nome), ['Loja 1', 'Loja 4', 'Loja 5']);
  const [l1, l4, l5] = r.views;

  assert.equal(l1.divergences.length, 0);
  assert.equal(l1.diferencaFinal, 0);
  assert.equal(l1.posFora.length, 1);
  assert.equal(l1.posFora[0].confidence, 'entrega');
  assert.equal(l1.posFora[0].banco.loja, '6');
  same(l1.summary.map(s => s.modalidade), ['Caixa × Cielo · Loja 1', 'Vendas POS desta loja recebidas na Cielo da Loja 5', 'Total separando as vendas POS']);
  assert.equal(l1.summary[2].banco, 171.94);

  assert.equal(l4.divergences.length, 0);
  assert.equal(l4.diferencaFinal, 0);
  assert.equal(l4.posFora.length, 2);

  assert.equal(l5.posRecebidas.length, 3);
  assert.match(l5.summary[1].modalidade, /Loja 1: 1 · Loja 4: 2/);
  // Cielo − Relação: a Cielo da Loja 5 tem R$ 12,00 a mais (118,97 × 108,97, sobra de 7,99 e falta de 5,99).
  assert.equal(l5.diferencaFinal, 12);
  same(l5.divergences.map(d => [d.tipo, d.documento, d.valorCaixa, d.valorBanco]), [
    ['valor_divergente', '349379', 108.97, 118.97],
    ['ausente_banco', '349417', 5.99, null],
    ['sobra_banco', '—', null, 7.99]
  ]);

  // Loja 2 não usa a Cielo da Loja 5: a POS de R$ 7,99 dela não leva a sobra.
  same(r.semCielo.map(s => [s.nome, s.motivo, s.posFora.length]), [['Loja 2', 'Sem acesso à Cielo desta loja', 0]]);
  same(r.posEntreLojas.map(p => [engine.storeName(p.caixa.loja), p.caixa.valor, p.diferencas.join(', ')]), [
    ['Loja 1', 154.96, ''],
    ['Loja 4', 29.96, 'Bandeira divergente'],
    ['Loja 4', 60, 'Bandeira divergente, Débito / crédito divergente']
  ]);
});

test('POS com outra loja: bandeira conferida, linha repetida e pagamento em dois cartões apontados', () => {
  const { caixa, lanc } = geral();
  const r = engine.reconcileStores(caixa, cielo(cieloLoja1, cieloLoja4, cieloLoja5), lanc);
  const rows = r.views[1].cardAudit.rows.filter(row => row.sale && row.sale.registro === '3932');
  assert.equal(rows.length, 2);
  rows.forEach(row => {
    assert.equal(row.launch.descricao, '8 - POS AMEX 1X');
    assert.ok(row.issues.includes('Linha repetida nos Lançamentos'), JSON.stringify(row.issues));
    assert.ok(!row.issues.includes('Registro repetido na Relação'));
    assert.equal(row.brand, true);
    assert.equal(row.bank.loja, '6');
  });
  const tef = r.views[1].cardAudit.rows.find(row => row.sale && row.sale.registro === '3888');
  same(Array.from(tef.issues), []);
  // POS de R$ 108,97 achada na Cielo como R$ 118,97: mesma bandeira e débito, no tempo da entrega.
  const typo = r.views[2].cardAudit.rows.find(row => row.sale && row.sale.registro === '349379');
  assert.equal(typo.confidence, 'entrega');
  assert.ok(typo.issues.includes('Valor Cielo divergente'));
});

test('venda paga com dois cartões liga cada pagamento ao lançamento de mesmo valor', () => {
  const caixa = engine.parseCaixaLines(['1-LOJA 1 JIE', '1227292 Bal 343436 29/09/2026 12:57 3/ 1 106 0,0% Cartao Mag 23,99', 'Cartao Mag 20,00']);
  const lanc = engine.parseCardLaunchLines(['1-LOJA 1 JIE', '29/09/2026', '1 - TEF MASTER 1X 1227292 1 23,99 1,99 23,51 000500012', '7 - TEF MASTER DÉBITO 1227292 1 20,00 0,89 19,82 000500013']);
  const banks = cielo([
    '29/09/2026 12:57 1029024402 11.719.336/0001-25 Débito à vista Mastercard R$ 20,00 -R$ 0,18 R$ 19,82 Aprovada',
    '29/09/2026 12:57 1029024402 11.719.336/0001-25 Crédito à vista Mastercard R$ 23,99 -R$ 0,48 R$ 23,51 Aprovada'
  ]);
  const view = engine.reconcileStores(caixa, banks, lanc).views[0];
  assert.equal(caixa[1].pagamentoAdicional, true);
  same(view.cardAudit.rows.map(row => [row.sale.valor, row.launch.descricao, row.issues.length]), [[23.99, '1 - TEF MASTER 1X', 0], [20, '7 - TEF MASTER DÉBITO', 0]]);
});

test('3 arquivos de uma loja: resultado como antes e POS indicada como Cielo da Loja 5 não enviada', () => {
  const { caixa, lanc } = geral();
  const r = engine.reconcileStores(caixa.filter(t => t.loja === '1'), cielo(cieloLoja1), lanc.filter(t => t.loja === '1'));
  assert.equal(r.multi, false);
  const view = r.views[0];
  assert.equal(view.summary[0].modalidade, 'Caixa × Cielo');
  same(view.divergences.map(d => [d.tipo, d.documento]), [['pos_sem_cielo', '1227327']]);
  assert.equal(view.summary.find(s => s.nota).caixa, 154.96);
  const row = view.cardAudit.rows.find(x => x.sale && x.sale.registro === '1227327');
  assert.ok(row.issues.includes('Venda POS: Cielo da Loja 5 não enviada'));
});

test('Relação geral com a Cielo de uma loja: só ela é conciliada e a Loja 5 acha as POS das outras', () => {
  const { caixa, lanc } = geral();
  const so4 = engine.reconcileStores(caixa, cielo(cieloLoja4), lanc);
  same(so4.views.map(v => v.nome), ['Loja 4']);
  same(so4.views[0].divergences.map(d => d.tipo), ['pos_sem_cielo', 'pos_sem_cielo']);
  same(so4.semCielo.map(s => s.nome), ['Loja 1', 'Loja 2', 'Loja 5']);

  const so5 = engine.reconcileStores(caixa, cielo(cieloLoja5), lanc);
  same(so5.views.map(v => v.nome), ['Loja 5']);
  assert.equal(so5.posEntreLojas.length, 3);
  same(so5.semCielo.map(s => [s.nome, s.posFora.length]), [['Loja 1', 1], ['Loja 2', 0], ['Loja 4', 2]]);
});

test('Cielo de uma loja com Relação de outra é recusada com explicação', () => {
  const { caixa, lanc } = geral();
  assert.throws(() => engine.reconcileStores(caixa.filter(t => t.loja === '1'), cielo(cieloLoja4), lanc), /A Cielo enviada é da Loja 4, mas a Relação de Vendas só tem vendas da Loja 1/);
});

test('POS só confirma pelo tempo da entrega quando a Cielo vem antes do caixa, até 3 horas', () => {
  const pos = { valor: 50, data: '2026-09-29', hora: '17:00', registro: '1', loja: '6' };
  const isPos = () => true;
  const antes = engine.matchCardTransactions([pos], [{ ...bank(50, '15:30'), data: '2026-09-29' }], { isPos });
  assert.equal(antes.matched[0].confidence, 'entrega');
  const depois = engine.matchCardTransactions([pos], [{ ...bank(50, '17:30'), data: '2026-09-29' }], { isPos });
  assert.equal(depois.matched[0].confidence, 'valor');
  const longe = engine.matchCardTransactions([pos], [{ ...bank(50, '13:30'), data: '2026-09-29' }], { isPos });
  assert.equal(longe.matched[0].confidence, 'valor');
  const tef = engine.matchCardTransactions([pos], [{ ...bank(50, '15:30'), data: '2026-09-29' }]);
  assert.equal(tef.matched[0].confidence, 'valor');
});

test('PIX continua conciliando recebimentos no próximo dia útil', () => {
  const result = engine.reconcile([{ ...sale(10, null), data: '2026-09-12', modalidade: 'PIX' }], [{ ...bank(10, null), data: '2026-09-14', modalidade: 'PIX', origem: 'Sicredi' }], []);
  assert.equal(result.divergences.length, 0);
});
test('PDF parcialmente reconhecido é bloqueado quando o total impresso difere', () => {
  assert.throws(() => engine.parseCaixaLines(['7-LOJA 7', '1406 Bal 1305 09/09/2026 07:02 1/ 1 53 0,0% Cartao Mag 38,48', 'Total Geral .....: 48,48']), /total impresso/);
  assert.throws(() => engine.parseCieloPdfLines(['2 R$ 48,48 -R$ 0,43 R$ 48,05', '09/09/2026 07:01 Débito Elo R$ 38,48 -R$ 0,33 R$ 38,15 Aprovada']), /totalizador/);
});
