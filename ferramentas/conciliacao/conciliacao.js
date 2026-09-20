/* =========================================================================
   ConfereAI — Ferramenta: Conciliação Bancária (JavaScript)
   Toda a lógica de parsing, conciliação e renderização.
   Registrada como window.__tool_init_conciliacao — chamada pelo router.
   ========================================================================= */

window.__tool_init_conciliacao = function(){

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/* =========================================================================
   STATE
   ========================================================================= */
var state = {
  files: { caixa: [], sicredi: [], cielo: [], lancamentos: [] },
  parsed: { caixa: [], sicredi: [], cielo: [], lancamentos: [] },
  mappings: [],
  consolidated: [],
  storeSummary: [],
  periodWarnings: [],
  cardAudit: null,
  cardFilter: 'pending',
  pairs: null,
  divergences: [],
  summary: [],
  alignedRows: [],
  processedOnce: false
};

var MAPPING_STORAGE_KEY = 'confereai.companyMappings.v2';
var MATCH_TOLERANCE_MINUTES = 5;
var DEFAULT_COMPANY_MAPPINGS = [
  { loja: '1', razaoSocial: 'J I E FARMA COMERCIO LTDA - ME', cnpj: '11.719.336/0001-25', conta: '87041-2', estabelecimento: '1029024402', cieloDisponivel: true, observacoes: '' },
  { loja: '2', razaoSocial: 'MEG FARMACIA LTDA', cnpj: '13.286.582/0001-66', conta: '75073-5', estabelecimento: '', cieloDisponivel: false, observacoes: 'Sem acesso ao extrato Cielo' },
  { loja: '3', razaoSocial: 'L E FARMACIA LTDA - ME', cnpj: '15.045.542/0001-58', conta: '75079-4', estabelecimento: '1040788502', cieloDisponivel: true, observacoes: '' },
  { loja: '4', razaoSocial: 'GONCALVES E ARAUJO FARMACIA LTDA', cnpj: '24.920.850/0001-76', conta: '86765-9', estabelecimento: '', cieloDisponivel: true, observacoes: 'Estabelecimento Cielo ainda não cadastrado' },
  { loja: '5', razaoSocial: 'E B G DE ARAUJO FARMACIA', cnpj: '24.920.850/0002-57', conta: '87302-0', estabelecimento: '', cieloDisponivel: true, observacoes: 'Estabelecimento Cielo ainda não cadastrado' },
  { loja: '6', razaoSocial: 'MEG FARMACIA LTDA', cnpj: '13.286.582/0002-47', conta: '', estabelecimento: '2800327299', cieloDisponivel: true, observacoes: 'Vínculo confirmado pelo conteúdo do extrato' },
  { loja: '7', razaoSocial: 'MEG FARMACIA LTDA', cnpj: '13.286.582/0004-09', conta: '', estabelecimento: '3002105343', cieloDisponivel: true, observacoes: 'Vínculo confirmado pelo conteúdo e pelas transações' }
];

function cloneMappings(list){ return list.map(function(item){ return Object.assign({}, item); }); }
function loadCompanyMappings(){
  try{
    var saved = window.localStorage && window.localStorage.getItem(MAPPING_STORAGE_KEY);
    var parsed = saved ? JSON.parse(saved) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : cloneMappings(DEFAULT_COMPANY_MAPPINGS);
  }catch(e){ return cloneMappings(DEFAULT_COMPANY_MAPPINGS); }
}
function saveCompanyMappings(mappings){
  state.mappings = cloneMappings(mappings);
  if(window.localStorage) window.localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(state.mappings));
}
state.mappings = loadCompanyMappings();

var MODAL_LABEL = { PIX: 'PIX', Debito: 'Débito', Credito: 'Crédito', Dinheiro: 'Dinheiro', Cartao: 'Cartão (não especificado)', Outro: 'Não identificado' };

function normalizeText(value){ return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim(); }
function escapeHtml(value){ return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function cents(value){ return Math.round(value * 100); }
function moneyCents(tx, key){
  var centKey = (key || 'valor') + 'Centavos';
  return Number.isInteger(tx && tx[centKey]) ? tx[centKey] : cents(tx && tx[key || 'valor'] || 0);
}
function moneyFields(valor, liquido, taxa){
  var result = { valor: valor, valorCentavos: cents(valor) };
  if(Number.isFinite(liquido)){ result.valorLiquido = liquido; result.valorLiquidoCentavos = cents(liquido); }
  if(Number.isFinite(taxa)){ result.taxaValor = taxa; result.taxaCentavos = cents(Math.abs(taxa)); }
  return result;
}
function digits(value){ return String(value || '').replace(/\D/g, ''); }
function sumValues(list, key){ return list.reduce(function(sum, tx){ return sum + (Number.isFinite(tx[key || 'valor']) ? cents(tx[key || 'valor']) : 0); }, 0) / 100; }
function detectBrand(value){
  var text = normalizeText(value);
  if(/AMERICAN EXPRESS|AMEX/.test(text)) return 'American Express';
  if(/MASTERCARD|MASTER CARD/.test(text)) return 'Mastercard';
  if(/VISA/.test(text)) return 'Visa';
  if(/\bELO\b/.test(text)) return 'Elo';
  if(/HIPERCARD/.test(text)) return 'Hipercard';
  if(/DINERS/.test(text)) return 'Diners';
  return null;
}

function brandLabel(brand, warning){
  var marks = {
    Mastercard: '<circle cx="11" cy="12" r="8" fill="#eb001b"/><circle cx="21" cy="12" r="8" fill="#f79e1b" fill-opacity=".9"/>',
    Visa: '<text x="16" y="17" text-anchor="middle" font-family="Arial,sans-serif" font-weight="900" font-style="italic" font-size="13" fill="#17357c">VISA</text>',
    Elo: '<text x="16" y="17" text-anchor="middle" font-family="Arial,sans-serif" font-weight="800" font-size="17" fill="#222">elo</text><path d="M3 4h7" stroke="#ffcb05" stroke-width="2"/><path d="M13 4h7" stroke="#00a4df" stroke-width="2"/><path d="M23 4h6" stroke="#ef4123" stroke-width="2"/>',
    'American Express': '<rect width="32" height="24" rx="3" fill="#1675bb"/><text x="16" y="15" text-anchor="middle" font-family="Arial,sans-serif" font-weight="800" font-size="9" fill="white">AMEX</text>'
  };
  var mark = marks[brand] || '<rect x="3" y="5" width="26" height="16" rx="3" fill="none" stroke="#718098" stroke-width="2"/><path d="M4 10h24" stroke="#718098" stroke-width="2"/>';
  return '<span class="brand-label' + (warning ? ' field-warning' : '') + '"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 24">' + mark + '</svg></span>' + escapeHtml(brand || 'Não identificada') + '</span>';
}

function paymentLabel(tx, row){
  var mode = tx.modalidade, debit = mode === 'Debito', credit = mode === 'Credito';
  var icon = debit ? '<path d="M3 7h15v12H3zM6 3h15v12M6 12h9M12 9l3 3-3 3"/>' : '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 9h20M6 15h4"/>';
  return '<span class="payment-label ' + (debit ? 'debit' : credit ? 'credit' : 'unknown') + (row.mode ? ' field-warning' : '') + '"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + icon + '</svg>' + escapeHtml(MODAL_LABEL[mode] || 'Não identificado') + '</span> <span class="' + (row.installments ? 'field-warning' : 'muted') + '">' + (tx.parcelas ? tx.parcelas + 'x' : '—') + '</span>';
}

// Cada parcela permanece na origem; apenas a visão por venda é consolidada.
function parseCardLaunchLines(lines){
  var data = null, loja = '', out = [];
  var money = '([\\d.]+,\\d{2})';
  var rowRe = new RegExp('^(?:(\\d{2}/\\d{2}/\\d{4})\\s+)?(\\d+\\s*-\\s*.+?)\\s+(\\d+)\\s+(\\d+)\\s+' + money + '\\s+' + money + '\\s+' + money + '(?:\\s+(\\d+))?$');
  lines.forEach(function(line){
    var store = line.match(/(?:Loja:\s*)?(\d+)\s*-\s*LOJA\b/i);
    if(store) loja = store[1];
    if(/^\d{2}\/\d{2}\/\d{4}$/.test(line.trim())) data = parseDateAny(line);
    var match = line.match(rowRe);
    if(!match) return;
    var date = match[1] ? parseDateAny(match[1]) : data;
    if(!date) throw new Error('Lançamento de cartão sem data: confira o layout do PDF.');
    data = date;
    var description = match[2], normalized = normalizeText(description).replace(/^\d+\s*-\s*/, '');
    var modalidade = detectModalidadeFromText(description);
    if(/^(MASTERCARD|VISA)$/.test(normalized)) modalidade = 'Credito';
    var valor = parseValorBR(match[5]), liquido = parseValorBR(match[7]), taxa = parseValorBR(match[6]);
    out.push(Object.assign({ origem: 'Lançamentos', data: date, loja: loja, registro: match[3], documento: match[3], parcelas: Number(match[4]), taxa: taxa, nsu: match[8] || '', bandeira: detectBrand(description), modalidade: modalidade, descricao: description, isPos: /CARTAO\s+POS/i.test(normalizeText(description)), raw: line }, moneyFields(valor, liquido, taxa)));
  });
  var declared = lines.map(function(line){ return line.match(/Total Geral[\s.]*:\s*(\d+)\s+([\d.]+,\d{2})/i); }).find(Boolean);
  if(!out.length) throw new Error('Nenhum lançamento de cartão reconhecido. Confira o relatório e o período.');
  if(declared && (Number(declared[1]) !== out.length || cents(parseValorBR(declared[2])) !== cents(sumValues(out)))) throw new Error('A leitura dos Lançamentos não fechou com o total impresso. Confira o layout antes de conciliar.');
  return out;
}

function aggregateCardLaunches(lines){
  var groups = new Map();
  lines.forEach(function(line){
    var key = [line.loja, line.data, line.registro, line.nsu, normalizeText(line.descricao)].join('|');
    if(!groups.has(key)) groups.set(key, Object.assign({}, line, { linhas: [], valor: 0, valorCentavos: 0, valorLiquido: 0, valorLiquidoCentavos: 0 }));
    var group = groups.get(key);
    group.linhas.push(line);
    group.valorCentavos += moneyCents(line);
    group.valor = group.valorCentavos / 100;
    group.valorLiquidoCentavos += moneyCents(line, 'valorLiquido');
    group.valorLiquido = group.valorLiquidoCentavos / 100;
  });
  return Array.from(groups.values()).map(function(group){
    group.possibleDuplicate = Number(group.parcelas) > 0 && group.linhas.length > Number(group.parcelas);
    group.duplicateReason = group.possibleDuplicate ? ('Foram encontradas ' + group.linhas.length + ' linhas para ' + group.parcelas + ' parcela(s), no mesmo Registro/NSU/contexto.') : '';
    return group;
  });
}

/* =========================================================================
   UTILITIES (tool-specific)
   ========================================================================= */
function timeDiffMinutes(t1, t2){
  var p1 = t1.split(':').map(Number), p2 = t2.split(':').map(Number);
  return Math.abs((p1[0]*60+p1[1]) - (p2[0]*60+p2[1]));
}

function detectModalidadeFromText(text){
  var t = text.toUpperCase();
  if(/CARTEIRA\s*DIGITAL|CART\.?\s*DIG\b/.test(t)) return 'PIX';
  if(/PIX/.test(t)) return 'PIX';
  if(/D[ÉE]B|DEBITO|CARTAO\s*D[ÉE]B/.test(t)) return 'Debito';
  if(/CR[ÉE]D|CREDITO|CARTAO\s*CR[ÉE]D/.test(t)) return 'Credito';
  if(/DINHEIRO|ESPECIE|ESP[ÉE]CIE|CASH/.test(t)) return 'Dinheiro';
  if(/CART[ÃA]O|CIELO|REDE|GETNET|STONE|VISA|MASTER|ELO\b|TEF/.test(t)) return 'Cartao';
  return 'Outro';
}

function isDateMatch(c, b) {
  if (c.data === b.data) return true;
  if (c.modalidade === 'PIX' && b.modalidade === 'PIX') {
    var d = new Date(c.data + 'T12:00:00Z');
    var day = d.getUTCDay();
    if (day === 6) {
      d.setUTCDate(d.getUTCDate() + 2);
      return d.toISOString().slice(0, 10) === b.data;
    } else if (day === 0) {
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10) === b.data;
    }
  }
  return false;
}

