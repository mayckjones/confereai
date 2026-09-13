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
  vm.runInContext(source.slice(0, source.indexOf("var dropzone =")) + '\nreturn { parseCardLaunchLines, aggregateCardLaunches, parseCaixaLines, parseCieloPdfLines, matchCardTransactions, buildCardAudit, reconcile }; };', context);
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
test('PIX continua conciliando recebimentos no próximo dia útil', () => {
  const result = engine.reconcile([{ ...sale(10, null), data: '2026-09-12', modalidade: 'PIX' }], [{ ...bank(10, null), data: '2026-09-14', modalidade: 'PIX', origem: 'Sicredi' }], []);
  assert.equal(result.divergences.length, 0);
});
test('PDF parcialmente reconhecido é bloqueado quando o total impresso difere', () => {
  assert.throws(() => engine.parseCaixaLines(['7-LOJA 7', '1406 Bal 1305 09/09/2026 07:02 1/ 1 53 0,0% Cartao Mag 38,48', 'Total Geral .....: 48,48']), /total impresso/);
  assert.throws(() => engine.parseCieloPdfLines(['2 R$ 48,48 -R$ 0,43 R$ 48,05', '09/09/2026 07:01 Débito Elo R$ 38,48 -R$ 0,33 R$ 38,15 Aprovada']), /totalizador/);
});
