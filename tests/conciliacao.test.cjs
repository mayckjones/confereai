const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function loadEngine(extra = {}){
  const context = vm.createContext({ window: {}, pdfjsLib: { GlobalWorkerOptions: {} }, console, ...extra });
  const shared = fs.readFileSync(path.join(root, 'js/shared.js'), 'utf8');
  vm.runInContext(shared.slice(shared.indexOf('function fmtBRL')), context);
  const source = fs.readFileSync(path.join(root, 'ferramentas/conciliacao/conciliacao.js'), 'utf8');
  vm.runInContext(source.slice(0, source.indexOf("var dropzone =")) + '\n' + source.slice(source.indexOf('function buildCardGroups('), source.indexOf('function cardGroups(')) + '\nreturn { state, parseCardMatrix, parseCielo, detectXlsxType, receiptMeta, cardSourceLabel, normalizeLaunchDates, dateMeta, normalizarLoja, storeIdentity, storeMeta, appendStoreAudit, brandLabel, paymentLabel, parseCardLaunchLines, aggregateCardLaunches, parseCaixaLines, parseCieloPdfLines, matchCardTransactions, buildCardAudit, cardRangeWarning, buildCardGroups, buildCardChannelGroups, buildStoreRuns, reconcile }; };', context);
  return context.window.__tool_init_conciliacao();
}
module.exports = { loadEngine };

const engine = loadEngine();

const cardHeader = ['Data da venda', 'Hora da venda', 'Código de autorização', 'Código do estabelecimento', 'Modalidade', 'Produto', 'Parcelas', 'Bandeira', 'Canal', 'Valor bruto transação', 'Valor bruto da parcela', 'Valor da taxa (MDR)', 'Valor líquido da parcela/transação', 'Status', 'Número do terminal', 'Comprovante de venda'];
const cardRow = (changes = {}) => {
  const values = ['06/10/2026', ' 10:00:30', 'ABC123', '44260107', 'Crédito', 'Crédito a Vista', '-', 'Visa', 'TEF IP', 10, 10, 0.1, 9.9, 'Aprovada', 'TFI09E52', '001025078'];
  Object.entries(changes).forEach(([column, value]) => { values[Number(column)] = value; });
  return values;
};

test('Excel da conta compartilhada consolida parcelas sem duplicar bruto e preserva células originais', () => {
  const rows = [cardHeader, cardRow({ 6: '1 de 2', 9: 101.97, 10: 50.99, 11: 0.76, 12: 50.23 }), cardRow({ 6: '2 de 2', 9: 101.97, 10: 50.98, 11: 0.76, 12: 50.22 })];
  const before = JSON.stringify(rows);
  const [tx] = engine.parseCardMatrix(rows, 'relatorio lj 2.xlsx', 'Sheet1');
  assert.equal(tx.valor, 101.97);
  assert.equal(tx.valorLiquido, 100.45);
  assert.equal(tx.taxa, 1.52);
  assert.equal(tx.parcelas, 2);
  assert.equal(tx.lojaCanonica, '2');
  assert.equal(tx.canal, 'TEF');
  assert.equal(tx.canalOriginal, 'TEF IP');
  assert.equal(tx.comprovante, '001025078');
  assert.equal(tx.linhasOriginais.length, 2);
  assert.equal(tx.linhasOriginais[0].linha, 2);
  assert.equal(tx.linhasOriginais[1].parcelaOriginal, '2 de 2');
  assert.equal(JSON.stringify(tx.linhasOriginais[0].celulas), JSON.stringify(rows[1]));
  assert.equal(JSON.stringify(rows), before);
  assert.ok(engine.receiptMeta(tx).includes('Conta da Loja 2'));
});

test('Excel ignora status não aprovados e evita juntar comprovantes de terminais diferentes', () => {
  const transactions = engine.parseCardMatrix([cardHeader,
    cardRow(), cardRow({ 14: 'APT0NR6Y', 8: 'APOS Sitef' }),
    ...['Recusada', 'Desfeita', 'Autorizada', 'Cancelada'].map(status => cardRow({ 13: status }))
  ]);
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].lojaCanonica, '2');
  assert.equal(transactions[1].lojaCanonica, 'LOJA_MEG_4');
  assert.equal(transactions[1].canal, 'POS');
});