/* =========================================================================
   PDF PARSING — RELATÓRIO DE CAIXA
   ========================================================================= */
async function extractPdfLines(file){
  var buf = await file.arrayBuffer();
  var pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  var lines = [];
  for(var p = 1; p <= pdf.numPages; p++){
    var page = await pdf.getPage(p);
    var content = await page.getTextContent();
    var rows = {};
    content.items.forEach(function(item){
      if(!item.str || !item.str.trim()) return;
      var y = Math.round(item.transform[5]);
      if(!rows[y]) rows[y] = [];
      rows[y].push(item);
    });
    var ys = Object.keys(rows).map(Number).sort(function(a,b){ return b - a; });
    ys.forEach(function(y){
      var line = rows[y]
        .sort(function(a,b){ return a.transform[4] - b.transform[4]; })
        .map(function(i){ return i.str; })
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if(line) lines.push(line);
    });
  }
  return lines;
}

async function detectPdfType(file){
  try{
    var lines = await extractPdfLines(file);
    var text = normalizeText(lines.slice(0, 80).join(' '));
    if(text.includes('LANCAMENTOS DE CARTAO MAGNETICO POR DATA')) return 'lancamentos';
    if(text.includes('DETALHADO DE VENDAS CIELO')) return 'cielo';
    if(text.includes('RELAÇÃO DE VENDAS POR PERÍODO') || text.includes('RELACAO DE VENDAS POR PERIODO')) return 'caixa';
  }catch(e){
    console.warn('Não foi possível identificar o PDF:', e);
  }
  return 'desconhecido';
}

function parseCaixaLinesLegacy(lines){
  var out = [];
  var dateRe = /(\d{2}\/\d{2}\/\d{4})/;
  var timeRe = /(\d{2}:\d{2})(?::\d{2})?/;
  var valorRe = /(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  var hasValorRe = /(\d{1,3}(?:\.\d{3})*,\d{2})/;
  var docRe = /\b(\d{4,12})\b/;

  var lastData = null;
  var lastHora = null;
  var lastDoc = '';
  var loja = '';

  function readLine(line, isExtra){
    isExtra = isExtra || false;
    if(/(total geral|total da loja|subtotal|total bruto|total liquido|^total\b)/i.test(line.trim())) return false;
    var dateM = line.match(dateRe);
    if(!isExtra && !dateM) return false;
    
    var valores = [];
    var m;
    var re = new RegExp(valorRe.source, 'g');
    while((m = re.exec(line)) !== null) valores.push(m);
    if(valores.length === 0) return false;

    var data, hora, documento;
    var timeM = line.match(timeRe);

    if(isExtra){
      if(!lastData) return false;
      data = lastData;
      hora = lastHora;
      documento = lastDoc;
    } else {
      var valorStr = valores[valores.length - 1][1];
      var stripped = line
        .replace(dateM[0], ' ')
        .replace(timeM ? timeM[0] : '', ' ')
        .replace(valorStr, ' ');
      var docM = stripped.match(docRe);
      
      data = dateM[1];
      hora = timeM ? timeM[1] : null;
      documento = docM ? docM[1] : '';

      lastData = data;
      lastHora = hora;
      lastDoc = documento;
    }

    var modalidade = detectModalidadeFromText(line);
    var valorStr2 = valores[valores.length - 1][1];
    var valor = parseValorBR(valorStr2);
    if(isNaN(valor) || valor <= 0) return true;

    out.push({
      origem: 'Caixa',
      data: parseDateAny(data),
      hora: hora ? parseTimeAny(hora) : null,
      modalidade: modalidade,
      documento: documento,
      registro: documento,
      loja: loja,
      valor: valor,
      raw: line
    });
    return true;
  }

  var pendente = '';
  lines.forEach(function(originalLine){
    var line = originalLine;
    var store = line.match(/^(\d+)\s*-\s*LOJA\b/i);
    if(store){ loja = store[1]; return; }
    if(dateRe.test(line)){
      if(pendente) readLine(pendente);
      var re = new RegExp(valorRe.source, 'g');
      var vals = [];
      var m2;
      while((m2 = re.exec(line)) !== null) vals.push(m2);
      if(!vals.length){ pendente = line; return; }
      readLine(line);
      pendente = '';
    } else if(pendente && hasValorRe.test(line)){
      readLine(pendente + ' ' + line);
      pendente = '';
    } else if(lastData && hasValorRe.test(line) && !/total/i.test(line) && !/troco/i.test(line) && !/devolu/i.test(line) && !/pagto/i.test(line)){
      readLine(line, true);
    }
  });
  if(pendente) readLine(pendente);
  var printedTotal = lines.map(function(line){ return line.match(/Total Geral[\s.]*:\s*([\d.]+,\d{2})/i); }).find(Boolean);
  if(printedTotal && cents(parseValorBR(printedTotal[1])) !== cents(sumValues(out))) throw new Error('A leitura da Relação de Vendas não fechou com o total impresso. Confira o layout do PDF.');
  return out;
}

function parseCaixaLines(lines){
  var out = [], loja = '', lastSale = null, sequenceByRecord = {};
  var money = '([\\d.]+,\\d{2})';
  var mainRe = new RegExp('^(\\d+)\\s+(\\S+)\\s+(\\d+)\\s+(\\d{2}\\/\\d{2}\\/\\d{4})\\s+(\\d{2}:\\d{2})(?::\\d{2})?\\s+(\\d+)\\/\\s*(\\d+)\\s+(\\d+)\\s+([\\d.,]+%)\\s+(.+?)\\s+' + money + '$', 'i');
  var extraRe = new RegExp('^(.+?)\\s+' + money + '$', 'i');
  lines.forEach(function(line){
    var store = line.match(/^(\d+)\s*-\s*LOJA\b/i);
    if(store){ loja = store[1]; lastSale = null; return; }
    var main = line.match(mainRe);
    if(main){
      var key = [loja, main[1], main[4]].join('|');
      sequenceByRecord[key] = (sequenceByRecord[key] || 0) + 1;
      var valor = parseValorBR(main[11]);
      lastSale = Object.assign({
        origem: 'Relação de Vendas', loja: loja, registro: main[1], situacao: main[2], documento: main[3],
        data: parseDateAny(main[4]), hora: parseTimeAny(main[5]), caixa: main[6], turno: main[7], vendedor: main[8],
        desconto: main[9], finalizador: main[10], modalidade: detectModalidadeFromText(main[10]),
        linhaRegistro: sequenceByRecord[key], linhaSecundaria: false, raw: line
      }, moneyFields(valor));
      out.push(lastSale);
      return;
    }
    if(!lastSale || /(total geral|total da loja|subtotal|total bruto|total liquido|^total\b|troco|devolu|pagto)/i.test(line.trim())) return;
    var extra = line.match(extraRe);
    if(!extra || !/CART|PIX|DINHEIRO|VISA|MASTER|ELO|POS/i.test(normalizeText(extra[1]))) return;
    var extraValue = parseValorBR(extra[2]);
    var secondary = Object.assign({}, lastSale, moneyFields(extraValue), {
      finalizador: extra[1], modalidade: detectModalidadeFromText(extra[1]), linhaRegistro: lastSale.linhaRegistro + 1,
      linhaSecundaria: true, raw: line
    });
    out.push(secondary);
  });
  var printedTotal = lines.map(function(line){ return line.match(/Total Geral[\s.]*:\s*([\d.]+,\d{2})/i); }).find(Boolean);
  if(printedTotal && cents(parseValorBR(printedTotal[1])) !== cents(sumValues(out))) throw new Error('A leitura da Relação de Vendas não fechou com o total impresso. Confira o layout do PDF.');
  if(!out.length) throw new Error('Nenhuma venda reconhecida na Relação de Vendas. Confira o layout e o período.');
  return out;
}

/* =========================================================================
   XLSX HELPERS
   ========================================================================= */
async function readWorkbook(file){
  var buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: 'array', cellDates: false });
}

function sheetToMatrix(workbook, sheetIndex){
  var sheetName = workbook.SheetNames[sheetIndex !== undefined ? sheetIndex : 0];
  var ws = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
}

function findHeaderRow(matrix, requiredKeywordsAny){
  for(var i = 0; i < Math.min(matrix.length, 200); i++){
    var rowText = matrix[i].map(function(c){ return String(c || '').toLowerCase(); }).join(' | ');
    var hit = requiredKeywordsAny.some(function(k){ return rowText.includes(k); });
    if(hit){
      var nonEmpty = matrix[i].filter(function(c){ return String(c || '').trim() !== ''; }).length;
      if(nonEmpty >= 2) return i;
    }
  }
  return -1;
}

function findColIndex(headerRow, keywords){
  for(var i = 0; i < headerRow.length; i++){
    var cell = String(headerRow[i] || '').toLowerCase();
    if(keywords.some(function(k){ return cell.includes(k); })) return i;
  }
  return -1;
}

function findPixHeaderRow(matrix){
  for(var i = 0; i < Math.min(matrix.length, 200); i++){
    var cells = matrix[i].map(function(c){ return String(c || '').toLowerCase(); });
    var hasData = cells.some(function(c){ return c.includes('data'); });
    var hasValor = cells.some(function(c){ return c.includes('valor'); });
    var hasDescricao = cells.some(function(c){ return /descri|hist|lançamento|lancamento|detalhe|tipo/.test(c); });
    if(hasData && hasValor && hasDescricao) return i;
  }
  return -1;
}

/* =========================================================================
   DETECÇÃO AUTOMÁTICA DE TIPO DE ARQUIVO XLS/XLSX
   ========================================================================= */
async function detectXlsxType(file){
  try{
    var wb = await readWorkbook(file);
    var flat = wb.SheetNames
      .map(function(_, index){ return sheetToMatrix(wb, index).slice(0, 250).map(function(r){ return r.join(' '); }).join(' '); })
      .join(' ')
      .toLowerCase();
    var filename = file.name.toLowerCase();
    var cieloMarkers = ['data da venda', 'forma de pagamento', 'valor bruto'];
    var cieloScore = cieloMarkers.filter(function(marker){ return flat.includes(marker); }).length;

    if(filename.includes('cielo') || cieloScore >= 2) return 'cielo';
    if(/pix|sicred|extrato/.test(filename) || /recebimento\s+pix|sicredi/.test(flat)) return 'sicredi';
    return 'sicredi';
  }catch(e){
    return 'sicredi';
  }
}

/* =========================================================================
   PARSING — EXTRATO SICREDI (PIX)
   ========================================================================= */
async function parseSicredi(file){
  var wb = await readWorkbook(file);
  var matrix = null, headerIdx = -1;
  for(var sheetIndex = 0; sheetIndex < wb.SheetNames.length; sheetIndex++){
    var candidate = sheetToMatrix(wb, sheetIndex);
    var idx = findPixHeaderRow(candidate);
    if(idx !== -1){ matrix = candidate; headerIdx = idx; break; }
  }
  if(headerIdx === -1 || !matrix) throw new Error('Não foi possível localizar o cabeçalho no extrato PIX.');

  var header = matrix[headerIdx];
  var colData = findColIndex(header, ['data']);
  var colDesc = findColIndex(header, ['descri', 'hist', 'pagador', 'nome', 'lançamento', 'lancamento', 'detalhe', 'tipo']);
  var colDoc  = findColIndex(header, ['documento', 'doc']);
  var colValor= findColIndex(header, ['valor']);

  if(colData === -1 || colValor === -1) throw new Error('Colunas obrigatórias (Data/Valor) não encontradas no extrato Sicredi.');

  var out = [];
  for(var i = headerIdx + 1; i < matrix.length; i++){
    var row = matrix[i];
    if(!row || row.every(function(c){ return String(c || '').trim() === ''; })) continue;
    var rowText = row.map(function(c){ return String(c || ''); }).join(' ');
    if(!/RECEBIMENTO\s+PIX/i.test(rowText)) continue;
    var data = parseDateAny(row[colData]);
    var valor = parseValorBR(row[colValor]);
    if(!data || isNaN(valor)) continue;
    if(valor <= 0) continue;
    out.push({
      origem: 'Sicredi', data: data, hora: null, modalidade: 'PIX',
      documento: colDoc !== -1 ? String(row[colDoc] || '') : '',
      valor: valor,
      raw: colDesc !== -1 ? String(row[colDesc] || '') : rowText
    });
  }
  return out;
}

