const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function loadEngine(){
  const context = vm.createContext({ window: {}, console });
  const source = fs.readFileSync(path.join(root, 'ferramentas/precificacao/precificacao.js'), 'utf8');
  const engine = source.slice(0, source.indexOf('/* ======================== INTERFACE'));
  vm.runInContext(engine + '\nreturn { LAYOUT, TEMPLATE_HEADERS, TEMPLATE_EXAMPLES, parseSheetMatrix, parsePrice, formatPrice, gtinValido, analyzeRow, expandLabels, paginate, pageHeightMm, summarize, fitText, textWidth, pdfString, drawLabel, drawPage, buildPdf }; };', context);
  return context.window.__tool_init_precificacao();
}
module.exports = { loadEngine };

const engine = loadEngine();
const templateRows = () => engine.parseSheetMatrix([engine.TEMPLATE_HEADERS, ...engine.TEMPLATE_EXAMPLES]).rows;
const logoStub = { largura: 680, altura: 591, rgb: new Uint8Array([120, 156, 3, 0, 0, 0, 0, 1]), alfa: new Uint8Array([120, 156, 3, 0, 0, 0, 0, 1]) };

// Coordenadas extraídas de "Etiqueta OFICIAL.pdf" (primeira etiqueta da folha).
function numbersNear(content, pattern, expected, tolerance = 0.002){
  const match = content.match(pattern);
  assert.ok(match, 'não encontrou ' + pattern);
  match.slice(1).map(Number).forEach((value, i) => assert.ok(Math.abs(value - expected[i]) <= tolerance, `${pattern}: ${value} ≠ ${expected[i]}`));
}

test('planilha modelo é lida com colunas, códigos e preços', () => {
  const rows = templateRows();
  assert.equal(rows.length, 6);
  assert.deepEqual({ ...rows[0] }, { descricao: 'FRALDA INFANTIL G C/30', codigo: '42118', ean: '7896100542037', de: '59,90', por: '47,90', qtd: '1' });
  assert.ok(engine.TEMPLATE_EXAMPLES.every(row => engine.gtinValido(row[2])));
});

test('cabeçalhos com outros nomes, números do Excel e linhas vazias', () => {
  const { rows, headerRow } = engine.parseSheetMatrix([
    ['Lista de preços da semana'], [],
    ['Produto', 'Cód', 'EAN', 'De (R$)', 'Por (R$)', 'Qtd'],
    ['dipirona 500mg', 10432, 7891058112349, 'R$ 8,99', 5.99, 2],
    ['', '', '', '', '', ''],
    ['Sabonete', '', '', '', '3,5', '']
  ]);
  assert.equal(headerRow, 3);
  assert.equal(rows.length, 2);
  assert.deepEqual({ ...rows[0] }, { descricao: 'dipirona 500mg', codigo: '10432', ean: '7891058112349', de: '8,99', por: '5,99', qtd: '2' });
  assert.deepEqual({ ...rows[1] }, { descricao: 'Sabonete', codigo: '', ean: '', de: '', por: '3,50', qtd: '' });
  assert.throws(() => engine.parseSheetMatrix([['Nome', 'Valor unitário'], ['X', 1]]), /DESCRIÇÃO e PREÇO POR/);
});

test('preços em formato brasileiro', () => {
  assert.equal(engine.formatPrice(47.9), 'R$47,90');
  assert.equal(engine.formatPrice(1299.9), 'R$1.299,90');
  assert.equal(engine.formatPrice(5), 'R$5,00');
  assert.equal(engine.parsePrice('1.299,90'), 1299.9);
  assert.equal(engine.parsePrice('R$ 47,9'), 47.9);
  assert.equal(engine.parsePrice('47.90'), 47.9);
  assert.equal(engine.parsePrice('1.299'), 1299);
  assert.equal(engine.parsePrice('abc'), null);
  assert.equal(engine.parsePrice(''), null);
});