test('parcelas faltantes, repetidas ou inconsistentes não produzem totais falsos', () => {
  const first = cardRow({ 6: '1 de 2', 9: 20, 10: 10 });
  const second = cardRow({ 6: '2 de 2', 9: 20, 10: 10 });
  assert.throws(() => engine.parseCardMatrix([cardHeader, first]), /incompletas/);
  assert.throws(() => engine.parseCardMatrix([cardHeader, first, first]), /repetida/);
  assert.throws(() => engine.parseCardMatrix([cardHeader, first, cardRow({ 6: '2 de 2', 9: 20, 10: 9 })]), /total incompatível/);
  assert.throws(() => engine.parseCardMatrix([cardHeader, first, cardRow({ 6: '2 de 2', 9: 30, 10: 10 })]), /incompatíveis/);
  assert.equal(engine.parseCardMatrix([cardHeader, first, second]).length, 1);
});

test('loja 2 entra na conciliação e POS da conta compartilhada fica na aba da Loja 7 MEG 4', () => {
  const excel = engine.parseCardMatrix([cardHeader, cardRow(), cardRow({ 14: 'APT0NR6Y', 8: 'APOS Sitef', 9: 20, 10: 20, 15: '000000017' })]);
  const sales = [
    { ...sale(10, '10:00', '2'), data: '2026-10-06', loja: '2' },
    { ...sale(20, '10:00', '4'), data: '2026-10-06', loja: '7' },
    { ...sale(30, '11:00', '7'), data: '2026-10-06', loja: '4' }
  ];
  const cielo = [{ ...bank(30, '11:00'), data: '2026-10-06', estabelecimento: '3002105343' }];
  const before = JSON.stringify({ sales, excel, cielo });
  const runs = engine.buildStoreRuns(sales, cielo.concat(excel), []);
  assert.deepEqual(Array.from(runs, run => run.store), ['2', 'LOJA_MEG_4']);
  assert.equal(runs[0].summary[0].caixa, 10);
  assert.equal(runs[0].summary[0].banco, 10);
  assert.equal(runs[1].summary[0].caixa, 50);
  assert.equal(runs[1].summary[0].banco, 50);
  assert.equal(runs[1].parsed.cielo.length, 2);
  assert.equal(runs[1].parsed.cielo.find(tx => tx.terminal).estabelecimento, '44260107');
  assert.ok(runs.every(run => run.divergences.length === 0));
  assert.equal(engine.cardSourceLabel(runs[1].parsed.cielo), 'Cartões (Cielo + Excel)');
  assert.equal(JSON.stringify({ sales, excel, cielo }), before);
  assert.notEqual(engine.normalizarLoja('2'), engine.normalizarLoja('4'));
});

test('terminal sem cadastro ou canal conflitante na conta compartilhada exige conferência', () => {
  const sales = [{ ...sale(10, '10:00'), data: '2026-10-06', loja: '2' }];
  const unknown = engine.parseCardMatrix([cardHeader, cardRow({ 14: 'DESCONHECIDO' })]);
  assert.equal(engine.storeIdentity(unknown[0]), '');
  assert.equal(engine.matchCardTransactions(sales, unknown).matched.length, 0);
  assert.throws(() => engine.buildStoreRuns(sales, unknown, []), /Terminal DESCONHECIDO/);
  const conflict = engine.parseCardMatrix([cardHeader, cardRow({ 8: 'APOS Sitef' })]);
  assert.throws(() => engine.buildStoreRuns(sales, conflict, []), /Canal incompatível/);
});

test('planilha é detectada por conteúdo e pode ser lida em aba posterior à capa', async () => {
  const matrix = [cardHeader, cardRow()];
  const workbook = { SheetNames: ['Capa', 'Vendas'], Sheets: { Capa: [['Relatório']], Vendas: matrix } };
  const parser = loadEngine({ XLSX: { read: () => workbook, utils: { sheet_to_json: sheet => sheet } } });
  const file = { name: 'relatorio lj 2.xlsx', arrayBuffer: async () => new ArrayBuffer(0) };
  assert.equal(await parser.detectXlsxType(file), 'cartoesExcel');
  const [tx] = await parser.parseCielo(file);
  assert.equal(tx.lojaCanonica, '2');
  assert.equal(tx.arquivo, file.name);
  assert.equal(tx.aba, 'Vendas');
});