/* =========================================================================
   PARSING — EXTRATO CIELO
   ========================================================================= */
async function parseCielo(file){
  if(file.name.toLowerCase().endsWith('.pdf')){
    return parseCieloPdfLines(await extractPdfLines(file), file.name);
  }
  var wb = await readWorkbook(file);
  var matrix = sheetToMatrix(wb, 0);
  var headerIdx = findHeaderRow(matrix, ['data da venda', 'forma de pagamento', 'valor bruto']);
  if(headerIdx === -1) throw new Error('Não foi possível localizar o cabeçalho no extrato Cielo.');

  var header = matrix[headerIdx];
  var colData  = findColIndex(header, ['data da venda', 'data venda', 'data']);
  var colHora  = findColIndex(header, ['hora da venda', 'hora venda', 'hora']);
  var colForma = findColIndex(header, ['forma de pagamento', 'forma pagamento', 'bandeira']);
  var colBruto = findColIndex(header, ['valor bruto']);
  var colLiq   = findColIndex(header, ['valor l', 'liquido', 'líquido']);
  var colBrand = findColIndex(header, ['bandeira']);
  var colParts = findColIndex(header, ['quantidade total de parcelas', 'parcelas']);
  var colNsu = findColIndex(header, ['nsu']);
  var colStatus = findColIndex(header, ['status']);
  var colCnpj = findColIndex(header, ['cpf/cnpj', 'cnpj']);
  var colEstabelecimento = findColIndex(header, ['estabelecimento']);

  if(colData === -1 || colForma === -1 || colBruto === -1) throw new Error('Colunas obrigatórias não encontradas no extrato Cielo.');

  var out = [];
  for(var i = headerIdx + 1; i < matrix.length; i++){
    var row = matrix[i];
    if(!row || row.every(function(c){ return String(c || '').trim() === ''; })) continue;
    var data = parseDateAny(row[colData]);
    var valorBruto = parseValorBR(row[colBruto]);
    if(colStatus !== -1 && !/^APROVAD[AO]$/.test(normalizeText(row[colStatus]))) continue;
    if(!data || isNaN(valorBruto)) continue;
    var modalidade = detectModalidadeFromText(String(row[colForma] || ''));
    var liquido = colLiq !== -1 ? parseValorBR(row[colLiq]) : null;
    out.push(Object.assign({
      origem: 'Cielo', data: data,
      hora: colHora !== -1 ? parseTimeAny(row[colHora]) : null,
      modalidade: modalidade, documento: '',
      bandeira: colBrand !== -1 ? detectBrand(row[colBrand]) : null,
      parcelas: colParts !== -1 && Number(row[colParts]) > 0 ? Number(row[colParts]) : (/PARCELADO/.test(normalizeText(row[colForma])) ? null : 1),
      nsu: colNsu !== -1 ? String(row[colNsu] || '') : '',
      cnpj: colCnpj !== -1 ? String(row[colCnpj] || '') : '',
      estabelecimento: colEstabelecimento !== -1 ? String(row[colEstabelecimento] || '') : '',
      raw: String(row[colForma] || '')
    }, moneyFields(valorBruto, liquido)));
  }
  return out;
}

function parseCieloPdfLines(lines, sourceFile){
  var out = [];
  var dateRe = /(\d{2}\/\d{2}\/\d{4})/;
  var timeRe = /(\d{1,2}:\d{2})/;
  var moneyRe = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/g;

  lines.forEach(function(line){
    var dateM = line.match(dateRe);
    if(!dateM || !/\bAPROVADA\b/i.test(line)) return;
    var amounts = [];
    var m;
    var re = new RegExp(moneyRe.source, 'g');
    while((m = re.exec(line)) !== null) amounts.push(m);
    if(!amounts.length) return;
    var valor = parseValorBR(amounts[0][1]);
    if(!Number.isFinite(valor) || valor <= 0) return;
    var timeMatch = line.match(timeRe);
    var liquido = amounts.length >= 3 ? parseValorBR(amounts[2][1]) : null;
    var taxa = amounts.length >= 3 ? parseValorBR(amounts[1][1]) : null;
    out.push(Object.assign({
      origem: 'Cielo',
      data: parseDateAny(dateM[1]),
      hora: timeMatch ? parseTimeAny(timeMatch[1]) : null,
      modalidade: detectModalidadeFromText(line), documento: '', raw: line, arquivoOrigem: sourceFile || '', status: 'Aprovada',
      bandeira: detectBrand(line),
      parcelas: /parcelado/i.test(line) ? (line.match(/(\d+)\s*x\b/i) ? Number(line.match(/(\d+)\s*x\b/i)[1]) : null) : 1,
      estabelecimento: (line.match(/\d{2}:\d{2}\s+(\d+)/) || [])[1] || '',
      cnpj: (line.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/) || [])[0] || ''
    }, moneyFields(valor, liquido, taxa)));
  });
  var totalizer = lines.map(function(line){ return line.match(/^(\d+)\s+R\$\s*([\d.]+,\d{2})\s+-?R\$/); }).find(Boolean);
  // O totalizador só serve de controle quando todas as linhas são aprovadas.
  var hasOtherStatus = lines.some(function(line){ return /\d{2}\/\d{2}\/\d{4}/.test(line) && /R\$/.test(line) && !/\bAPROVADA\b/i.test(line); });
  if(totalizer && !hasOtherStatus && (Number(totalizer[1]) !== out.length || cents(parseValorBR(totalizer[2])) !== cents(sumValues(out)))) throw new Error('A leitura da Cielo não fechou com o totalizador. Confira o layout do PDF.');
  return out;
}

/* =========================================================================
   MOTOR DE CONCILIAÇÃO
   ========================================================================= */
function resolveCompanyMapping(tx, mappings){
  var txCnpj = digits(tx.cnpj), txEst = digits(tx.estabelecimento);
  var byCnpj = txCnpj ? mappings.filter(function(item){ return digits(item.cnpj) === txCnpj; }) : [];
  var byEst = txEst ? mappings.filter(function(item){ return String(item.estabelecimento || '').split(/[,;\s]+/).some(function(value){ return digits(value) === txEst; }); }) : [];
  if(byCnpj.length === 1 && byEst.length === 1 && byCnpj[0].loja !== byEst[0].loja) return { mapping: null, warning: 'CNPJ e estabelecimento apontam para lojas diferentes' };
  if(byCnpj.length === 1) return { mapping: byCnpj[0], warning: '' };
  if(byEst.length === 1) return { mapping: byEst[0], warning: '' };
  return { mapping: null, warning: txCnpj || txEst ? 'CNPJ/estabelecimento sem mapeamento único' : 'CNPJ e estabelecimento não identificados' };
}

function associateCieloStores(cielo, mappings){
  return cielo.map(function(tx){
    var resolved = resolveCompanyMapping(tx, mappings);
    return Object.assign({}, tx, { loja: resolved.mapping ? String(resolved.mapping.loja) : '', mappingWarning: resolved.warning });
  });
}

function dateSet(list){ return Array.from(new Set(list.map(function(tx){ return tx.data; }).filter(Boolean))).sort(); }
function validatePeriods(relation, launches, cielo){
  var relationDates = dateSet(relation), launchDates = dateSet(launches), cieloDates = dateSet(cielo);
  function same(a, b){ return !b.length || (a.length === b.length && a.every(function(value, index){ return value === b[index]; })); }
  var warnings = [];
  if(!same(relationDates, launchDates)) warnings.push('Relação (' + relationDates.join(', ') + ') e Lançamentos (' + launchDates.join(', ') + ')');
  if(!same(relationDates, cieloDates)) warnings.push('Relação (' + relationDates.join(', ') + ') e Cielo (' + cieloDates.join(', ') + ')');
  if(warnings.length) throw new Error('PERÍODOS INCOMPATÍVEIS: ' + warnings.join('; ') + '.');
  return { relation: relationDates, launches: launchDates, cielo: cieloDates };
}

function cardCompatibility(launch, bank){
  if(!launch || !bank) return true;
  if(launch.bandeira && bank.bandeira && launch.bandeira !== bank.bandeira) return false;
  if(/^(Debito|Credito)$/.test(launch.modalidade) && /^(Debito|Credito)$/.test(bank.modalidade) && launch.modalidade !== bank.modalidade) return false;
  if(launch.parcelas && bank.parcelas && Number(launch.parcelas) !== Number(bank.parcelas)) return false;
  return true;
}