test('quantidade define quantas etiquetas saem e a última folha encolhe', () => {
  const rows = [
    { descricao: 'A', por: '1,00', qtd: '3' },
    { descricao: 'B', por: '2,00', qtd: '' },
    { descricao: 'C', por: '3,00', qtd: '0' },
    { descricao: 'D', por: '', qtd: '5' },
    { descricao: 'E', por: '5,00', qtd: '4' }
  ];
  const labels = engine.expandLabels(rows);
  assert.deepEqual(labels.map(l => l.descricao).join(''), 'AAABEEEE');
  assert.deepEqual(Array.from(engine.paginate(labels), p => p.length), [6, 2]);
  assert.equal(engine.pageHeightMm(6), 297);
  assert.equal(engine.pageHeightMm(2), 101);
  assert.equal(engine.pageHeightMm(1), 52);
  const s = engine.summarize(rows);
  assert.deepEqual({ etiquetas: s.etiquetas, folhas: s.folhas, ultima: s.ultima, altura: s.alturaUltima, erro: s.comErro, zero: s.semQuantidade }, { etiquetas: 8, folhas: 2, ultima: 2, altura: 101, erro: 1, zero: 1 });
});

test('validações apontam o que impede ou merece conferência', () => {
  assert.deepEqual(Array.from(engine.analyzeRow({ descricao: '', por: '' }).erros), ['Falta a descrição', 'Falta o preço Por']);
  assert.deepEqual(Array.from(engine.analyzeRow({ descricao: 'X', por: 'abc' }).erros), ['Preço Por inválido']);
  assert.deepEqual(Array.from(engine.analyzeRow({ descricao: 'X', de: 'zz', por: '5' }).erros), ['Preço De inválido']);
  const semDe = engine.analyzeRow({ descricao: 'álcool 70%', por: '9,90' });
  assert.equal(semDe.de, null); assert.equal(semDe.imprime, true); assert.equal(semDe.descricao, 'ÁLCOOL 70%');
  assert.ok(engine.analyzeRow({ descricao: 'X', de: '5,00', por: '5,00' }).avisos.includes('Preço De não é maior que o Por'));
  assert.ok(engine.analyzeRow({ descricao: 'X', por: '5', ean: '7896100542038' }).avisos.includes('Código de barras inválido'));
  assert.ok(engine.analyzeRow({ descricao: 'X', por: '5', qtd: '2,5' }).avisos.includes('Quantidade inválida: sai 1 etiqueta'));
  assert.ok(engine.analyzeRow({ descricao: 'CREME HIDRATANTE CORPORAL PELE EXTRASSECA 400ML', por: '5' }).avisos.some(a => /Descrição longa/.test(a)));
  assert.ok(engine.analyzeRow({ descricao: 'X ✓', por: '5' }).avisos.includes('Caractere especial sairá como ?'));
});