test('formato tradicional de Excel Cielo continua sendo reconhecido', async () => {
  const matrix = [['Data da venda', 'Hora da venda', 'Forma de pagamento', 'Valor bruto', 'Valor líquido', 'Bandeira', 'Parcelas', 'Status'], ['06/10/2026', '10:00', 'Crédito', 10, 9.9, 'Visa', 1, 'Aprovada']];
  const parser = loadEngine({ XLSX: { read: () => ({ SheetNames: ['Vendas'], Sheets: { Vendas: matrix } }), utils: { sheet_to_json: sheet => sheet } } });
  const file = { name: 'cielo.xlsx', arrayBuffer: async () => new ArrayBuffer(0) };
  assert.equal(await parser.detectXlsxType(file), 'cielo');
  const [tx] = await parser.parseCielo(file);
  assert.equal(tx.valor, 10);
  assert.equal(tx.origem, 'Cielo');
  assert.equal(tx.bandeira, 'Visa');
});

test('exportação conserva todas as parcelas originais e a conta de destino', () => {
  const sheets = [];
  const parser = loadEngine({ XLSX: { utils: { json_to_sheet: rows => rows, book_append_sheet: (wb, rows, name) => sheets.push({ rows, name }) } } });
  const rows = [cardHeader, cardRow({ 14: 'APT0NR6Y', 8: 'APOS Sitef', 6: '1 de 2', 9: 20, 10: 10 }), cardRow({ 14: 'APT0NR6Y', 8: 'APOS Sitef', 6: '2 de 2', 9: 20, 10: 10 })];
  parser.state.parsed.cielo = parser.parseCardMatrix(rows, 'conta.xlsx', 'Vendas');
  parser.appendStoreAudit({});
  assert.equal(sheets[0].rows.length, 2);
  assert.ok(sheets[0].rows.every(row => row['Loja canonica'] === 'LOJA_MEG_4' && row['Conta de recebimento'] === 'Conta da Loja 2' && row.Terminal === 'APT0NR6Y'));
  assert.equal(sheets[0].rows[1]['Parcela original'], '2 de 2');
  assert.equal(sheets[0].rows[1]['Celulas originais'], JSON.stringify(rows[2]));
});

test('período invertido e emissão em cabeçalhos repetidos não mudam a data das vendas', () => {
  const header = ['Emissao: 07/10/2026', '** Período: 10/06/26 a 10/06/26 ** Forma Pagto.: CARTÃO MAGNÉTICO'];
  const rows = ['1427 Bal 342150 06/10/2026 10:00 3/ 1 53 0,0% Cartao Mag 10,00', '1428 Bal 342151 06/10/2026 11:00 3/ 1 53 0,0% Cartao Mag 20,00'];
  const sales = engine.parseCaixaLines([...header, '1-LOJA 1', rows[0], ...header, rows[1], 'Total Geral...: 30,00']);
  assert.equal(sales.length, 2);
  assert.ok(sales.every(tx => tx.data === '2026-10-06'));
  assert.deepEqual(Array.from(sales, tx => tx.raw), rows);
});

test('inversão do Infarma é corrigida na cópia para conciliação com evidências concordantes', () => {
  const period = 'Periodo: 06/10/2026 a 06/10/2026 ** Loja: <Todas>';
  const raw = '1 - MASTERCARD 1427 1 10,00 0,00 10,00 000123';
  const launches = engine.parseCardLaunchLines([period, '1-LOJA 1', '10/06/2026', raw]);
  const sales = [{ ...sale(10, '10:00'), data: '2026-10-06', loja: '1' }];
  const banks = [{ ...bank(10, '10:00'), data: '2026-10-06', parcelas: 1, estabelecimento: '1029024402' }];
  const before = JSON.stringify(launches);
  const normalized = engine.normalizeLaunchDates(sales, banks, launches);
  assert.equal(normalized[0].data, '2026-10-06');
  assert.equal(normalized[0].dataOriginal, '10/06/2026');
  assert.equal(normalized[0].periodoOriginal, period);
  assert.equal(normalized[0].raw, raw);
  assert.match(engine.dateMeta(normalized[0]), /10\/06\/2026/);
  const [run] = engine.buildStoreRuns(sales, banks, launches);
  assert.equal(run.cardAudit.rows[0].issues.length, 0);
  assert.equal(run.divergences.length, 0);
  assert.equal(run.parsed.lancamentos[0].data, '2026-10-06');
  const audit = engine.buildCardAudit(sales, launches, banks, engine.matchCardTransactions(sales, banks));
  assert.equal(audit.rows[0].internalOK, true);
  assert.equal(JSON.stringify(launches), before);
  assert.equal(engine.normalizeLaunchDates(sales, banks, normalized)[0], normalized[0]);
});