function buildConsolidatedAudit(relation, launchLines, cielo, mappings, toleranceMinutes){
  toleranceMinutes = Number.isFinite(toleranceMinutes) ? toleranceMinutes : MATCH_TOLERANCE_MINUTES;
  var mappedCielo = associateCieloStores(cielo, mappings || []);
  var launchGroups = aggregateCardLaunches(launchLines);
  var usedLaunches = new Set(), usedCielo = new Set(), rows = [];
  var cieloStores = new Set(mappedCielo.filter(function(tx){ return tx.loja; }).map(function(tx){ return tx.loja; }));

  function launchFor(sale){
    var candidates = launchGroups.filter(function(group){ return !usedLaunches.has(group) && group.loja === sale.loja && group.data === sale.data && group.registro === sale.registro; });
    var exact = candidates.filter(function(group){ return moneyCents(group) === moneyCents(sale); });
    var selected = exact.length === 1 ? exact[0] : (candidates.length === 1 ? candidates[0] : null);
    if(selected) usedLaunches.add(selected);
    return { selected: selected, candidates: candidates };
  }

  relation.forEach(function(sale){
    var launchResult = launchFor(sale), launch = launchResult.selected;
    var mapping = (mappings || []).find(function(item){ return String(item.loja) === String(sale.loja); });
    var storePool = mappedCielo.filter(function(bank){ return !usedCielo.has(bank) && bank.loja === sale.loja && bank.data === sale.data; });
    var strong = launch && launch.nsu ? storePool.filter(function(bank){ return bank.nsu && digits(bank.nsu) === digits(launch.nsu); }) : [];
    var exact = storePool.filter(function(bank){
      if(moneyCents(bank) !== moneyCents(sale)) return false;
      return sale.hora && bank.hora ? timeDiffMinutes(sale.hora, bank.hora) <= toleranceMinutes : cardCompatibility(launch, bank);
    });
    var bank = null, confidence = 'LOW', matchedBy = '', matchReasons = [], warnings = [], status = '';
    if(strong.length === 1){
      bank = strong[0];
      confidence = moneyCents(bank) === moneyCents(sale) ? 'HIGH' : 'MEDIUM';
      matchedBy = 'loja+registro+NSU';
      matchReasons.push('Mesmo NSU', 'Mesma loja pelo CNPJ/estabelecimento', 'Mesma data');
      if(moneyCents(bank) !== moneyCents(sale)){ status = 'DIVERGÊNCIA DE VALOR'; matchReasons.push('Valor bruto divergente'); }
      usedCielo.add(bank);
    }else if(strong.length > 1){
      status = 'AMBÍGUO'; warnings.push('NSU repetido em mais de uma transação Cielo');
    }else if(exact.length === 1){
      bank = exact[0];
      var diff = sale.hora && bank.hora ? timeDiffMinutes(sale.hora, bank.hora) : null;
      if(diff !== null && diff <= toleranceMinutes){
        confidence = 'HIGH'; matchedBy = 'loja+data+valor+horário';
        matchReasons.push('Mesma loja pelo CNPJ/estabelecimento', 'Mesma data', 'Mesmo valor bruto em centavos', 'Diferença de horário de ' + diff + ' minuto(s)');
      }else{
        confidence = 'MEDIUM'; matchedBy = 'loja+data+valor+cartão';
        matchReasons.push('Mesma loja pelo CNPJ/estabelecimento', 'Mesma data', 'Mesmo valor bruto em centavos', 'Horário indisponível; classificação do cartão usada como apoio');
      }
      usedCielo.add(bank);
    }else if(exact.length > 1){
      status = 'AMBÍGUO';
      warnings.push(exact.length + ' transações Cielo são candidatas ao mesmo valor/período');
      matchReasons.push('Há mais de um candidato compatível; nenhum foi escolhido automaticamente');
    }else{
      var near = storePool.filter(function(candidate){ return sale.hora && candidate.hora && timeDiffMinutes(sale.hora, candidate.hora) <= toleranceMinutes && cardCompatibility(launch, candidate); });
      if(near.length === 1){
        bank = near[0]; confidence = 'MEDIUM'; matchedBy = 'loja+data+horário+cartão'; usedCielo.add(bank);
        matchReasons.push('Mesma loja pelo CNPJ/estabelecimento', 'Mesma data', 'Horário dentro de ' + toleranceMinutes + ' minutos', 'Valor bruto divergente');
        status = 'DIVERGÊNCIA DE VALOR';
      }
    }

    if(launchResult.candidates.length > 1 && !launch) warnings.push('Mais de um lançamento interno possível para o registro');
    if(launch && launch.possibleDuplicate){ status = 'POSSÍVEL DUPLICIDADE NOS LANÇAMENTOS'; warnings.push(launch.duplicateReason); }
    if(!status && launch && launch.isPos && !bank) status = 'OUTRA ADQUIRENTE / POS';
    if(!status && (!mapping || mapping.cieloDisponivel === false || !cieloStores.has(sale.loja))) status = 'LOJA SEM EXTRATO CIELO';
    if(!status && !bank) status = 'NÃO ENCONTRADO NA CIELO';
    if(!status && confidence !== 'HIGH') status = 'AMBÍGUO';
    if(!status && bank){
      var brandDiff = launch && launch.bandeira && bank.bandeira && launch.bandeira !== bank.bandeira;
      var typeDiff = launch && /^(Debito|Credito)$/.test(launch.modalidade) && /^(Debito|Credito)$/.test(bank.modalidade) && launch.modalidade !== bank.modalidade;
      var installmentsDiff = launch && launch.parcelas && bank.parcelas && Number(launch.parcelas) !== Number(bank.parcelas);
      if(brandDiff){ status = 'CONCILIADO COM DIVERGÊNCIA DE BANDEIRA'; warnings.push('Bandeira ERP: ' + launch.bandeira + '; Cielo: ' + bank.bandeira); }
      else if(typeDiff){ status = 'CONCILIADO COM DIVERGÊNCIA DE TIPO'; warnings.push('Tipo ERP: ' + launch.modalidade + '; Cielo: ' + bank.modalidade); }
      else if(installmentsDiff){ status = 'CONCILIADO COM DIVERGÊNCIA DE PARCELAS'; warnings.push('Parcelas ERP: ' + launch.parcelas + '; Cielo: ' + bank.parcelas); }
      else status = 'CONCILIADO';
    }
    rows.push({
      lojaSistema: sale.loja, registro: sale.registro, documento: sale.documento, data: sale.data, horaSistema: sale.hora,
      valorSistemaCentavos: moneyCents(sale), valorSistema: sale.valor, sale: sale, launch: launch, bank: bank,
      cnpjCielo: bank && bank.cnpj || '', estabelecimentoCielo: bank && bank.estabelecimento || '', horaCielo: bank && bank.hora || '',
      valorBrutoCieloCentavos: bank ? moneyCents(bank) : null, valorBrutoCielo: bank ? bank.valor : null,
      taxaCieloCentavos: bank ? (Number.isInteger(bank.taxaCentavos) ? bank.taxaCentavos : moneyCents(bank, 'taxaValor')) : null,
      valorLiquidoCieloCentavos: bank ? moneyCents(bank, 'valorLiquido') : null,
      bandeiraSistema: launch && launch.bandeira || '', bandeiraCielo: bank && bank.bandeira || '',
      tipoSistema: launch && launch.modalidade || '', tipoCielo: bank && bank.modalidade || '',
      parcelasSistema: launch && launch.parcelas || null, parcelasCielo: bank && bank.parcelas || null,
      nsu: launch && launch.nsu || bank && bank.nsu || '', statusConciliacao: status, confidence: confidence,
      matchReasons: matchReasons, matchedBy: matchedBy, warnings: warnings, observacoes: warnings.join('; ')
    });
  });

  launchGroups.filter(function(group){ return !usedLaunches.has(group); }).forEach(function(group){
    rows.push({ lojaSistema: group.loja, registro: group.registro, data: group.data, valorSistema: null, launch: group, bank: null, statusConciliacao: group.possibleDuplicate ? 'POSSÍVEL DUPLICIDADE NOS LANÇAMENTOS' : 'NÃO ESPERADO NA CIELO', confidence: 'LOW', matchReasons: [], matchedBy: '', warnings: [group.possibleDuplicate ? group.duplicateReason : 'Lançamento sem linha correspondente na Relação'], observacoes: group.possibleDuplicate ? group.duplicateReason : 'Lançamento sem linha correspondente na Relação' });
  });
  mappedCielo.filter(function(bank){ return !usedCielo.has(bank); }).forEach(function(bank){
    rows.push({ lojaSistema: bank.loja || '', registro: '', data: bank.data, valorSistema: null, launch: null, bank: bank, cnpjCielo: bank.cnpj, estabelecimentoCielo: bank.estabelecimento, valorBrutoCielo: bank.valor, valorBrutoCieloCentavos: moneyCents(bank), statusConciliacao: 'SOMENTE CIELO', confidence: 'LOW', matchReasons: [], matchedBy: '', warnings: bank.mappingWarning ? [bank.mappingWarning] : ['Venda Cielo sem correspondente na Relação'], observacoes: bank.mappingWarning || 'Venda Cielo sem correspondente na Relação' });
  });
  return { rows: rows, cielo: mappedCielo, launchGroups: launchGroups };
}

function summarizeStores(rows, relation, cielo){
  var stores = Array.from(new Set(relation.map(function(tx){ return tx.loja; }).concat(cielo.map(function(tx){ return tx.loja || 'SEM MAPEAMENTO'; })))).sort(function(a,b){ return String(a).localeCompare(String(b), undefined, { numeric: true }); });
  return stores.map(function(loja){
    var storeRows = rows.filter(function(row){ return (row.lojaSistema || 'SEM MAPEAMENTO') === loja; });
    var rel = relation.filter(function(tx){ return tx.loja === loja; });
    var bank = cielo.filter(function(tx){ return (tx.loja || 'SEM MAPEAMENTO') === loja; });
    var reconciled = storeRows.filter(function(row){ return /^CONCILIADO/.test(row.statusConciliacao); });
    var divergenceCount = storeRows.filter(function(row){ return /DIVERGÊNCIA|DUPLICIDADE|AMBÍGUO/.test(row.statusConciliacao); }).length;
    var unmatchedCount = storeRows.filter(function(row){ return !/^CONCILIADO/.test(row.statusConciliacao) && !/LOJA SEM EXTRATO|OUTRA ADQUIRENTE|NÃO ESPERADO/.test(row.statusConciliacao); }).length;
    return {
      loja: loja, erpCentavos: rel.reduce(function(sum, tx){ return sum + moneyCents(tx); }, 0), cieloCentavos: bank.reduce(function(sum, tx){ return sum + moneyCents(tx); }, 0),
      conciliadoCentavos: reconciled.reduce(function(sum, row){ return sum + (row.valorSistemaCentavos || 0); }, 0),
      divergencias: divergenceCount, naoConciliado: unmatchedCount,
      situacao: storeRows.some(function(row){ return row.statusConciliacao === 'LOJA SEM EXTRATO CIELO'; }) ? 'SEM EXTRATO CIELO' : (divergenceCount || unmatchedCount ? 'REVISAR' : 'OK')
    };
  });
}

function matchModalidade(caixaList, bankList){
  var caixaRemain = caixaList.slice();
  var bankRemain = bankList.slice();
  var matched = [];

  for(var i = caixaRemain.length - 1; i >= 0; i--){
    var c = caixaRemain[i];
    var bestIdx = -1;
    for(var j = 0; j < bankRemain.length; j++){
      var b = bankRemain[j];
      if(isDateMatch(c, b) && Math.abs(c.valor - b.valor) <= 0.009){ bestIdx = j; break; }
    }
    if(bestIdx >= 0){
      matched.push({ caixa: c, banco: bankRemain[bestIdx] });
      bankRemain.splice(bestIdx, 1);
      caixaRemain.splice(i, 1);
    }
  }

  var divergValor = [];
  for(var i2 = caixaRemain.length - 1; i2 >= 0; i2--){
    var c2 = caixaRemain[i2];
    var bestIdx2 = -1;
    for(var j2 = 0; j2 < bankRemain.length; j2++){
      var b2 = bankRemain[j2];
      if(isDateMatch(c2, b2)){ bestIdx2 = j2; break; }
    }
    if(bestIdx2 >= 0){
      divergValor.push({ caixa: c2, banco: bankRemain[bestIdx2] });
      bankRemain.splice(bestIdx2, 1);
      caixaRemain.splice(i2, 1);
    }
  }

  return { matched: matched, divergValor: divergValor, ausentes: caixaRemain, sobras: bankRemain };
}

function matchCardTransactions(caixaList, bankList){
  var left = caixaList.slice(), right = bankList.slice(), matched = [], divergValor = [];
  function pairPass(requireValue){
    var changed = true;
    while(changed){
      changed = false;
      function candidates(c){
        return right.map(function(b){
          if(c.data !== b.data || (requireValue && cents(c.valor) !== cents(b.valor))) return null;
          var distance = c.hora && b.hora ? timeDiffMinutes(c.hora, b.hora) : Infinity;
          if(!requireValue && distance > 2) return null;
          return { caixa: c, banco: b, distance: distance };
        }).filter(Boolean).sort(function(a,b){ return a.distance - b.distance; });
      }
      for(var i = 0; i < left.length; i++){
        var choices = candidates(left[i]);
        if(!choices.length || (choices.length > 1 && choices[0].distance === choices[1].distance)) continue;
        var choice = choices[0];
        var competitors = left.filter(function(c){
          return c !== choice.caixa && c.data === choice.banco.data && (!requireValue || cents(c.valor) === cents(choice.banco.valor)) && ((!c.hora || !choice.banco.hora) ? Infinity : timeDiffMinutes(c.hora, choice.banco.hora)) <= choice.distance;
        });
        if(competitors.length) continue;
        // Horários distantes não confirmam identidade, mesmo com valor único.
        choice.confidence = choice.distance <= 2 ? 'horario' : 'valor';
        (requireValue ? matched : divergValor).push(choice);
        left.splice(i, 1); right.splice(right.indexOf(choice.banco), 1);
        changed = true; break;
      }
    }
  }
  pairPass(true);
  pairPass(false);
  return { matched: matched, divergValor: divergValor, ausentes: left, sobras: right };
}

