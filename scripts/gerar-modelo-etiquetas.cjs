// Gera a planilha modelo das etiquetas de preço (.xlsx), em Open XML puro, sem dependências.
// Uso: node scripts/gerar-modelo-etiquetas.cjs
// Saída: ferramentas/precificacao/modelo_etiquetas_preco.xlsx (o botão "Baixar planilha modelo" baixa este arquivo).
// Colunas, exemplos e instruções vêm de TEMPLATE_* em ferramentas/precificacao/precificacao.js.
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), vm = require('node:vm');
const repo = path.resolve(__dirname, '..');
const out = process.argv[2] || path.join(repo, 'ferramentas/precificacao/modelo_etiquetas_preco.xlsx');
const source = fs.readFileSync(path.join(repo, 'ferramentas/precificacao/precificacao.js'), 'utf8');
const context = vm.createContext({ window: {} });
vm.runInContext(source.slice(0, source.indexOf('/* ======================== INTERFACE')) + '\nreturn { TEMPLATE_HEADERS, TEMPLATE_EXAMPLES, TEMPLATE_INSTRUCTIONS }; };', context);
const e = context.window.__tool_init_precificacao();
const HEADERS = Array.from(e.TEMPLATE_HEADERS), EXAMPLES = Array.from(e.TEMPLATE_EXAMPLES, r => Array.from(r));
const LAST = 501; // linhas já formatadas para preenchimento

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const COLS = ['A', 'B', 'C', 'D', 'E', 'F'];
// Estilos (cellXfs): 0 padrão, 1 cabeçalho, 2 texto, 3 preço, 4 quantidade, 5 descrição, 6 título, 7 negrito, 8 texto com quebra
const COL_STYLE = [5, 2, 2, 3, 3, 4];
const COL_WIDTH = [42, 12, 19, 12, 12, 13];

function cell(ref, value, style){
  if(value === '' || value === null || value === undefined) return `<c r="${ref}" s="${style}"/>`;
  if(typeof value === 'number') return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

const rows = [`<row r="1" ht="24" customHeight="1">${HEADERS.map((h, i) => cell(COLS[i] + 1, h, 1)).join('')}</row>`];
EXAMPLES.forEach((r, idx) => {
  const n = idx + 2;
  rows.push(`<row r="${n}">${r.map((v, i) => cell(COLS[i] + n, v, COL_STYLE[i])).join('')}</row>`);
});

const validations = [
  { sqref: `D2:E${LAST}`, type: 'decimal', op: 'between', f1: '0', f2: '99999', title: 'Preço', prompt: 'Valor em reais, ex.: 47,90. PREÇO DE pode ficar vazio quando não for promoção.', error: 'Digite só o valor em reais, ex.: 47,90.' },
  { sqref: `F2:F${LAST}`, type: 'whole', op: 'between', f1: '0', f2: '999', title: 'Quantidade', prompt: 'Quantas etiquetas imprimir. Vazio = 1. Zero = não imprime.', error: 'Use um número inteiro de 0 a 999.' },
  { sqref: `C2:C${LAST}`, type: 'textLength', op: 'lessThanOrEqual', f1: '14', title: 'Código de barras', prompt: 'EAN do produto, só números (normalmente 13 dígitos).', error: 'O código de barras tem no máximo 14 dígitos.', warning: true }
];
const dv = `<dataValidations count="${validations.length}">${validations.map(v => `<dataValidation type="${v.type}" operator="${v.op}" allowBlank="1" showInputMessage="1" showErrorMessage="1"${v.warning ? ' errorStyle="warning"' : ''} promptTitle="${esc(v.title)}" prompt="${esc(v.prompt)}" errorTitle="${esc(v.title)}" error="${esc(v.error)}" sqref="${v.sqref}"><formula1>${v.f1}</formula1>${v.f2 ? `<formula2>${v.f2}</formula2>` : ''}</dataValidation>`).join('')}</dataValidations>`;

const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><tabColor rgb="FFC8141E"/></sheetPr>
<dimension ref="A1:F${EXAMPLES.length + 1}"/>
<sheetViews><sheetView workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${COL_WIDTH.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" style="${COL_STYLE[i]}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows.join('')}</sheetData>
${dv}
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
<ignoredErrors><ignoredError sqref="B2:C${LAST}" numberStoredAsText="1"/></ignoredErrors>
</worksheet>`;

const instructions = Array.from(e.TEMPLATE_INSTRUCTIONS);
// Nome do campo em negrito ("DESCRIÇÃO:") e explicação normal, na mesma célula.
function instructionCell(ref, line, title){
  if(title) return cell(ref, line, 6);
  const m = line.match(/^([A-ZÇÃÉÍÓÚÊ ]+:)(.*)$/);
  if(!m) return cell(ref, line, 8);
  const run = (text, bold) => `<r><rPr>${bold ? '<b/>' : ''}<sz val="11"/><color rgb="FF000000"/><rFont val="Calibri"/><family val="2"/></rPr><t xml:space="preserve">${esc(text)}</t></r>`;
  return `<c r="${ref}" s="8" t="inlineStr"><is>${run(m[1], true)}${run(m[2], false)}</is></c>`;
}
const sheet2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"/></sheetViews>
<cols><col min="1" max="1" width="112" customWidth="1"/></cols>
<sheetData>${instructions.map((line, i) => `<row r="${i + 1}"${i === 0 ? ' ht="22" customHeight="1"' : ''}>${line ? instructionCell('A' + (i + 1), line, i === 0) : ''}</row>`).join('')}</sheetData>
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><color rgb="FFC8141E"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFC8141E"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const files = {
  '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
  '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Modelo de etiquetas de preço</dc:title><dc:creator>ConfereAI</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">2026-11-05T00:00:00Z</dcterms:created></cp:coreProperties>`,
  'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>ConfereAI</Application></Properties>`,
  'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Etiquetas" sheetId="1" r:id="rId1"/><sheet name="Como preencher" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  'xl/styles.xml': styles,
  'xl/worksheets/sheet1.xml': sheet1,
  'xl/worksheets/sheet2.xml': sheet2
};

// ZIP mínimo (deflate), com CRC-32.
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for(const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const locals = [], centrals = []; let offset = 0;
const DOS_TIME = (0 << 11) | (0 << 5), DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 5;
for(const [name, text] of Object.entries(files)){
  const data = Buffer.from(text, 'utf8'), comp = zlib.deflateRawSync(data, { level: 9 }), nameBuf = Buffer.from(name, 'utf8'), crc = crc32(data);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(DOS_TIME, 12); central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
  locals.push(local, nameBuf, comp); centrals.push(central, nameBuf);
  offset += 30 + nameBuf.length + comp.length;
}
const centralBuf = Buffer.concat(centrals), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
fs.writeFileSync(out, Buffer.concat([...locals, centralBuf, end]));
console.log('XLSX', out, fs.statSync(out).size, 'bytes');