test('datas realmente distintas, ou sem confirmação independente, continuam bloqueadas', () => {
  const launches = engine.parseCardLaunchLines(['Periodo: 06/10/2026 a 06/10/2026 ** Loja: 1-LOJA 1', '10/06/2026', '1 - MASTERCARD 1427 1 10,00 0,00 10,00 000123']);
  const sales = [{ ...sale(10, '10:00'), data: '2026-10-06', loja: '1' }];
  const banks = [{ ...bank(10, '10:00'), data: '2026-10-06', estabelecimento: '1029024402' }];
  for(const altered of [
    { ...launches[0], data: '2026-10-05' },
    { ...launches[0], periodoInicio: '2026-06-10', periodoFim: '2026-06-10' },
    { ...launches[0], periodoInicio: null, periodoFim: null }
  ]){
    assert.equal(engine.normalizeLaunchDates(sales, banks, [altered])[0], altered);
    assert.throws(() => engine.buildStoreRuns(sales, banks, [altered]), /Relação: 06\/10\/2026; Cielo: 06\/10\/2026; Lançamentos:/);
  }
  assert.equal(engine.normalizeLaunchDates(sales, [{ ...banks[0], data: '2026-10-05' }], launches)[0], launches[0]);
  assert.equal(engine.normalizeLaunchDates(sales, [], launches)[0], launches[0]);
  assert.equal(engine.normalizeLaunchDates([...sales, { ...sales[0], data: '2026-10-05' }], banks, launches)[0], launches[0]);
});

test('normalização usa apenas os aliases cadastrados e preserva lojas desconhecidas', () => {
  for(const alias of ['4', 'LOJA 4', '7', 'LOJA 7', 'LOJA 7 MEG 4', 'MEG 4', '4 - LOJA 4 GONC 1', '7 - LOJA 7 MEG 4', 'LOJA_MEG_4']){
    assert.equal(engine.normalizarLoja(alias), 'LOJA_MEG_4');
  }
  for(const alias of ['5', 'LOJA 5', '6', 'LOJA 6', 'LOJA 6 MEG 5', 'MEG 5', '5 - LOJA 5 GONC 2', '6 - LOJA 6 MEG 5']){
    assert.equal(engine.normalizarLoja(alias), 'LOJA_MEG_5');
  }
  for(const code of ['1', '2', '3', '8', '17']){
    assert.equal(engine.normalizarLoja(code), code);
    assert.equal(engine.normalizarLoja(`${code} - LOJA ${code}`), code);
  }
  for(const name of ['Filial sem cadastro', 'LOJA 8', 'MEG 14', 'LOJA 74', 'LOJA 4 OUTRA']){
    assert.equal(engine.normalizarLoja(name), name);
  }
  assert.equal(engine.normalizarLoja('  loja 7 meg 4  '), 'LOJA_MEG_4');
});

test('aliases conciliam Lançamentos, Relação e Cielo nos dois sentidos sem alterar a origem', () => {
  for(const [oldCode, currentCode, suffix, establishment, canonical] of [
    ['4', '7', 'MEG 4', '3002105343', 'LOJA_MEG_4'],
    ['5', '6', 'MEG 5', '2800327299', 'LOJA_MEG_5']
  ]){
    for(const reverse of [false, true]){
      const headers = [`${oldCode} - LOJA ${oldCode} GONC ${oldCode === '4' ? '1' : '2'}`, `${currentCode} - LOJA ${currentCode} ${suffix}`];
      const launchHeader = headers[reverse ? 1 : 0], saleHeader = headers[reverse ? 0 : 1];
      const launchRow = '1 - MASTERCARD 1427 1 10,00 0,00 10,00 000123';
      const saleRow = '1427 Bal 342150 09/09/2026 10:00 3/ 1 53 0,0% Cartao Mag 10,00';
      const launches = engine.parseCardLaunchLines([`Periodo: 09/09/2026 a 09/09/2026 ** Loja: ${launchHeader}`, '09/09/2026', launchRow]);
      const sales = engine.parseCaixaLines([saleHeader, saleRow]);
      const banks = [{ ...bank(10, '10:00'), parcelas: 1, estabelecimento: establishment }];
      const before = JSON.stringify({ launches, sales, banks });
      const [run] = engine.buildStoreRuns(sales, banks, launches);
      assert.equal(run.store, canonical);
      assert.equal(run.cardAudit.rows.length, 1);
      assert.equal(run.cardAudit.rows[0].internalOK, true);
      assert.equal(run.cardAudit.rows[0].issues.length, 0);
      assert.equal(run.divergences.length, 0);
      assert.equal(run.summary[0].caixa, 10);
      assert.equal(run.summary[0].banco, 10);
      assert.equal(sales[0].lojaOriginal, saleHeader);
      assert.equal(launches[0].lojaOriginal, launchHeader);
      assert.equal(sales[0].raw, saleRow);
      assert.equal(launches[0].raw, launchRow);
      assert.equal(sales[0].lojaCanonica, canonical);
      assert.equal(launches[0].lojaCanonica, canonical);
      assert.equal(JSON.stringify({ launches, sales, banks }), before);
      assert.match(engine.storeMeta(sales[0]), /Identificada no arquivo como:/);
      assert.ok(engine.storeMeta(sales[0]).includes(saleHeader));
    }
  }
});