function reconcile(caixaTx, sicrediTx, cieloTx){
  var bancoTx = cieloTx.length ? cieloTx : sicrediTx;
  var origem = cieloTx.length ? 'Cielo' : 'Extrato PIX';
  var resultado = cieloTx.length ? matchCardTransactions(caixaTx, bancoTx) : matchModalidade(caixaTx, bancoTx);
  var divergences = [];

  function pushDiverg(tipo, item, modalidadeLabel){
    if(tipo === 'valor_divergente'){
      divergences.push({
        tipo: tipo, modalidade: modalidadeLabel,
        data: item.caixa.data, hora: item.caixa.hora || item.banco.hora || '—',
        documento: item.caixa.documento || '—',
        valorCaixa: item.caixa.valor, valorBanco: item.banco.valor,
        origemBanco: item.banco.origem
      });
    } else if(tipo === 'ausente_banco'){
      divergences.push({
        tipo: tipo, modalidade: modalidadeLabel,
        data: item.data, hora: item.hora || '—',
        documento: item.documento || '—',
        valorCaixa: item.valor, valorBanco: null, origemBanco: '—'
      });
    } else if(tipo === 'sobra_banco'){
      divergences.push({
        tipo: tipo, modalidade: modalidadeLabel,
        data: item.data, hora: item.hora || '—',
        documento: item.documento || '—',
        valorCaixa: null, valorBanco: item.valor, origemBanco: item.origem
      });
    }
  }

  resultado.divergValor.forEach(function(item){ pushDiverg('valor_divergente', item, origem); });
  resultado.ausentes.forEach(function(item){ pushDiverg('ausente_banco', item, origem); });
  resultado.sobras.forEach(function(item){ pushDiverg('sobra_banco', item, origem); });

  function sumBy(list){ return sumValues(list); }

  var summary = [{
    modalidade: 'Caixa × ' + origem,
    caixa: sumBy(caixaTx), banco: sumBy(bancoTx),
    batidos: resultado.matched.length, totalCaixaCount: caixaTx.length
  }];

  return { divergences: divergences, summary: summary, pairs: resultado };
}

function buildCardAudit(caixa, launchLines, cielo, pairs){
  var groups = aggregateCardLaunches(launchLines), used = new Set(), rows = [];
  caixa.forEach(function(sale){
    var internal = groups.filter(function(g){ return g.registro === sale.registro && g.data === sale.data && g.loja === sale.loja; });
    var pair = pairs.matched.concat(pairs.divergValor).find(function(p){ return p.caixa === sale; });
    var issues = [], launch = internal.length === 1 ? internal[0] : null;
    if(caixa.filter(function(other){ return other.data === sale.data && other.loja === sale.loja && other.registro === sale.registro; }).length > 1) issues.push('Registro repetido na Relação');
    internal.forEach(function(g){ used.add(g); });
    if(internal.length === 0) issues.push('Sem lançamento interno');
    if(internal.length > 1) issues.push('Mais de um lançamento para o registro');
    if(launch && cents(launch.valor) !== cents(sale.valor)) issues.push('Valor interno divergente');
    if(launch && (launch.linhas.length !== launch.parcelas || launch.linhas.some(function(l){ return l.parcelas !== launch.parcelas; }))) issues.push('Parcelas internas incompletas ou repetidas');
    if(!pair) issues.push('Sem correspondência segura na Cielo');
    if(pair && pair.confidence !== 'horario') issues.push('Conferir vínculo: apenas data e valor');
    if(pair && cents(sale.valor) !== cents(pair.banco.valor)) issues.push('Valor Cielo divergente');
    var reliable = issues.length === 0 && launch && pair;
    var brand = false, mode = false, installments = false;
    if(reliable){
      if(!launch.bandeira || !pair.banco.bandeira) issues.push('Bandeira não identificada');
      else if(launch.bandeira !== pair.banco.bandeira){ brand = true; issues.push('Bandeira divergente'); }
      if(!/^(Debito|Credito)$/.test(launch.modalidade) || !/^(Debito|Credito)$/.test(pair.banco.modalidade)) issues.push('Modalidade não identificada');
      else if(launch.modalidade !== pair.banco.modalidade){ mode = true; issues.push('Débito / crédito divergente'); }
      if(!launch.parcelas || !pair.banco.parcelas) issues.push('Parcelas não identificadas');
      else if(launch.parcelas !== pair.banco.parcelas){ installments = true; issues.push('Parcelas divergentes'); }
    }
    rows.push({ sale: sale, launch: launch, bank: pair ? pair.banco : null, issues: issues, brand: brand, mode: mode, installments: installments, internalOK: internal.length === 1 && launch && cents(launch.valor) === cents(sale.valor), confidence: pair ? pair.confidence : null });
  });
  groups.filter(function(g){ return !used.has(g); }).forEach(function(g){ rows.push({ sale: null, launch: g, bank: null, issues: ['Lançamento sem venda na Relação'], internalOK: false }); });
  pairs.sobras.forEach(function(b){ rows.push({ sale: null, launch: null, bank: b, issues: ['Venda Cielo sem correspondência segura'], internalOK: false }); });
  rows.sort(function(a,b){ var x = a.sale || a.launch || a.bank, y = b.sale || b.launch || b.bank; return (x.data + (x.hora || '') + (x.registro || '')).localeCompare(y.data + (y.hora || '') + (y.registro || '')); });
  return { rows: rows, groups: groups, lineCount: launchLines.length, internalCount: rows.filter(function(r){ return r.internalOK; }).length };
}

/* =========================================================================
   UI — DROPZONE / SLOTS
   ========================================================================= */
function mappingRowHtml(item){
  var fields = ['loja','razaoSocial','cnpj','conta','estabelecimento','observacoes'];
  function input(field){ return '<input data-map-field="' + field + '" value="' + escapeHtml(item[field] || '') + '" aria-label="' + field + '">'; }
  return '<tr>' + fields.slice(0, 5).map(function(field){ return '<td>' + input(field) + '</td>'; }).join('') + '<td><input type="checkbox" data-map-field="cieloDisponivel" ' + (item.cieloDisponivel !== false ? 'checked' : '') + ' aria-label="Extrato acessível"></td><td>' + input('observacoes') + '</td></tr>';
}
function renderMappings(){ document.getElementById('mappingBody').innerHTML = state.mappings.map(mappingRowHtml).join(''); }
function readMappingsFromForm(){
  return Array.from(document.querySelectorAll('#mappingBody tr')).map(function(row){
    var item = {};
    row.querySelectorAll('[data-map-field]').forEach(function(input){ item[input.dataset.mapField] = input.type === 'checkbox' ? input.checked : input.value.trim(); });
    return item;
  }).filter(function(item){ return item.loja; });
}
renderMappings();
document.getElementById('btnAddMapping').addEventListener('click', function(){ state.mappings.push({ loja:'', razaoSocial:'', cnpj:'', conta:'', estabelecimento:'', cieloDisponivel:true, observacoes:'' }); renderMappings(); });
document.getElementById('btnSaveMappings').addEventListener('click', function(){
  var mappings = readMappingsFromForm();
  var duplicateStores = mappings.some(function(item, index){ return mappings.findIndex(function(other){ return String(other.loja) === String(item.loja); }) !== index; });
  if(duplicateStores){ showToast('Há lojas ERP duplicadas no mapeamento.', true); return; }
  saveCompanyMappings(mappings); invalidateResults(); showToast('Mapeamento salvo neste navegador.');
});

var dropzone = document.getElementById('dropzone');
var fileInput = document.getElementById('fileInput');
document.getElementById('btnAddDetails').addEventListener('click', function(){ fileInput.click(); });

function invalidateResults(){
  state.processedOnce = false;
  state.cardAudit = null;
  document.getElementById('resultsWrap').classList.remove('show');
  document.getElementById('btnExport').disabled = true;
}

dropzone.addEventListener('click', function(){ fileInput.click(); });
dropzone.addEventListener('keydown', function(e){ if(e.key === 'Enter' || e.key === ' ') fileInput.click(); });

['dragenter','dragover'].forEach(function(ev){
  dropzone.addEventListener(ev, function(e){ e.preventDefault(); dropzone.classList.add('drag'); });
});
['dragleave','drop'].forEach(function(ev){
  dropzone.addEventListener(ev, function(e){ e.preventDefault(); dropzone.classList.remove('drag'); });
});
dropzone.addEventListener('drop', function(e){
  var files = Array.from(e.dataTransfer.files || []);
  handleIncomingFiles(files);
});
fileInput.addEventListener('change', function(e){
  var files = Array.from(e.target.files || []);
  handleIncomingFiles(files);
  fileInput.value = '';
});

async function handleIncomingFiles(files){
  if(!files.length) return;
  showOverlay('Identificando arquivos…');
  try{
    for(var fi = 0; fi < files.length; fi++){
      var file = files[fi];
      var ext = file.name.split('.').pop().toLowerCase();
      if(ext === 'pdf'){
        var type = await detectPdfType(file);
        if(type === 'caixa' || type === 'cielo' || type === 'lancamentos'){
          if((type === 'cielo' || type === 'lancamentos') && state.files.sicredi.length > 0){
            showToast('Use somente um comparativo por vez: Cielo ou Extrato PIX.', true);
          } else {
            assignFile(type, file);
          }
        } else {
          showToast('Não foi possível identificar o modelo do PDF "' + file.name + '".', true);
        }
      } else if(ext === 'xls' || ext === 'xlsx'){
        var type2 = await detectXlsxType(file);
        if(type2 === 'cielo'){
          if(state.files.sicredi.length > 0) showToast('Use somente um comparativo por vez: Cielo ou Extrato PIX.', true);
          else assignFile('cielo', file);
        } else if(type2 === 'sicredi'){
          if(state.files.cielo.length > 0 || state.files.lancamentos.length > 0) showToast('Remova os arquivos de cartões para usar o extrato PIX.', true);
          else assignFile('sicredi', file);
        } else {
          showToast('Não foi possível identificar o tipo de "' + file.name + '". Verifique o layout do arquivo.', true);
        }
      } else {
        showToast('Formato não suportado: ' + file.name, true);
      }
    }
  } finally {
    hideOverlay();
    updateProcessButtonState();
  }
}

function assignFile(slot, file){
  if(state.files[slot].some(function(f){ return f.name === file.name && f.size === file.size && f.lastModified === file.lastModified; })){
    showToast('Este arquivo já foi adicionado.', true); return;
  }
  invalidateResults();
  if(slot === 'caixa' || slot === 'lancamentos') state.files[slot] = [];
  state.files[slot].push(file);
  var el = document.getElementById('slot-' + slot);
  el.classList.remove('empty');
  el.classList.add('filled');
  if(state.files[slot].length === 1){
    el.querySelector('.fs-name').textContent = file.name;
  } else {
    el.querySelector('.fs-name').textContent = state.files[slot].length + ' arquivos';
  }
  el.querySelector('.fs-status').textContent = 'Pronto para processar';
  el.querySelector('.fs-icon').textContent = file.name.split('.').pop().toUpperCase();
  el.querySelector('.fs-remove').style.display = 'inline-flex';
  if(slot === 'cielo') document.getElementById('cieloFileList').innerHTML = state.files.cielo.map(function(item){ return '<li title="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</li>'; }).join('');
}

function clearSlot(slot){
  invalidateResults();
  state.files[slot] = [];
  var el = document.getElementById('slot-' + slot);
  el.classList.remove('filled');
  el.classList.add('empty');
  el.querySelector('.fs-name').textContent = 'Nenhum arquivo';
  el.querySelector('.fs-status').textContent = 'Aguardando envio';
  el.querySelector('.fs-remove').style.display = 'none';
  if(slot === 'cielo') document.getElementById('cieloFileList').innerHTML = '';
  updateProcessButtonState();
}

document.querySelectorAll('.fs-remove').forEach(function(btn){
  btn.addEventListener('click', function(e){
    e.stopPropagation();
    clearSlot(btn.dataset.slot);
  });
});

