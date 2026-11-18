const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function loadEngine(windowExtras = {}) {
  const elements = new Map();
  function element() {
    const result = {
      value: '', textContent: '', style: {}, dataset: {}, options: [], children: [], events: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(name, handler) { this.events[name] = handler; },
      appendChild(child) { this.children.push(child); this.options.push(child); },
      querySelector() { return element(); }, querySelectorAll() { return []; },
      focus() {}, click() { this.events.click?.(); }
    };
    Object.defineProperty(result, 'innerHTML', {
      get() { return this.html || ''; },
      set(value) { this.html = value; this.children = []; this.options = []; }
    });
    return result;
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element, querySelector() { return null; }
  };
  const context = vm.createContext({
    window: { addEventListener() {}, removeEventListener() {}, ...windowExtras }, document, console,
    showToast() {}, setTimeout() {},
  });
  const shared = fs.readFileSync(path.join(root, 'js/shared.js'), 'utf8');
  vm.runInContext(shared.slice(shared.indexOf('function fmtBRL')), context);
  const source = fs.readFileSync(path.join(root, 'ferramentas/recibos/recibos.js'), 'utf8');
  vm.runInContext(source.replace(/};\s*$/, `
    return { carregarRecibos, extrairRegistrosTabulares, gerarHtmlReciboParaPdf,
      gerarParagrafosReciboDocx, getRecibos: () => recibosList };
  };`), context);
  return { ...context.window.__tool_init_recibos(), elements };
}

const headers = ['VENDEDOR', 'CPF', 'VALOR', 'DATA', 'LOJA', 'CNPJ', 'TIPO DE RECIBO'];
const row = tipo => ['VENDEDORA TESTE', '081.895.754-90', 200, '09/10/2026', 3, '15.045.542/0001-58', tipo];
const commission = 'Referente a comissão no período de xx/xx/xxxx a xx/xx/xxxx';
const award = 'Referente a premiação de meta do mês de xx/xx/xxxx';
const standard = 'Referente a dobra e alimentação no fim de semana';

test('planilhas antigas e tipo vazio preservam o modelo padrão e os dados', () => {
  for (const rows of [[headers.slice(0, 6), row('').slice(0, 6)], [headers, row('')]]) {
    const engine = loadEngine();
    engine.carregarRecibos(engine.extrairRegistrosTabulares(rows), 'recibos.xlsx');
    const [receipt] = engine.getRecibos();
    assert.equal(receipt.tipoRecibo, '');
    assert.equal(receipt.referente, standard);
    assert.equal(receipt.data, '09/10/2026');
    assert.equal(receipt.valor, 200);
    assert.equal(receipt.cpf, '081.895.754-90');
    assert.equal(receipt.cnpj, '15.045.542/0001-58');
  }
});

test('lote misto escolhe motivos dos PDFs com períodos em branco e mantém a data de pagamento', () => {
  const engine = loadEngine();
  engine.carregarRecibos(engine.extrairRegistrosTabulares([
    headers, row(''), row(' COMISSÃO '), row('premiacao'), row('comissção'), row('Premiação')
  ]), 'recibos.xlsx');
  assert.deepEqual(Array.from(engine.getRecibos(), r => r.referente), [standard, commission, award, commission, award]);
  assert.ok(engine.getRecibos().every(r => r.data === '09/10/2026'));
  for (const receipt of engine.getRecibos()) {
    const html = engine.gerarHtmlReciboParaPdf(receipt);
    assert.ok(html.includes(receipt.referente));
    assert.ok(html.includes('nesta data <strong>09/10/2026</strong>'));
    assert.ok(html.includes(receipt.emissao));
  }
  const select = engine.elements.get('selectReceiptDropdown');
  select.value = '1';
  select.events.change();
  assert.equal(engine.elements.get('viewReferente').textContent, commission);
  assert.equal(engine.elements.get('viewData').textContent, '09/10/2026');
});

test('tipo é identificado pelo cabeçalho quando as colunas mudam de posição', () => {
  const engine = loadEngine();
  const rows = [['Tipo de Recibo', 'Data', 'Valor', 'Vendedor'], ['Comissão', '09/10/2026', 200, 'VENDEDORA TESTE']];
  engine.carregarRecibos(engine.extrairRegistrosTabulares(rows), 'recibos.xlsx');
  assert.equal(engine.getRecibos()[0].referente, commission);
});