test('agrupamentos e registros repetidos usam identidade canônica sem misturar outras lojas', () => {
  const lines = engine.parseCardLaunchLines(launchFixture);
  assert.equal(engine.aggregateCardLaunches([lines[0], { ...lines[1], loja: '4' }]).length, 1);
  const a = sale(184.95, '08:49');
  const duplicate = { ...a, loja: '4' };
  const audit = engine.buildCardAudit([a, duplicate], lines, [], { matched: [], divergValor: [], sobras: [] });
  assert.ok(audit.rows[0].issues.includes('Registro repetido na Relação'));
  assert.equal(engine.aggregateCardLaunches([lines[0], { ...lines[1], loja: '3' }]).length, 2);
});

test('mesmos valores e horários de unidades diferentes não cruzam na Cielo', () => {
  const sales = [{ ...sale(10, '10:00'), loja: '4' }, { ...sale(10, '10:00'), loja: '5' }];
  const banks = [{ ...bank(10, '10:00'), estabelecimento: '2800327299' }, { ...bank(10, '10:00'), estabelecimento: '3002105343' }];
  const result = engine.matchCardTransactions(sales, banks);
  assert.equal(result.matched.length, 2);
  assert.equal(result.matched.find(pair => pair.caixa === sales[0]).banco, banks[1]);
  assert.equal(result.matched.find(pair => pair.caixa === sales[1]).banco, banks[0]);
  assert.equal(engine.matchCardTransactions([sales[0]], [banks[0]]).matched.length, 0);
});

test('códigos antigos e atuais na mesma Relação geram uma aba e total por unidade', () => {
  const sales = ['4', '7', '5', '6', '1', '3'].map((loja, i) => ({ ...sale(10, '10:00', String(i)), loja }));
  const establishments = ['3002105343', '3002105343', '2800327299', '2800327299', '1029024402', '1040788502'];
  const banks = sales.map((tx, i) => ({ ...bank(10, '10:00'), estabelecimento: establishments[i], hora: `10:0${i}` }));
  sales.forEach((tx, i) => { tx.hora = banks[i].hora; });
  const runs = engine.buildStoreRuns(sales, banks, []);
  assert.equal(runs.length, 4);
  assert.deepEqual(Array.from(runs, run => run.store), ['1', '3', 'LOJA_MEG_4', 'LOJA_MEG_5']);
  for(const id of ['LOJA_MEG_4', 'LOJA_MEG_5']){
    const run = runs.find(run => run.store === id);
    assert.equal(run.parsed.caixa.length, 2);
    assert.equal(run.summary[0].caixa, 20);
    assert.equal(run.summary[0].banco, 20);
    assert.equal(run.divergences.length, 0);
  }
});

test('loja desconhecida permanece conciliável pelo código original', () => {
  const sales = [{ ...sale(10, '10:00'), loja: '8' }];
  const launches = engine.parseCardLaunchLines(['8 - LOJA 8', '09/09/2026', '1 - MASTERCARD 1427 1 10,00 0,00 10,00 000123']);
  const banks = [{ ...bank(10, '10:00'), parcelas: 1 }];
  const result = engine.reconcile(sales, [], banks);
  const audit = engine.buildCardAudit(sales, launches, banks, result.pairs);
  assert.equal(result.divergences.length, 0);
  assert.equal(audit.rows[0].internalOK, true);
  assert.equal(audit.rows[0].issues.length, 0);
  assert.equal(launches[0].loja, '8');
  assert.equal(launches[0].lojaCanonica, '8');
});