function updateProcessButtonState(){
  var hasCaixa = state.files.caixa.length > 0;
  var hasComparativo = state.files.sicredi.length > 0 || state.files.cielo.length > 0;
  var needsLaunches = state.files.cielo.length > 0;
  var ready = hasCaixa && hasComparativo && (!needsLaunches || state.files.lancamentos.length === 1);
  document.getElementById('btnProcess').disabled = !ready;
  var hint = document.getElementById('processHint');
  if(!hasCaixa && !hasComparativo){
    hint.textContent = 'Envie o relatório de Caixa e um relatório Cielo ou extrato PIX.';
  } else if(!hasCaixa){
    hint.textContent = 'Falta o relatório "Relação de Vendas por Período" do Caixa.';
  } else if(!hasComparativo){
    hint.textContent = 'Envie o "Detalhado de vendas Cielo" ou a planilha de extrato PIX.';
  } else if(needsLaunches && !state.files.lancamentos.length){
    hint.textContent = 'Falta o relatório geral de Lançamentos de Cartão.';
  } else {
    hint.textContent = state.files.cielo.length > 1 ? state.files.cielo.length + ' extratos Cielo prontos para processar.' : 'Arquivos prontos para processar.';
  }
  document.getElementById('btnAddDetails').hidden = state.files.lancamentos.length > 0;
  document.querySelector('.detail-upload').classList.toggle('is-ready', state.files.lancamentos.length > 0);
  document.getElementById('slot-sicredi').hidden = state.files.cielo.length > 0;
  document.getElementById('slot-cielo').hidden = state.files.sicredi.length > 0;
  document.querySelector('.file-slots').classList.toggle('has-comparative', hasComparativo);
}

/* =========================================================================
   PROCESSAMENTO PRINCIPAL
   ========================================================================= */
document.getElementById('btnProcess').addEventListener('click', async function(){
  showOverlay('Lendo arquivos…');
  try{
    var caixaTx = [], sicrediTx = [], cieloTx = [], launchTx = [];
    invalidateResults();

    if(state.files.caixa.length === 0 || (state.files.sicredi.length === 0 && state.files.cielo.length === 0)){
      throw new Error('Envie relatórios do Caixa e arquivos de um comparativo.');
    }

    if(state.files.caixa.length > 0){
      showOverlay('Extraindo texto do(s) PDF(s) do caixa.');
      for(var ci = 0; ci < state.files.caixa.length; ci++){
        var lines = await extractPdfLines(state.files.caixa[ci]);
        caixaTx = caixaTx.concat(parseCaixaLines(lines));
      }
      if(caixaTx.length === 0){
        showToast('Os PDFs foram lidos, mas nenhuma linha de venda foi reconhecida. Verifique o layout.', true);
      }
    }
    if(state.files.sicredi.length > 0){
      showOverlay('Lendo extrato(s) Sicredi.');
      for(var si = 0; si < state.files.sicredi.length; si++){
        sicrediTx = sicrediTx.concat(await parseSicredi(state.files.sicredi[si]));
      }
    }
    if(state.files.cielo.length > 0){
      showOverlay('Lendo extrato(s) Cielo.');
      for(var ci2 = 0; ci2 < state.files.cielo.length; ci2++){
        cieloTx = cieloTx.concat(await parseCielo(state.files.cielo[ci2]));
      }
    }

    if(!caixaTx.length || !(cieloTx.length || sicrediTx.length)) throw new Error('Um dos relatórios não contém vendas reconhecidas. Confira o período e o formato.');
    if(cieloTx.length && !state.files.lancamentos.length) throw new Error('Envie o relatório geral de Lançamentos de Cartão para processar a Cielo.');
    if(state.files.lancamentos.length){
      if(!cieloTx.length) throw new Error('A conferência de cartões precisa do relatório Cielo.');
      showOverlay('Consolidando parcelas e conferindo os lançamentos…');
      for(var li = 0; li < state.files.lancamentos.length; li++) launchTx = launchTx.concat(parseCardLaunchLines(await extractPdfLines(state.files.lancamentos[li])));
    }

    showOverlay('Cruzando transações…');
    if(cieloTx.length){
      validatePeriods(caixaTx, launchTx, cieloTx);
      var audit = buildConsolidatedAudit(caixaTx, launchTx, cieloTx, state.mappings, MATCH_TOLERANCE_MINUTES);
      cieloTx = audit.cielo;
      state.consolidated = audit.rows;
      state.storeSummary = summarizeStores(audit.rows, caixaTx, cieloTx);
      var matchedRows = audit.rows.filter(function(row){ return row.sale && row.bank && row.statusConciliacao !== 'DIVERGÊNCIA DE VALOR'; });
      var valueRows = audit.rows.filter(function(row){ return row.sale && row.bank && row.statusConciliacao === 'DIVERGÊNCIA DE VALOR'; });
      var missingRows = audit.rows.filter(function(row){ return row.sale && !row.bank && !/LOJA SEM EXTRATO|OUTRA ADQUIRENTE|NÃO ESPERADO/.test(row.statusConciliacao); });
      var cieloOnlyRows = audit.rows.filter(function(row){ return row.statusConciliacao === 'SOMENTE CIELO'; });
      state.pairs = {
        matched: matchedRows.map(function(row){ return { caixa: row.sale, banco: row.bank, confidence: row.confidence === 'HIGH' ? 'horario' : 'revisao' }; }),
        divergValor: valueRows.map(function(row){ return { caixa: row.sale, banco: row.bank, confidence: 'revisao' }; }),
        ausentes: missingRows.map(function(row){ return row.sale; }), sobras: cieloOnlyRows.map(function(row){ return row.bank; })
      };
      state.divergences = audit.rows.filter(function(row){ return !/^CONCILIADO$/.test(row.statusConciliacao) && !/LOJA SEM EXTRATO|OUTRA ADQUIRENTE|NÃO ESPERADO/.test(row.statusConciliacao); }).map(function(row){
        return { tipo: row.statusConciliacao === 'DIVERGÊNCIA DE VALOR' ? 'valor_divergente' : row.statusConciliacao === 'SOMENTE CIELO' ? 'sobra_banco' : 'ausente_banco', modalidade: row.statusConciliacao, data: row.data, hora: row.horaSistema || row.horaCielo || '—', documento: row.documento || row.registro || '—', valorCaixa: row.valorSistema, valorBanco: row.valorBrutoCielo, origemBanco: row.bank ? 'Cielo' : '—' };
      });
      state.summary = [{ modalidade: 'Todas as lojas · ERP × Cielo', caixa: sumValues(caixaTx), banco: sumValues(cieloTx), batidos: matchedRows.filter(function(row){ return row.confidence === 'HIGH'; }).length, totalCaixaCount: caixaTx.length }];
    }else{
      var result = reconcile(caixaTx, sicrediTx, cieloTx);
      state.consolidated = [];
      state.storeSummary = [];
      state.divergences = result.divergences;
      state.summary = result.summary;
      state.pairs = result.pairs;
    }
    state.parsed = { caixa: caixaTx, sicredi: sicrediTx, cielo: cieloTx, lancamentos: launchTx };
    state.cardAudit = null;
    state.cardFilter = 'pending';
    document.getElementById('cardSearch').value = '';
    state.processedOnce = true;

    renderResults();
    showToast('Conciliação processada com sucesso.');
  } catch(err){
    console.error(err);
    showToast('Erro ao processar: ' + err.message, true);
  } finally {
    hideOverlay();
  }
});

/* =========================================================================
   RENDER
   ========================================================================= */
function renderConsolidated(){
  var filter = document.getElementById('storeFilter');
  var selected = filter.value || 'all';
  filter.innerHTML = '<option value="all">Todas as lojas</option>' + state.storeSummary.map(function(item){ return '<option value="' + escapeHtml(item.loja) + '">Loja ' + escapeHtml(item.loja) + '</option>'; }).join('');
  filter.value = state.storeSummary.some(function(item){ return item.loja === selected; }) ? selected : 'all';
  var visibleSummary = state.storeSummary.filter(function(item){ return filter.value === 'all' || item.loja === filter.value; });
  document.getElementById('storeSummaryBody').innerHTML = visibleSummary.map(function(item){
    var badgeClass = item.situacao === 'OK' ? 'ok' : item.situacao === 'REVISAR' ? 'warn' : 'error';
    return '<tr data-store="' + escapeHtml(item.loja) + '"><td><strong>Loja ' + escapeHtml(item.loja) + '</strong></td><td class="num">' + fmtBRL(item.erpCentavos / 100) + '</td><td class="num">' + fmtBRL(item.cieloCentavos / 100) + '</td><td class="num">' + fmtBRL(item.conciliadoCentavos / 100) + '</td><td class="num">' + item.divergencias + '</td><td class="num">' + item.naoConciliado + '</td><td><span class="audit-status ' + badgeClass + '">' + escapeHtml(item.situacao) + '</span></td></tr>';
  }).join('');
  var rows = state.consolidated.filter(function(row){ return filter.value === 'all' || (row.lojaSistema || 'SEM MAPEAMENTO') === filter.value; });
  document.getElementById('consolidatedCount').textContent = rows.length + ' itens';
  document.getElementById('consolidatedBody').innerHTML = rows.map(function(row){
    var ok = /^CONCILIADO$/.test(row.statusConciliacao), warn = /DIVERGÊNCIA|DUPLICIDADE|AMBÍGUO/.test(row.statusConciliacao);
    var statusClass = ok ? 'ok' : warn ? 'warn' : 'error';
    var systemCard = [row.bandeiraSistema, row.tipoSistema, row.parcelasSistema ? row.parcelasSistema + 'x' : '', row.nsu ? 'NSU ' + row.nsu : ''].filter(Boolean).join(' · ') || 'Não identificado';
    var cieloCard = [row.bandeiraCielo, row.tipoCielo, row.parcelasCielo ? row.parcelasCielo + 'x' : '', row.estabelecimentoCielo].filter(Boolean).join(' · ') || 'Sem vínculo';
    var reasons = (row.matchReasons || []).concat(row.warnings || []);
    return '<tr><td><strong>Loja ' + escapeHtml(row.lojaSistema || '—') + '</strong><small>Registro ' + escapeHtml(row.registro || '—') + (row.documento ? ' · Documento ' + escapeHtml(row.documento) : '') + '</small></td><td>' + (row.data ? formatDateBR(row.data) : '—') + '<small>ERP ' + escapeHtml(row.horaSistema || '—') + ' · Cielo ' + escapeHtml(row.horaCielo || '—') + '</small></td><td class="num">' + (row.valorSistema == null ? '—' : fmtBRL(row.valorSistema)) + '</td><td class="num">' + (row.valorBrutoCielo == null ? '—' : fmtBRL(row.valorBrutoCielo)) + '</td><td><small><strong>ERP:</strong> ' + escapeHtml(systemCard) + '</small><small><strong>Cielo:</strong> ' + escapeHtml(cieloCard) + '</small></td><td><span class="audit-status ' + statusClass + '">' + escapeHtml(row.statusConciliacao) + '</span><small>Confiança ' + escapeHtml(row.confidence || 'LOW') + '</small>' + (reasons.length ? '<details class="audit-reasons"><summary>Ver evidências</summary>' + reasons.map(function(reason){ return '<div>• ' + escapeHtml(reason) + '</div>'; }).join('') + '</details>' : '') + '</td></tr>';
  }).join('');
}