test('primeira etiqueta segue as coordenadas do PDF oficial', () => {
  const labels = engine.expandLabels(templateRows());
  const page = engine.drawPage(labels, logoStub);
  const c = page.conteudo;
  assert.ok(Math.abs(page.altura - 841.8898) < 0.001);
  numbersNear(c, /([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re S/, [14.17323, 711.4961, 198.4252, 113.3858]);
  numbersNear(c, /\/F2 7\.5 Tf 1 0 0 1 ([\d.]+) ([\d.]+) Tm \(FRALDA INFANTIL G C\/30\)/, [25.51181, 809.2913]);
  numbersNear(c, /\/F2 7 Tf 1 0 0 1 ([\d.]+) ([\d.]+) Tm \(C\\363digo 42118\)/, [25.51181, 797.9528]);
  numbersNear(c, /\/F1 7 Tf 1 0 0 1 ([\d.]+) ([\d.]+) Tm \(C Bar 7896100542037\)/, [25.51181, 788.0315]);
  numbersNear(c, /\/F1 9 Tf 1 0 0 1 ([\d.]+) ([\d.]+) Tm \(De\)/, [25.51181, 771.0236]);
  numbersNear(c, /\/F2 11 Tf 1 0 0 1 ([\d.]+) ([\d.]+) Tm \(R\$59,90\)/, [39.51581, 771.0236]);
  numbersNear(c, /\.9 w ([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S/, [38.09849, 774.7087, 82.51313, 774.7087]);
  numbersNear(c, /\/F2 9 Tf 1 0 0 1 ([\d.]+) ([\d.]+) Tm \(Por\)/, [25.51181, 756.8504]);
  numbersNear(c, /\/F2 28 Tf 1 0 0 1 ([\d.]+) ([\d.]+) Tm \(R\$47,90\)/, [25.51181, 725.6693]);
  numbersNear(c, /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Logo Do Q/, [59.52756, 51.73645, 143.1496, 745.1554]);
  numbersNear(c, /\[2 2\] 0 d 0\.6 0\.6 0\.6 RG 0\.5 w ([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S/, [5.669291, 698.7402, 221.1024, 698.7402]);
  // Sexta etiqueta: caixa a 6 mm da borda inferior e sem linha de corte depois dela.
  numbersNear(c.slice(c.lastIndexOf(' re S') - 60), /([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re S/, [14.17323, 17.00787, 198.4252, 113.3858]);
  assert.equal((c.match(/\[2 2\] 0 d/g) || []).length, 5);
});

test('sem preço De a etiqueta mostra só o preço', () => {
  const [label] = engine.expandLabels([{ descricao: 'Soro fisiológico 500ml', codigo: '7788', por: '6,49' }]);
  const page = engine.drawPage([label], null);
  assert.ok(Math.abs(page.altura - 52 * 72 / 25.4) < 0.001);
  assert.doesNotMatch(page.conteudo, /\(De\)|\(Por\)|C Bar|\/Logo/);
  assert.match(page.conteudo, /\(SORO FISIOL\\323GICO 500ML\)/);
  assert.match(page.conteudo, /\/F2 28 Tf .* \(R\$6,49\) Tj/);
});

test('textos especiais são codificados em WinAnsi e textos longos cabem na etiqueta', () => {
  assert.equal(engine.pdfString('PÃO (ÇA) \\'), '(P\\303O \\(\\307A\\) \\\\)');
  assert.equal(engine.pdfString('OK ✓ – fim…'), '(OK ? \\226 fim\\205)');
  const max = engine.LAYOUT.larguraUtil * 72 / 25.4;
  const reduzido = engine.fitText('SHAMPOO ANTICASPA MENTOL REFRESCANTE 400ML', true, 7.5, 5.5, max);
  assert.equal(reduzido.cortado, false); assert.ok(reduzido.tamanho < 7.5);
  assert.ok(engine.textWidth(reduzido.texto, true, reduzido.tamanho) <= max);
  const cortado = engine.fitText('CREME HIDRATANTE CORPORAL PARA PELE EXTRASSECA COM UREIA 10% E VITAMINA E 400ML', true, 7.5, 5.5, max);
  assert.equal(cortado.cortado, true); assert.equal(cortado.tamanho, 5.5); assert.match(cortado.texto, /…$/);
  assert.ok(engine.textWidth(cortado.texto, true, 5.5) <= max);
  assert.ok(Math.abs(engine.textWidth('R$59,90', true, 11) - 41.58) < 0.001);
  // Preço de quatro dígitos diminui para não encostar no logo; até R$ 999,99 mantém 28 pt.
  const [caro, comum] = engine.expandLabels([{ descricao: 'A', por: '1.149,90' }, { descricao: 'B', por: '999,99' }]);
  const tamanho = label => Number(engine.drawLabel(label, 800, null).match(/\/F2 ([\d.]+) Tf [^\n]*\(R\$[\d.,]+\) Tj ET$/)[1]);
  assert.ok(tamanho(caro) < 28);
  assert.ok(engine.textWidth('R$1.149,90', true, tamanho(caro)) <= engine.LAYOUT.larguraPreco * 72 / 25.4);
  assert.equal(tamanho(comum), 28);
});

test('PDF gerado tem estrutura válida, uma folha por 6 etiquetas e logo único', () => {
  const rows = templateRows().map((row, i) => ({ ...row, qtd: i === 0 ? '3' : '1' }));
  const bytes = engine.buildPdf(engine.expandLabels(rows), logoStub, { data: new Date(2026, 10, 5, 20, 0, 0) });
  const pdf = Buffer.from(bytes).toString('latin1');
  assert.match(pdf, /^%PDF-1\.4\n/);
  assert.match(pdf, /%%EOF\n$/);
  assert.equal((pdf.match(/\/Type \/Page /g) || []).length, 2);
  const heights = [...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(m => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(heights.map(h => h.map(v => Math.round(v * 100) / 100)), [[226.77, 841.89], [226.77, 286.3]]);
  assert.equal((pdf.match(/\/Subtype \/Image/g) || []).length, 2);
  assert.equal((pdf.match(/\/Logo Do/g) || []).length, 8);
  const startxref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.slice(startxref, startxref + 4), 'xref');
  const entries = pdf.slice(startxref).split('\n').slice(3).filter(line => / 00000 n $/.test(line));
  entries.forEach((line, i) => assert.equal(pdf.slice(Number(line.slice(0, 10)), Number(line.slice(0, 10)) + String(i + 1).length + 6), (i + 1) + ' 0 obj'));
  assert.match(pdf, /\/CreationDate \(D:20261105200000\)/);
});