test('Excel inclui a identidade canônica, o nome atual e os identificadores originais', () => {
  const sheets = [];
  const exported = loadEngine({ XLSX: { utils: { json_to_sheet: rows => rows, book_append_sheet: (wb, rows, name) => sheets.push({ rows, name }) } } });
  const tx = { loja: '4', lojaOriginal: '4 - LOJA 4 GONC 1', raw: 'linha original', registro: '123' };
  exported.state.parsed.caixa = [tx];
  exported.appendStoreAudit({});
  assert.equal(sheets[0].name, 'Origem das lojas');
  assert.equal(sheets[0].rows[0]['Loja canonica'], 'LOJA_MEG_4');
  assert.equal(sheets[0].rows[0]['Loja atual'], 'Loja 7 MEG 4');
  assert.equal(sheets[0].rows[0]['Loja original'], tx.lojaOriginal);
  assert.equal(sheets[0].rows[0]['Linha original'], tx.raw);
  assert.equal(tx.loja, '4');
});
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
test('venda sem Lançamento permanece na conciliação de valores e nos totais do sistema', () => {
  const covered = sale(184.95, '08:49');
  const uncovered = sale(10, '09:00', '9999');
  const cielo = [bank(184.95, '08:49'), bank(10, '09:00')];
  const result = engine.reconcile([covered, uncovered], [], cielo);
  const audit = engine.buildCardAudit([covered, uncovered], engine.parseCardLaunchLines(launchFixture), cielo, result.pairs);
  const categories = engine.buildCardGroups(audit, cielo);
  assert.equal(result.divergences.length, 0);
  assert.equal(result.summary[0].caixa, 194.95);
  assert.equal(audit.rows.length, 2);
  assert.ok(audit.rows.find(row => row.sale === uncovered).issues.includes('Sem lançamento interno'));
  assert.equal(categories.reduce((sum, group) => sum + group.sistema, 0), 19495);
  assert.equal(categories.find(group => group.categoria.startsWith('Não identificada')).sistema, 1000);
});
test('quatro extratos Cielo geram quatro lojas isoladas e excluem a loja 2', () => {
  const stores = ['1', '2', '3', '6', '7'];
  const establishments = { '1': '1029024402', '3': '1040788502', '6': '2800327299', '7': '3002105343' };
  const sales = stores.map((store, index) => ({ ...sale(10 + index, '10:00', String(index + 1)), loja: store }));
  const cielo = stores.filter(store => store !== '2').map(store => {
    const matchingSale = sales.find(item => item.loja === store);
    return { ...bank(matchingSale.valor, '10:00'), estabelecimento: establishments[store] };
  });
  const launches = [{ ...engine.parseCardLaunchLines(launchFixture)[0], loja: '1', registro: '1', parcelas: 1 }];
  const runs = engine.buildStoreRuns(sales, cielo, launches);
  assert.deepEqual(Array.from(runs, run => run.label), ['Loja 1', 'Loja 3', 'Loja 7 MEG 4', 'Loja 6 MEG 5']);
  assert.equal(runs.reduce((sum, run) => sum + run.parsed.caixa.length, 0), 4);
  assert.ok(runs.every(run => run.divergences.length === 0));
  assert.ok(runs.every(run => run.cardAudit));
  assert.ok(runs.find(run => run.store === '3').cardAudit.rows[0].issues.includes('Sem lançamento interno'));
  assert.throws(() => engine.buildStoreRuns(sales, cielo.slice(1), launches), /Falta o relatório Cielo/);
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
  assert.match(warning.detail, /A adquirente também informa 2x/);
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
test('PIX continua conciliando recebimentos no próximo dia útil', () => {
  const result = engine.reconcile([{ ...sale(10, null), data: '2026-09-12', modalidade: 'PIX' }], [{ ...bank(10, null), data: '2026-09-14', modalidade: 'PIX', origem: 'Sicredi' }], []);
  assert.equal(result.divergences.length, 0);
});
test('PDF parcialmente reconhecido é bloqueado quando o total impresso difere', () => {
  assert.throws(() => engine.parseCaixaLines(['7-LOJA 7', '1406 Bal 1305 09/09/2026 07:02 1/ 1 53 0,0% Cartao Mag 38,48', 'Total Geral .....: 48,48']), /total impresso/);
  assert.throws(() => engine.parseCieloPdfLines(['2 R$ 48,48 -R$ 0,43 R$ 48,05', '09/09/2026 07:01 Débito Elo R$ 38,48 -R$ 0,33 R$ 38,15 Aprovada']), /totalizador/);
});