function renderResults(){
  document.getElementById('resultsWrap').classList.add('show');

  var caixa = state.parsed.caixa, sicredi = state.parsed.sicredi, cielo = state.parsed.cielo;
  document.getElementById('mSicredi').closest('.metric-card').hidden = cielo.length > 0;
  document.getElementById('mCielo').closest('.metric-card').hidden = !cielo.length;
  document.getElementById('analysisMode').textContent = cielo.length ? 'Conciliação multiloja · 3 fontes' : 'Conciliação de valores';
  document.getElementById('analysisScope').textContent = cielo.length ? 'Relação = base financeira · Cielo bruto = confirmação · Lançamentos = enriquecimento' : 'Bandeira e modalidade internas não verificadas';
  if(!cielo.length) document.getElementById('analysisScope').textContent = 'Recebimentos PIX';
  document.getElementById('tab-cards').hidden = !state.cardAudit;
  selectResultView('overview');
  document.getElementById('mCaixa').textContent = fmtBRL(caixa.reduce(function(s,t){ return s+t.valor; },0));
  document.getElementById('mCaixaSub').textContent = caixa.length + ' lançamentos';
  document.getElementById('mSicredi').textContent = fmtBRL(sicredi.reduce(function(s,t){ return s+t.valor; },0));
  document.getElementById('mSicrediSub').textContent = sicredi.length + ' lançamentos';
  document.getElementById('mCielo').textContent = fmtBRL(cielo.reduce(function(s,t){ return s+t.valor; },0));
  document.getElementById('mCieloSub').textContent = cielo.length + ' lançamentos';
  renderConsolidated();

  var statusEl = document.getElementById('mStatus');
  var statusSub = document.getElementById('mStatusSub');
  if(state.divergences.length === 0){
    statusEl.textContent = 'Valores conciliados';
    statusEl.className = 'status-badge ok';
    statusSub.textContent = 'Todas as transações foram batidas';
  } else {
    statusEl.textContent = 'Divergente';
    statusEl.className = 'status-badge bad';
    statusSub.textContent = state.divergences.length + ' pendência(s) encontrada(s)';
  }
  if(state.cardAudit){
    var pending = state.cardAudit.rows.filter(function(r){ return r.issues.length; }).length;
    if(pending){ statusEl.textContent = 'Conferir cartões'; statusEl.className = 'status-badge review'; statusSub.textContent = pending + ' venda(s) com pendências nos detalhes'; }
    document.getElementById('valueEmptyNote').textContent = pending ? 'Os valores batem. Há ' + pending + ' venda(s) para revisar na aba Detalhes dos cartões.' : 'Valores e dados dos cartões conferidos nos relatórios enviados.';
    renderCardAudit();
  } else {
    document.getElementById('valueEmptyNote').textContent = 'Nenhuma divergência de valor encontrada. Adicione os Lançamentos para conferir os dados internos dos cartões.';
  }

  document.getElementById('lastRunLabel').textContent = 'Processado em ' + new Date().toLocaleString('pt-BR');

  // Tabela resumo
  var summaryBody = document.getElementById('summaryBody');
  summaryBody.innerHTML = '';
  state.summary.forEach(function(row){
    var tr = document.createElement('tr');
    if(row.info){
      tr.innerHTML = '<td><strong>' + row.modalidade + '</strong> <span style="font-size:11px;color:var(--gray-400);font-weight:500;">(sem comparação bancária)</span></td><td class="num">' + fmtBRL(row.caixa) + '</td><td class="num">—</td><td class="num diff-zero">—</td><td class="num">' + row.totalCaixaCount + '</td>';
    } else {
      var diff = (cents(row.caixa) - cents(row.banco)) / 100;
      var diffClass = Math.abs(diff) < 0.01 ? 'diff-zero' : (diff > 0 ? 'diff-neg' : 'diff-pos');
      tr.innerHTML = '<td><strong>' + row.modalidade + '</strong></td><td class="num">' + fmtBRL(row.caixa) + '</td><td class="num">' + fmtBRL(row.banco) + '</td><td class="num ' + diffClass + '">' + fmtBRL(diff) + '</td><td class="num">' + row.batidos + '/' + row.totalCaixaCount + '</td>';
    }
    summaryBody.appendChild(tr);
  });

  // Tabela divergências
  var divBody = document.getElementById('divergenceBody');
  var divEmpty = document.getElementById('divEmpty');
  divBody.innerHTML = '';
  document.getElementById('divCount').textContent = state.divergences.length + ' itens';

  if(state.divergences.length === 0){
    divEmpty.style.display = 'block';
  } else {
    divEmpty.style.display = 'none';
    state.divergences.slice().sort(function(a,b){ return (a.data || '').localeCompare(b.data || ''); }).forEach(function(d){
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + badgeFor(d.tipo) + '</td><td>' + (MODAL_LABEL[d.modalidade] || d.modalidade) + '</td><td class="mono">' + (d.data ? formatDateBR(d.data) : '—') + '</td><td class="mono">' + (d.hora || '—') + '</td><td class="mono">' + (d.documento || '—') + '</td><td class="num">' + (d.valorCaixa !== null && d.valorCaixa !== undefined ? fmtBRL(d.valorCaixa) : '—') + '</td><td class="num">' + (d.valorBanco !== null && d.valorBanco !== undefined ? fmtBRL(d.valorBanco) : '—') + '</td><td>' + (d.origemBanco || '—') + '</td>';
      divBody.appendChild(tr);
    });
  }

  document.getElementById('btnExport').disabled = state.divergences.length === 0;

  // Source compare
  var comparativo = cielo.length ? cielo : sicredi;
  var comparativoNome = cielo.length ? 'Cielo' : 'Extrato PIX';
  document.getElementById('sourceBTitle').textContent = 'B · ' + comparativoNome;
  document.getElementById('sourceBNote').textContent = cielo.length
    ? 'Vendas aprovadas da Cielo. O cruzamento usa data, valor e proximidade de horário; os pares são os mesmos da conciliação. Sem vínculo único, a venda fica sem correspondência.'
    : 'Somente lançamentos "RECEBIMENTO PIX" extraídos da planilha. Valores iguais ficam na mesma linha do Caixa.';

  function escapeHtml(value){
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var countA = 0, countB = 0;
  function sourceCells(t, divider){
    var dividerClass = divider ? ' side-divider' : '';
    if(!t) return '<td colspan="6" class="missing-side' + dividerClass + '">— sem lançamento correspondente —</td>';
    var num = divider ? ++countB : ++countA;
    var raw = t.raw || '—';
    return '<td class="num' + dividerClass + '" style="color:var(--gray-400);font-size:11px;text-align:center;">' + num + '</td><td class="mono" style="text-align:center;">' + (t.data ? formatDateBR(t.data) : '—') + '</td><td class="mono" style="text-align:center;">' + (t.hora || '—') + '</td><td class="mono" style="text-align:center;">' + escapeHtml(t.documento || '—') + '</td><td class="num">' + fmtBRL(t.valor) + '</td><td class="raw" title="' + escapeHtml(raw) + '">' + escapeHtml(raw) + '</td>';
  }
  var alignedRows = state.pairs.matched.concat(state.pairs.divergValor).map(function(p){ return { left: p.caixa, right: p.banco, confidence: p.confidence }; });
  state.pairs.ausentes.forEach(function(t){ alignedRows.push({ left: t, right: null }); });
  state.pairs.sobras.forEach(function(t){ alignedRows.push({ left: null, right: t }); });
  alignedRows.sort(function(a,b){ var x = a.left || a.right, y = b.left || b.right; return (x.data + (x.hora || '')).localeCompare(y.data + (y.hora || '')); });
  state.alignedRows = alignedRows;
  document.getElementById('sourceCompareCount').textContent = alignedRows.length + ' linhas';
  var compareBody = document.getElementById('sourceCompareBody');
  compareBody.innerHTML = '';
  var hasDivergences = false;
  alignedRows.forEach(function(row){
    var isDivergent = !row.left || !row.right || cents(row.left.valor) !== cents(row.right.valor);
    if(isDivergent) hasDivergences = true;
    var tr = document.createElement('tr');
    if(isDivergent) tr.classList.add('has-divergence');
    tr.innerHTML = sourceCells(row.left, false) + sourceCells(row.right, true);
    compareBody.appendChild(tr);
  });
  
  document.getElementById('btnPrevDivergence').style.display = hasDivergences ? 'inline-flex' : 'none';
  document.getElementById('btnNextDivergence').style.display = hasDivergences ? 'inline-flex' : 'none';
  document.getElementById('btnExportCompare').style.display = alignedRows.length > 0 ? 'inline-flex' : 'none';
  window._concDivIdx = -1;
}

document.getElementById('storeFilter').addEventListener('change', renderConsolidated);

function selectResultView(view){
  document.querySelectorAll('[data-view]').forEach(function(button){
    var active = button.dataset.view === view;
    button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    document.getElementById('view-' + button.dataset.view).hidden = !active;
  });
}
document.querySelectorAll('[data-view]').forEach(function(button){
  button.addEventListener('click', function(){ selectResultView(button.dataset.view); });
  button.addEventListener('keydown', function(event){
    if(!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    var tabs = Array.from(document.querySelectorAll('[data-view]')).filter(function(tab){ return !tab.hidden; });
    var index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(button) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectResultView(tabs[index].dataset.view); tabs[index].focus();
  });
});

function cardGroups(){
  var groups = new Map();
  function add(list, side){ list.forEach(function(tx){
    var key = (tx.bandeira || 'Não identificada') + ' · ' + (MODAL_LABEL[tx.modalidade] || 'Não identificado');
    if(!groups.has(key)) groups.set(key, { categoria: key, sistema: 0, cielo: 0, qtdSistema: 0, qtdCielo: 0 });
    var g = groups.get(key); g[side] += cents(tx.valor); g[side === 'sistema' ? 'qtdSistema' : 'qtdCielo']++;
  }); }
  add(state.cardAudit.groups, 'sistema'); add(state.parsed.cielo, 'cielo');
  return Array.from(groups.values()).sort(function(a,b){ return a.categoria.localeCompare(b.categoria); });
}

function renderCardAudit(){
  var audit = state.cardAudit, rows = audit.rows;
  var pending = rows.filter(function(r){ return r.issues.length; });
  document.getElementById('cardTabCount').textContent = pending.length;
  var metrics = [
    ['Vendas conferidas', rows.filter(function(r){ return !r.issues.length; }).length, state.parsed.caixa.length + ' vendas na Relação', 'good'],
    ['Bandeira divergente', rows.filter(function(r){ return r.brand; }).length, 'Sistema diferente da Cielo', 'warn'],
    ['Débito / crédito', rows.filter(function(r){ return r.mode; }).length, 'Modalidade divergente', 'warn'],
    ['Outras pendências', rows.filter(function(r){ return r.issues.length && !r.brand && !r.mode; }).length, 'Parcelas, valores ou vínculo', 'neutral']
  ];
  document.getElementById('cardMetrics').innerHTML = metrics.map(function(m){ return '<div class="detail-metric ' + m[3] + '"><span>' + m[0] + '</span><strong>' + m[1] + '</strong><small>' + m[2] + '</small></div>'; }).join('');
  var integrityOK = audit.internalCount === state.parsed.caixa.length && audit.groups.length === state.parsed.caixa.length && !rows.some(function(r){ return r.issues.some(function(i){ return /internas|interno|registro|Relação/.test(i); }); });
  var banner = document.getElementById('cardIntegrity');
  banner.className = 'integrity-banner ' + (integrityOK ? 'good' : 'warn');
  banner.innerHTML = '<span class="integrity-symbol">' + (integrityOK ? '✓' : '!') + '</span><div><strong>' + (integrityOK ? 'Relatórios internos consistentes' : 'Confira a cobertura dos relatórios internos') + '</strong><p>' + audit.lineCount + ' linhas de parcelas → ' + audit.groups.length + ' vendas consolidadas. ' + audit.internalCount + ' de ' + state.parsed.caixa.length + ' registros fecham em valor com a Relação. Total dos lançamentos: ' + fmtBRL(sumValues(audit.groups)) + '.</p></div>';
  document.getElementById('cardGroupBody').innerHTML = cardGroups().map(function(g){ return '<tr><td>' + escapeHtml(g.categoria) + '</td><td class="num">' + g.qtdSistema + '</td><td class="num">' + fmtBRL(g.sistema / 100) + '</td><td class="num">' + g.qtdCielo + '</td><td class="num">' + fmtBRL(g.cielo / 100) + '</td><td class="num ' + (g.sistema === g.cielo ? 'diff-zero' : 'diff-neg') + '">' + fmtBRL((g.sistema - g.cielo) / 100) + '</td></tr>'; }).join('');
  var netSystem = sumValues(audit.groups, 'valorLiquido'), netBank = sumValues(state.parsed.cielo, 'valorLiquido');
  var bankHasNet = state.parsed.cielo.every(function(t){ return Number.isFinite(t.valorLiquido); });
  document.getElementById('cardNetSummary').innerHTML = '<div><span>Líquido previsto · sistema</span><strong>' + fmtBRL(netSystem) + '</strong></div><div><span>Líquido · Cielo</span><strong>' + (bankHasNet ? fmtBRL(netBank) : 'Não disponível') + '</strong></div><div><span>Diferença · Cielo − sistema</span><strong>' + (bankHasNet ? fmtBRL((cents(netBank) - cents(netSystem)) / 100) : '—') + '</strong></div><div><span>Taxas · Cielo</span><strong>' + (bankHasNet ? fmtBRL((cents(sumValues(state.parsed.cielo)) - cents(netBank)) / 100) : '—') + '</strong></div>';
  renderCardRows();
}

function renderCardRows(){
  if(!state.cardAudit) return;
  var query = normalizeText(document.getElementById('cardSearch').value);
  var rows = state.cardAudit.rows.filter(function(r){
    var filterOK = state.cardFilter === 'all' || (state.cardFilter === 'pending' ? r.issues.length > 0 : !!r[state.cardFilter]);
    return filterOK && (!query || normalizeText(JSON.stringify([r.sale, r.launch && Object.assign({}, r.launch, { linhas: undefined }), r.bank, r.issues])).includes(query));
  });
  document.querySelectorAll('[data-card-filter]').forEach(function(button){ var active = button.dataset.cardFilter === state.cardFilter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  function cardCell(tx, row){
    if(!tx) return '<span class="muted">Não identificado</span>';
    return brandLabel(tx.bandeira, row.brand) + paymentLabel(tx, row) + '<small>' + (tx.hora ? 'Hora Cielo ' + escapeHtml(tx.hora) : 'NSU ' + escapeHtml(tx.nsu || 'não informado')) + '</small>';
  }
  document.getElementById('cardAuditBody').innerHTML = rows.map(function(r){
    var tx = r.sale || r.launch || r.bank;
    return '<tr class="' + (r.issues.length ? 'audit-pending' : '') + '"><td><strong>' + (tx.data ? formatDateBR(tx.data) : '—') + (r.sale && r.sale.hora ? ' · ' + escapeHtml(r.sale.hora) : '') + '</strong><small>Registro ' + escapeHtml((r.sale || r.launch || {}).registro || '—') + '</small></td><td class="num">' + fmtBRL(tx.valor) + (r.bank && cents(r.bank.valor) !== cents(tx.valor) ? '<small>Cielo ' + fmtBRL(r.bank.valor) + '</small>' : '') + '</td><td>' + cardCell(r.launch, r) + '</td><td>' + cardCell(r.bank, r) + '</td><td>' + (r.issues.length ? r.issues.map(function(issue){ return '<span class="audit-issue">' + escapeHtml(issue) + '</span>'; }).join('') : '<span class="audit-success">✓ Conferido</span>') + '<details class="audit-evidence"><summary>Ver origem</summary><p>Relação: ' + escapeHtml(r.sale && r.sale.raw || 'Não encontrada') + '</p><p>Lançamentos: ' + escapeHtml(r.launch ? r.launch.linhas.map(function(l){ return l.raw; }).join(' / ') : 'Sem vínculo único') + '</p><p>Cielo: ' + escapeHtml(r.bank && r.bank.raw || 'Sem vínculo seguro') + '</p><p>Vínculo Cielo: ' + (r.confidence === 'horario' ? 'Data e horário próximo (até 2 minutos); confira os valores acima.' : 'Revisão necessária.') + '</p></details></td></tr>';
  }).join('');
  document.getElementById('cardVisibleCount').textContent = rows.length + ' de ' + state.cardAudit.rows.length + ' vendas';
  document.getElementById('cardEmpty').hidden = rows.length > 0;
}
document.querySelectorAll('[data-card-filter]').forEach(function(button){ button.addEventListener('click', function(){ state.cardFilter = button.dataset.cardFilter; renderCardRows(); }); });
document.getElementById('cardSearch').addEventListener('input', renderCardRows);

document.getElementById('btnExportDetails').addEventListener('click', function(){
  if(!state.cardAudit) return;
  var rows = state.cardAudit.rows.map(function(r){ var tx = r.sale || r.launch || r.bank; return {
    'Data': tx.data ? formatDateBR(tx.data) : '', 'Registro': (r.sale || r.launch || {}).registro || '',
    'Hora sistema': r.sale && r.sale.hora || '', 'Hora Cielo': r.bank && r.bank.hora || '', 'NSU interno': r.launch && r.launch.nsu || '',
    'Valor Relação': r.sale ? r.sale.valor : '', 'Valor Lançamentos': r.launch ? r.launch.valor : '', 'Valor Cielo': r.bank ? r.bank.valor : '',
    'Bandeira sistema': r.launch && r.launch.bandeira || '', 'Bandeira Cielo': r.bank && r.bank.bandeira || '',
    'Modalidade sistema': r.launch ? MODAL_LABEL[r.launch.modalidade] : '', 'Modalidade Cielo': r.bank ? MODAL_LABEL[r.bank.modalidade] : '',
    'Parcelas sistema': r.launch && r.launch.parcelas || '', 'Parcelas Cielo': r.bank && r.bank.parcelas || '',
    'Líquido previsto sistema': r.launch ? r.launch.valorLiquido : '', 'Líquido Cielo': r.bank ? r.bank.valorLiquido : '',
    'Conferência': r.issues.join('; ') || 'Conferido', 'Vínculo': r.confidence === 'horario' ? 'Data e horário próximo' : 'Revisar',
    'Origem Relação': r.sale && r.sale.raw || '', 'Origem Lançamentos': r.launch ? r.launch.linhas.map(function(l){ return l.raw; }).join(' / ') : '', 'Origem Cielo': r.bank && r.bank.raw || ''
  }; });
  var wb = XLSX.utils.book_new();
  var ws = XLSX.utils.json_to_sheet(rows); ws['!cols'] = Object.keys(rows[0] || {}).map(function(){ return { wch: 24 }; });
  XLSX.utils.book_append_sheet(wb, ws, 'Conferência de cartões');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cardGroups().map(function(g){ return { 'Categoria': g.categoria, 'Vendas sistema': g.qtdSistema, 'Total sistema': g.sistema / 100, 'Vendas Cielo': g.qtdCielo, 'Total Cielo': g.cielo / 100, 'Diferença': (g.sistema - g.cielo) / 100 }; })), 'Totais por categoria');
  XLSX.writeFile(wb, 'conferencia_cartoes_' + new Date().toISOString().slice(0,10) + '.xlsx');
});

function badgeFor(tipo){
  if(tipo === 'ausente_banco') return '<span class="badge b-red"><span class="badge-dot"></span>Ausente no banco</span>';
  if(tipo === 'valor_divergente') return '<span class="badge b-amber"><span class="badge-dot"></span>Valor divergente</span>';
  if(tipo === 'sobra_banco') return '<span class="badge b-blue"><span class="badge-dot"></span>Sobra no banco</span>';
  if(tipo === 'nao_identificado') return '<span class="badge b-gray"><span class="badge-dot"></span>Não identificado</span>';
  return tipo;
}

/* =========================================================================
   EXPORTAÇÃO
   ========================================================================= */
document.getElementById('btnExport').addEventListener('click', function(){
  if(state.divergences.length === 0){ showToast('Não há divergências para exportar.', true); return; }
  var rows = state.divergences.map(function(d){
    return {
      'Tipo': d.tipo === 'ausente_banco' ? 'Ausente no banco/adquirente' : d.tipo === 'valor_divergente' ? 'Valor divergente' : 'Sobra no banco/adquirente',
      'Modalidade': MODAL_LABEL[d.modalidade] || d.modalidade,
      'Data': d.data ? formatDateBR(d.data) : '',
      'Hora': d.hora || '',
      'Documento': d.documento || '',
      'Valor Caixa (R$)': d.valorCaixa !== null && d.valorCaixa !== undefined ? Number(d.valorCaixa.toFixed(2)) : '',
      'Valor Banco (R$)': d.valorBanco !== null && d.valorBanco !== undefined ? Number(d.valorBanco.toFixed(2)) : '',
      'Origem Banco': d.origemBanco || ''
    };
  });
  var ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{wch:26},{wch:12},{wch:12},{wch:8},{wch:14},{wch:16},{wch:16},{wch:14}];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Divergências');

  var summaryRows = state.summary.map(function(s){
    return {
      'Modalidade': s.modalidade,
      'Total Caixa (R$)': Number(s.caixa.toFixed(2)),
      'Total Banco/Adquirente (R$)': Number(s.banco.toFixed(2)),
      'Diferença (R$)': Number((s.caixa - s.banco).toFixed(2)),
      'Transações batidas': s.batidos + '/' + s.totalCaixaCount
    };
  });
  var ws2 = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, ws2, 'Resumo');

  var dataStr = new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb, 'divergencias_conciliacao_' + dataStr + '.xlsx');
  showToast('Relatório exportado com sucesso.');
});