test('mestre preserva motivos dos tipos e mudança individual atualiza prévia e impressão', () => {
  const engine = loadEngine();
  engine.carregarRecibos(engine.extrairRegistrosTabulares([headers, row(''), row('Comissão'), row('Premiação')]), 'recibos.xlsx');
  engine.elements.get('mestreReferente').value = 'Motivo padrão editado';
  engine.elements.get('mestreEmpresa').value = 'EMPRESA TESTE';
  engine.elements.get('mestreEmissao').value = 'Maceió, 11 de Outubro de 2026.';
  engine.elements.get('btnApplyMestre').click();
  assert.deepEqual(Array.from(engine.getRecibos(), r => r.referente), ['Motivo padrão editado', commission, award]);
  assert.ok(engine.getRecibos().every(r => r.empresa === 'EMPRESA TESTE'));
  const type = engine.elements.get('editTipoRecibo');
  type.value = 'premiacao';
  type.events.change();
  assert.equal(engine.getRecibos()[0].referente, award);
  assert.equal(engine.elements.get('viewReferente').textContent, award);
  assert.ok(engine.elements.get('printAllContainer').children[0].innerHTML.includes(award));
});

test('Word recebe os mesmos motivos e datas de pagamento', () => {
  const engine = loadEngine();
  class Node { constructor(options) { this.options = options; } }
  const docx = {
    Paragraph: Node, TextRun: Node, Table: Node, TableRow: Node, TableCell: Node,
    AlignmentType: {}, WidthType: {}, BorderStyle: {},
  };
  engine.carregarRecibos(engine.extrairRegistrosTabulares([headers, row('Comissão'), row('Premiação')]), 'recibos.xlsx');
  for (const receipt of engine.getRecibos()) {
    const document = JSON.stringify(engine.gerarParagrafosReciboDocx(docx, receipt));
    assert.ok(document.includes('RECIBO Nº'));
    assert.ok(document.includes(receipt.numero));
    assert.ok(document.includes(receipt.referente));
    assert.ok(document.includes('09/10/2026'));
    assert.ok(document.includes(receipt.emissao));
  }
});

// Número do recibo: 1 letra (sem I e O) + 4 números.
const formatoNumero = /^[A-HJ-NP-Z]\d{4}$/;

test('cada recibo recebe um número sorteado, sem repetir no lote nem ao carregar de novo', () => {
  const engine = loadEngine();
  const linhas = Array.from({ length: 300 }, () => row(''));
  engine.carregarRecibos(engine.extrairRegistrosTabulares([headers, ...linhas]), 'recibos.xlsx');
  const primeiros = engine.getRecibos().map(r => r.numero);
  assert.ok(primeiros.every(n => formatoNumero.test(n)), 'formato letra + 4 números');
  assert.equal(new Set(primeiros).size, 300, 'nenhum repetido no lote');
  // Não é sequência: os números de recibos seguidos não andam de 1 em 1.
  const proximo = n => n[0] + String(Number(n.slice(1)) + 1).padStart(4, '0');
  const emSequencia = primeiros.slice(1).filter((n, i) => n === proximo(primeiros[i])).length;
  assert.ok(emSequencia < 5);

  // Anexar os mesmos dados de novo gera números novos.
  engine.carregarRecibos(engine.extrairRegistrosTabulares([headers, ...linhas]), 'recibos.xlsx');
  const segundos = engine.getRecibos().map(r => r.numero);
  assert.ok(segundos.every(n => !primeiros.includes(n)));
});

test('botão sorteia novo número e atualiza prévia, tabela, PDF e impressão', () => {
  const engine = loadEngine();
  engine.carregarRecibos(engine.extrairRegistrosTabulares([headers, row('')]), 'recibos.xlsx');
  const antes = engine.getRecibos()[0].numero;
  assert.equal(engine.elements.get('viewNumero').textContent, antes);
  assert.equal(engine.elements.get('editNumeroRecibo').textContent, antes);

  engine.elements.get('btnNovoNumeroRecibo').click();
  const depois = engine.getRecibos()[0].numero;
  assert.match(depois, formatoNumero);
  assert.notEqual(depois, antes);
  assert.equal(engine.elements.get('viewNumero').textContent, depois);
  assert.equal(engine.elements.get('editNumeroRecibo').textContent, depois);
  assert.ok(engine.elements.get('recibosTableBody').children[0].innerHTML.includes(depois));
  const impressao = engine.elements.get('printAllContainer').children[0].innerHTML;
  assert.ok(impressao.includes('RECIBO Nº') && impressao.includes(depois));
});

test('números guardados no navegador nunca são sorteados de novo', async () => {
  const guardado = { 'confereai-recibos-numeros-usados': 'A0000,B0000' };
  const localStorage = { getItem: k => guardado[k] ?? null, setItem: (k, v) => { guardado[k] = v; } };
  // Sorteios forçados: 0 → A0000 (já usado), 10000 → B0000 (já usado), 80001 → J0001.
  const sorteios = [0, 10000, 80001];
  const crypto = { getRandomValues: arr => { arr[0] = sorteios.shift(); return arr; } };
  const engine = loadEngine({ localStorage, crypto });
  engine.carregarRecibos(engine.extrairRegistrosTabulares([headers, row('')]), 'recibos.xlsx');
  assert.equal(engine.getRecibos()[0].numero, 'J0001', 'pula os usados; a letra I não existe');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(guardado['confereai-recibos-numeros-usados'].split(',').sort(), ['A0000', 'B0000', 'J0001']);
});