document.getElementById('btnExportCompare').addEventListener('click', function(){
  if(!state.alignedRows || state.alignedRows.length === 0){ showToast('Não há lançamentos para exportar.', true); return; }
  var countA2 = 0, countB2 = 0;
  var rows = state.alignedRows.map(function(row){
    var left = row.left, right = row.right;
    return {
      'Lado A (#)': left ? ++countA2 : '—',
      'Caixa - Data': left && left.data ? formatDateBR(left.data) : '—',
      'Caixa - Hora': left && left.hora ? left.hora : '—',
      'Caixa - Documento': left && left.documento ? left.documento : '—',
      'Caixa - Valor (R$)': left && left.valor !== null ? Number(left.valor.toFixed(2)) : '',
      'Caixa - Linha Lida': left && left.raw ? left.raw : '—',
      'Lado B (#)': right ? ++countB2 : '—',
      'Banco - Data': right && right.data ? formatDateBR(right.data) : '—',
      'Banco - Hora': right && right.hora ? right.hora : '—',
      'Banco - Documento': right && right.documento ? right.documento : '—',
      'Banco - Valor (R$)': right && right.valor !== null ? Number(right.valor.toFixed(2)) : '',
      'Banco - Linha Lida': right && right.raw ? right.raw : '—',
      'Status': (!left || !right || cents(left.valor) !== cents(right.valor)) ? 'Divergente' : 'Valor batido'
    };
  });
  var ws = XLSX.utils.json_to_sheet(rows);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Comparativo');
  var dataStr = new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb, 'comparativo_linha_a_linha_' + dataStr + '.xlsx');
  showToast('Comparativo exportado com sucesso.');
});

/* =========================================================================
   RESET
   ========================================================================= */
document.getElementById('btnReset').addEventListener('click', function(){
  clearSlot('caixa');
  clearSlot('sicredi');
  clearSlot('cielo');
  clearSlot('lancamentos');
  state.parsed = { caixa: [], sicredi: [], cielo: [], lancamentos: [] };
  state.cardAudit = null;
  state.pairs = null;
  state.divergences = [];
  state.summary = [];
  state.alignedRows = [];
  state.consolidated = [];
  state.storeSummary = [];
  state.processedOnce = false;
  document.getElementById('resultsWrap').classList.remove('show');
  document.getElementById('btnExport').disabled = true;
  document.getElementById('btnExportCompare').style.display = 'none';
  updateProcessButtonState();
  showToast('Conciliação reiniciada.');
});

updateProcessButtonState();

/* =========================================================================
   DIVERGENCE SCROLL NAVIGATION
   ========================================================================= */
window._concDivIdx = -1;
function scrollToDivergence(direction){
  var container = document.getElementById('sourceCompareScroll');
  var divs = container.querySelectorAll('tr.has-divergence');
  if(divs.length === 0) return;
  if(direction === 'next'){
    window._concDivIdx++;
    if(window._concDivIdx >= divs.length) window._concDivIdx = 0;
  } else {
    window._concDivIdx--;
    if(window._concDivIdx < 0) window._concDivIdx = divs.length - 1;
  }
  var target = divs[window._concDivIdx];
  var headerOffset = 82;
  var targetTop = target.offsetTop - headerOffset - 4;
  container.scrollTo({ top: targetTop, behavior: 'smooth' });
  divs.forEach(function(el){ el.style.backgroundColor = ''; });
  target.style.backgroundColor = 'rgba(255, 170, 0, 0.15)';
  setTimeout(function(){ target.style.backgroundColor = ''; }, 1500);
}

document.getElementById('btnNextDivergence').addEventListener('click', function(){ scrollToDivergence('next'); });
document.getElementById('btnPrevDivergence').addEventListener('click', function(){ scrollToDivergence('prev'); });

}; // end of window.__tool_init_conciliacao
