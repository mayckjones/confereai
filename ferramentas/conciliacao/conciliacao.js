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
  cardAudit: null,
  cardFilter: 'pending',
  pairs: null,
  divergences: [],
  summary: [],
  alignedRows: [],
  processedOnce: false,
  multi: null,      // resultado por loja (Cielo); null no extrato PIX
  storeKey: null,   // 'todas' ou o código da loja exibida
  pix: null,        // resultado da conciliação PIX (Relação CARTEIRA DIGITAL × extratos Sicredi)
  pixFiltro: 'pending',
  pixLoja: 'todas', // 'todas' ou o código da loja exibida no PIX
  pixAba: 'overview'
};

// Cadastro de Cartões Magnéticos fornecido pelo sistema (código -> descrição).
// A coluna Parc. no relatório é a quantidade efetiva de parcelas; o sufixo
// 1X / 2X - 3X do cadastro indica apenas a faixa permitida para o cartão.
var CARD_CATALOG = {
  '1': 'TEF MASTER 1X', '2': 'TEF VISA 1X', '3': 'TEF HIPERC 1X', '4': 'TEF AMEX 1X', '5': 'TEF ELO 1X',
  '6': 'TEF VISA DEBITO', '7': 'TEF MASTER DEBITO', '8': 'POS AMEX 1X', '9': 'TEF CABAL 1X', '10': 'TEF ELO DEBITO',
  '11': 'TEF AMEX 2X - 3X', '12': 'TEF CABAL 2X - 3X', '13': 'TEF VISA 2X - 3X', '14': 'TEF ELO 2X - 3X',
  '15': 'TEF HIPERC 2X - 3X', '16': 'TEF MASTER 2X - 3X', '17': 'POS AMEX 2X - 3X', '18': 'POS CABAL 1X',
  '19': 'POS CABAL 2X - 3X', '20': 'POS ELO 1X', '21': 'POS ELO 2X - 3X', '22': 'POS HIPERC 2X - 3X',
  '23': 'POS HIPERC 1X', '24': 'POS MASTER 2X - 3X', '25': 'POS MASTER 1X', '26': 'POS VISA 1X',
  '27': 'POS VISA 2X - 3X', '28': 'POS ELO DEBITO', '29': 'POS MASTER DEBITO', '30': 'POS VISA DEBITO'
};

var MODAL_LABEL = { PIX: 'PIX', Debito: 'Débito', Credito: 'Crédito', Dinheiro: 'Dinheiro', Cartao: 'Cartão (não especificado)', Outro: 'Não identificado' };

// Lojas pelo código impresso no sistema (Relação e Lançamentos). A Cielo de
// cada loja é reconhecida pelo estabelecimento que aparece em cada venda.
var STORES = {
  '1': { nome: 'Loja 1', estabelecimento: '1029024402' },
  '2': { nome: 'Loja 2', semCielo: 'Sem acesso à Cielo desta loja' },
  '3': { nome: 'Loja 3', estabelecimento: '1040788502' },
  '7': { nome: 'Loja 4', estabelecimento: '3002105343' },
  '6': { nome: 'Loja 5', estabelecimento: '2800327299' }
};
// Venda na POS de qualquer loja (menos a 2) cai na Cielo da Loja 5. O entregador
// passa o cartão no cliente e o caixa finaliza depois: a Cielo vem antes do caixa.
var POS_STORE = '6';
var POS_SOURCE_STORES = ['1', '3', '7', '6'];
var DELIVERY_MAX_MINUTES = 180;

function storeName(loja){ return STORES[loja] ? STORES[loja].nome : 'Loja ' + loja; }
function storeCodeNote(loja){ return storeName(loja) === 'Loja ' + loja ? '' : 'código ' + loja + ' no sistema'; }
function storeByEstablishment(estabelecimento){ return Object.keys(STORES).find(function(k){ return STORES[k].estabelecimento && STORES[k].estabelecimento === String(estabelecimento || ''); }) || ''; }
function storeOrder(a, b){ return storeName(a).localeCompare(storeName(b), 'pt-BR', { numeric: true }); }
function storeList(lojas){ return lojas.slice().sort(storeOrder).map(storeName).join(', ').replace(/, ([^,]*)$/, ' e $1'); }
function minutesOf(hora){ var p = String(hora || '').split(':').map(Number); return p[0] * 60 + p[1]; }

function normalizeText(value){ return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim(); }
function escapeHtml(value){ return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function cents(value){ return Math.round(value * 100); }
function sumValues(list, key){ return list.reduce(function(sum, tx){ return sum + (Number.isFinite(tx[key || 'valor']) ? cents(tx[key || 'valor']) : 0); }, 0) / 100; }
function detectBrand(value){
  var text = normalizeText(value);
  if(/AMERICAN EXPRESS|AMEX/.test(text)) return 'American Express';
  if(/\bMASTER(?:\s?CARD)?\b/.test(text)) return 'Mastercard';
  if(/VISA/.test(text)) return 'Visa';
  if(/\bELO\b/.test(text)) return 'Elo';
  if(/\bHIPERC(?:ARD)?\b/.test(text)) return 'Hipercard';
  if(/\bCABAL\b/.test(text)) return 'Cabal';
  if(/DINERS/.test(text)) return 'Diners';
  return null;
}

function brandLabel(brand, warning){
  var marks = {
    Mastercard: '<circle cx="11" cy="12" r="8" fill="#eb001b"/><circle cx="21" cy="12" r="8" fill="#f79e1b" fill-opacity=".9"/>',
    Visa: '<text x="16" y="17" text-anchor="middle" font-family="Arial,sans-serif" font-weight="900" font-style="italic" font-size="13" fill="#17357c">VISA</text>',
    Elo: '<text x="16" y="17" text-anchor="middle" font-family="Arial,sans-serif" font-weight="800" font-size="17" fill="#222">elo</text><path d="M3 4h7" stroke="#ffcb05" stroke-width="2"/><path d="M13 4h7" stroke="#00a4df" stroke-width="2"/><path d="M23 4h6" stroke="#ef4123" stroke-width="2"/>',
    'American Express': '<rect width="32" height="24" rx="3" fill="#1675bb"/><text x="16" y="15" text-anchor="middle" font-family="Arial,sans-serif" font-weight="800" font-size="9" fill="white">AMEX</text>',
    Hipercard: '<path class="hipercard-shape" d="M8 1H32L28 19Q27 23 23 23H0L4 6Q5 1 8 1Z" fill="#b30d1b"/><text x="4" y="14" font-family="Arial,sans-serif" font-style="italic" font-weight="700" font-size="7" textLength="24" lengthAdjust="spacingAndGlyphs" fill="#111">Hipercard</text>'
  };
  var mark = marks[brand] || '<rect x="3" y="5" width="26" height="16" rx="3" fill="none" stroke="#718098" stroke-width="2"/><path d="M4 10h24" stroke="#718098" stroke-width="2"/>';
  return '<span class="brand-label' + (warning ? ' field-warning' : '') + '"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 24">' + mark + '</svg></span>' + escapeHtml(brand || 'Não identificada') + '</span>';
}

function paymentLabel(tx, row){
  var mode = tx.modalidade, debit = mode === 'Debito', credit = mode === 'Credito';
  var icon = debit ? '<path d="M3 7h15v12H3zM6 3h15v12M6 12h9M12 9l3 3-3 3"/>' : '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 9h20M6 15h4"/>';
  var channel = tx.canal ? '<span class="card-channel ' + (tx.canal === 'POS' ? 'pos' : 'tef') + '">' + escapeHtml(tx.canal) + '</span>' : '';
  var payment = '<span class="payment-label ' + (debit ? 'debit' : credit ? 'credit' : 'unknown') + (row.mode ? ' field-warning' : '') + '"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + icon + '</svg>' + escapeHtml(MODAL_LABEL[mode] || 'Não identificado') + '</span>';
  var installmentWarning = row.installments || (tx.faixaParcelas && !tx.faixaParcelas.includes(tx.parcelas));
  var installment = '<span class="installment-label ' + (tx.parcelas === 1 ? 'one' : tx.parcelas === 2 ? 'two' : tx.parcelas === 3 ? 'three' : 'other') + (installmentWarning ? ' field-warning' : '') + '">' + (tx.parcelas ? tx.parcelas + 'x' : '—') + '</span>';
  return '<span class="card-payment-row">' + channel + payment + installment + '</span>';
}

function responsibilityMeta(tx){
  if(!tx || (!tx.caixaTurno && !tx.codigoVendedor)) return '';
  return '<small class="responsibility-meta">Cx/Tu ' + escapeHtml(tx.caixaTurno || '—') + ' · Vend. ' + escapeHtml(tx.codigoVendedor || '—') + '</small>';
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
    var description = match[2], code = (description.match(/^(\d+)\s*-/) || [])[1] || '';
    var normalized = normalizeText(description).replace(/^\d+\s*-\s*/, '').replace(/\s*-\s*/g, ' - ');
    var canal = (normalized.match(/^(POS|TEF)\b/) || [])[1] || '';
    var modalidade = detectModalidadeFromText(description);
    if(/^(MASTERCARD|VISA)$/.test(normalized)) modalidade = 'Credito';
    var faixaParcelas = /\b2X\s*-\s*3X\b/.test(normalized) ? [2, 3] : /\b1X\b/.test(normalized) ? [1] : null;
    out.push({ origem: 'Lançamentos', data: date, loja: loja, registro: match[3], documento: match[3], parcelas: Number(match[4]), valor: parseValorBR(match[5]), taxa: parseValorBR(match[6]), valorLiquido: parseValorBR(match[7]), nsu: match[8] || '', bandeira: detectBrand(description), modalidade: modalidade, canal: canal, codigoCartao: code, faixaParcelas: faixaParcelas, cadastroValido: !canal || CARD_CATALOG[code] === normalized, descricao: description, raw: line });
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
    if(!groups.has(key)) groups.set(key, Object.assign({}, line, { linhas: [], valor: 0, valorLiquido: 0 }));
    var group = groups.get(key);
    group.linhas.push(line);
    group.valor = (cents(group.valor) + cents(line.valor)) / 100;
    group.valorLiquido = (cents(group.valorLiquido) + cents(line.valorLiquido)) / 100;
  });
  return Array.from(groups.values());
}

/* =========================================================================
   UTILITIES (tool-specific)
   ========================================================================= */
function timeDiffMinutes(t1, t2){
  var p1 = t1.split(':').map(Number), p2 = t2.split(':').map(Number);
  return Math.abs((p1[0]*60+p1[1]) - (p2[0]*60+p2[1]));
}

function detectModalidadeFromText(text){
  var t = normalizeText(text);
  if(/CARTEIRA\s*DIGITAL|CART\.?\s*DIG\b/.test(t)) return 'PIX';
  if(/PIX/.test(t)) return 'PIX';
  if(/D[ÉE]B|DEBITO|CARTAO\s*D[ÉE]B/.test(t)) return 'Debito';
  if(/CR[ÉE]D|CREDITO|CARTAO\s*CR[ÉE]D/.test(t)) return 'Credito';
  if(/\b(?:POS|TEF)\b.*\b(?:1X|2X\s*-\s*3X)\b/.test(t)) return 'Credito';
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
// A identificação do arquivo já lê o PDF; o processamento reaproveita as linhas.
var pdfLinesCache = new WeakMap();
async function extractPdfLines(file){
  if(file && typeof file === 'object' && pdfLinesCache.has(file)) return pdfLinesCache.get(file);
  var lines = await readPdfLines(file);
  if(file && typeof file === 'object') pdfLinesCache.set(file, lines);
  return lines;
}

async function readPdfLines(file){
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

function parseCaixaLines(lines){
  var out = [];
  var dateRe = /(\d{2}\/\d{2}\/\d{4})/;
  var timeRe = /(\d{2}:\d{2})(?::\d{2})?/;
  var valorRe = /(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  var hasValorRe = /(\d{1,3}(?:\.\d{3})*,\d{2})/;
  var docRe = /\b(\d{4,12})\b/;

  var lastData = null;
  var lastHora = null;
  var lastDoc = '';
  var lastCaixa = '';
  var lastTurno = '';
  var lastVendedor = '';
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

    var data, hora, documento, caixa, turno, codigoVendedor;
    var timeM = line.match(timeRe);
    var responsibilityM = line.match(/\b(\d+)\s*\/\s*(\d+)\s+(\d+)\s+\d+(?:[.,]\d+)?%/);

    if(isExtra){
      if(!lastData) return false;
      data = lastData;
      hora = lastHora;
      documento = lastDoc;
      caixa = lastCaixa;
      turno = lastTurno;
      codigoVendedor = lastVendedor;
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
      caixa = responsibilityM ? responsibilityM[1] : '';
      turno = responsibilityM ? responsibilityM[2] : '';
      codigoVendedor = responsibilityM ? responsibilityM[3] : '';

      lastData = data;
      lastHora = hora;
      lastDoc = documento;
      lastCaixa = caixa;
      lastTurno = turno;
      lastVendedor = codigoVendedor;
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
      caixa: caixa,
      turno: turno,
      caixaTurno: caixa && turno ? caixa + '/' + turno : '',
      codigoVendedor: codigoVendedor,
      valor: valor,
      // Linha "Cartao Mag" sem registro: segundo cartão da mesma venda.
      pagamentoAdicional: isExtra,
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
    return parseCieloPdfLines(await extractPdfLines(file));
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
  // "Estabelecimento" exato: a coluna "CPF/CNPJ do estabelecimento" não serve.
  var colEstab = header.findIndex(function(cell){ return /^(CODIGO DO |NUMERO DO )?ESTABELECIMENTO$/.test(normalizeText(cell)); });

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
    out.push({
      origem: 'Cielo', data: data,
      hora: colHora !== -1 ? parseTimeAny(row[colHora]) : null,
      modalidade: modalidade, documento: '', valor: valorBruto,
      bandeira: colBrand !== -1 ? detectBrand(row[colBrand]) : null,
      parcelas: colParts !== -1 && Number(row[colParts]) > 0 ? Number(row[colParts]) : (/PARCELADO/.test(normalizeText(row[colForma])) ? null : 1),
      nsu: colNsu !== -1 ? String(row[colNsu] || '') : '',
      valorLiquido: colLiq !== -1 ? parseValorBR(row[colLiq]) : null,
      estabelecimento: colEstab !== -1 ? String(row[colEstab] || '').replace(/\D/g, '') : '',
      raw: String(row[colForma] || '')
    });
  }
  return out;
}

// "Não aprovada" também contém a palavra APROVADA; ela não pode entrar como venda.
function isCieloApprovedLine(line){
  var t = normalizeText(line);
  return /\bAPROVADA\b/.test(t) && !/\bNAO APROVADA\b/.test(t);
}

function parseCieloPdfLines(lines){
  var out = [];
  var dateRe = /(\d{2}\/\d{2}\/\d{4})/;
  var timeRe = /(\d{1,2}:\d{2})/;
  var moneyRe = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/g;

  lines.forEach(function(line){
    var dateM = line.match(dateRe);
    if(!dateM || !isCieloApprovedLine(line)) return;
    var amounts = [];
    var m;
    var re = new RegExp(moneyRe.source, 'g');
    while((m = re.exec(line)) !== null) amounts.push(m);
    if(!amounts.length) return;
    var valor = parseValorBR(amounts[0][1]);
    if(!Number.isFinite(valor) || valor <= 0) return;
    var timeMatch = line.match(timeRe);
    out.push({
      origem: 'Cielo',
      data: parseDateAny(dateM[1]),
      hora: timeMatch ? parseTimeAny(timeMatch[1]) : null,
      modalidade: detectModalidadeFromText(line), documento: '', valor: valor, raw: line,
      bandeira: detectBrand(line),
      parcelas: /parcelado/i.test(line) ? (line.match(/(\d+)\s*x\b/i) ? Number(line.match(/(\d+)\s*x\b/i)[1]) : null) : 1,
      valorLiquido: amounts.length >= 3 ? parseValorBR(amounts[2][1]) : null,
      taxaValor: amounts.length >= 3 ? parseValorBR(amounts[1][1]) : null,
      estabelecimento: (line.match(/\d{2}:\d{2}\s+(\d+)/) || [])[1] || '',
      cnpj: (line.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/) || [])[0] || ''
    });
  });
  var totalizer = lines.map(function(line){ return line.match(/^(\d+)\s+R\$\s*([\d.]+,\d{2})\s+-?R\$/); }).find(Boolean);
  // O totalizador só serve de controle quando todas as linhas são aprovadas.
  var hasOtherStatus = lines.some(function(line){ return /\d{2}\/\d{2}\/\d{4}/.test(line) && /R\$/.test(line) && !isCieloApprovedLine(line); });
  if(totalizer && !hasOtherStatus && (Number(totalizer[1]) !== out.length || cents(parseValorBR(totalizer[2])) !== cents(sumValues(out)))) throw new Error('A leitura da Cielo não fechou com o totalizador. Confira o layout do PDF.');
  return out;
}

/* =========================================================================
   MOTOR DE CONCILIAÇÃO
   ========================================================================= */
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

// options.allowed(venda, cielo): em qual Cielo a venda pode estar (padrão: qualquer).
// options.isPos(venda) e options.launchOf(venda) vêm dos Lançamentos.
function matchCardTransactions(caixaList, bankList, options){
  options = options || {};
  var allowed = options.allowed || function(){ return true; };
  var isPos = options.isPos || function(){ return false; };
  var launchOf = options.launchOf || function(){ return null; };
  var left = caixaList.slice(), right = bankList.slice(), matched = [], divergValor = [];
  function samePool(c, b){ return !c.loja || !b.loja || c.loja === b.loja; }
  // POS: a Cielo registra quando o entregador passa o cartão; o caixa, depois.
  function delivery(c, b){
    if(!isPos(c) || !c.hora || !b.hora) return false;
    var gap = minutesOf(c.hora) - minutesOf(b.hora);
    return gap >= 0 && gap <= DELIVERY_MAX_MINUTES;
  }
  function pairPass(requireValue){
    var changed = true;
    while(changed){
      changed = false;
      function candidates(c){
        return right.map(function(b){
          if(!allowed(c, b) || c.data !== b.data || (requireValue && cents(c.valor) !== cents(b.valor))) return null;
          var distance = c.hora && b.hora ? timeDiffMinutes(c.hora, b.hora) : Infinity;
          if(!requireValue && (distance > 2 || !samePool(c, b))) return null;
          return { caixa: c, banco: b, distance: distance };
        }).filter(Boolean).sort(function(a,b){ return a.distance - b.distance; });
      }
      for(var i = 0; i < left.length; i++){
        var choices = candidates(left[i]);
        if(!choices.length || (choices.length > 1 && choices[0].distance === choices[1].distance)) continue;
        var choice = choices[0];
        var competitors = left.filter(function(c){
          return c !== choice.caixa && allowed(c, choice.banco) && c.data === choice.banco.data && (!requireValue || cents(c.valor) === cents(choice.banco.valor)) && ((!c.hora || !choice.banco.hora) ? Infinity : timeDiffMinutes(c.hora, choice.banco.hora)) <= choice.distance;
        });
        if(competitors.length) continue;
        // Horários distantes não confirmam identidade, mesmo com valor único,
        // exceto na POS, em que a Cielo vem antes do caixa (tempo da entrega).
        choice.confidence = choice.distance <= 2 ? 'horario' : delivery(choice.caixa, choice.banco) ? 'entrega' : 'valor';
        (requireValue ? matched : divergValor).push(choice);
        left.splice(i, 1); right.splice(right.indexOf(choice.banco), 1);
        changed = true; break;
      }
    }
  }
  // POS digitada com outro valor: mesma bandeira e débito/crédito, Cielo antes do
  // caixa no tempo da entrega, candidata única e diferença de no máximo 30%.
  function posValuePass(){
    function fits(c, b){
      var launch = launchOf(c);
      if(!launch || !launch.bandeira || !/^(Debito|Credito)$/.test(launch.modalidade)) return false;
      var diff = Math.abs(cents(c.valor) - cents(b.valor));
      return allowed(c, b) && c.data === b.data && delivery(c, b) && b.bandeira === launch.bandeira && b.modalidade === launch.modalidade && diff <= 0.3 * Math.max(cents(c.valor), cents(b.valor));
    }
    var changed = true;
    while(changed){
      changed = false;
      for(var i = 0; i < left.length; i++){
        var c = left[i];
        if(!isPos(c)) continue;
        var options = right.filter(function(b){ return fits(c, b); });
        if(options.length !== 1) continue;
        var b = options[0];
        if(left.some(function(o){ return o !== c && isPos(o) && fits(o, b); })) continue;
        divergValor.push({ caixa: c, banco: b, distance: timeDiffMinutes(c.hora, b.hora), confidence: 'entrega' });
        left.splice(i, 1); right.splice(right.indexOf(b), 1);
        changed = true; break;
      }
    }
  }
  pairPass(true);
  pairPass(false);
  posValuePass();
  return { matched: matched, divergValor: divergValor, ausentes: left, sobras: right };
}

function buildDivergence(tipo, item, modalidadeLabel){
  if(tipo === 'valor_divergente'){
    return {
      tipo: tipo, modalidade: modalidadeLabel,
      data: item.caixa.data, hora: item.caixa.hora || item.banco.hora || '—',
      documento: item.caixa.documento || '—',
      caixaTurno: item.caixa.caixaTurno || '', codigoVendedor: item.caixa.codigoVendedor || '',
      valorCaixa: item.caixa.valor, valorBanco: item.banco.valor,
      origemBanco: item.banco.origem
    };
  }
  if(tipo === 'ausente_banco' || tipo === 'pos_sem_cielo'){
    return {
      tipo: tipo, modalidade: modalidadeLabel,
      data: item.data, hora: item.hora || '—',
      documento: item.documento || '—',
      caixaTurno: item.caixaTurno || '', codigoVendedor: item.codigoVendedor || '',
      valorCaixa: item.valor, valorBanco: null, origemBanco: '—'
    };
  }
  return {
    tipo: tipo, modalidade: modalidadeLabel,
    data: item.data, hora: item.hora || '—',
    documento: item.documento || '—',
    caixaTurno: '', codigoVendedor: '',
    valorCaixa: null, valorBanco: item.valor, origemBanco: item.origem
  };
}

function reconcile(caixaTx, sicrediTx, cieloTx){
  var bancoTx = cieloTx.length ? cieloTx : sicrediTx;
  var origem = cieloTx.length ? 'Cielo' : 'Extrato PIX';
  var resultado = cieloTx.length ? matchCardTransactions(caixaTx, bancoTx) : matchModalidade(caixaTx, bancoTx);
  var divergences = [];

  function pushDiverg(tipo, item, modalidadeLabel){ divergences.push(buildDivergence(tipo, item, modalidadeLabel)); }

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

/* -------------------------------------------------------------------------
   COBERTURA DOS LANÇAMENTOS
   Os Lançamentos não têm hora: a venda só chega à Cielo pela Relação, ligada
   pelo registro. Se nenhum registro é comum, o arquivo é de outro dia ou de
   outra loja, e comparar bandeira, débito/crédito e parcelas seria inventar.
   ------------------------------------------------------------------------- */
function swapDayMonth(iso){
  var p = String(iso || '').split('-');
  return p.length === 3 ? p[0] + '-' + p[2] + '-' + p[1] : '';
}

function uniqueSorted(list){
  return Array.from(new Set(list.filter(Boolean))).sort();
}

function describeSource(list){
  var registros = list.map(function(t){ return Number(t.registro); }).filter(function(n){ return Number.isFinite(n) && n > 0; });
  var bandeiras = {};
  list.forEach(function(t){ if(t.bandeira) bandeiras[t.bandeira] = (bandeiras[t.bandeira] || 0) + 1; });
  return {
    bandeiras: bandeiras,
    datas: uniqueSorted(list.map(function(t){ return t.data; })),
    lojas: uniqueSorted(list.map(function(t){ return t.loja; })),
    estabelecimentos: uniqueSorted(list.map(function(t){ return t.estabelecimento; })),
    registroMin: registros.length ? registros.reduce(function(a, b){ return Math.min(a, b); }) : null,
    registroMax: registros.length ? registros.reduce(function(a, b){ return Math.max(a, b); }) : null,
    vendas: list.length,
    total: sumValues(list)
  };
}

function assessLaunchCoverage(caixa, groups, cielo){
  function key(tx, withDate){ return [tx.loja, withDate ? tx.data : '', tx.registro].join('|'); }
  var saleKeys = new Set(caixa.map(function(s){ return key(s, true); }));
  var saleRegs = new Set(caixa.map(function(s){ return key(s, false); }));
  var relacao = describeSource(caixa), lancamentos = describeSource(groups);
  var foraDoPeriodo = lancamentos.datas.filter(function(d){ return !relacao.datas.includes(d); });
  var linked = groups.filter(function(g){ return saleKeys.has(key(g, true)); }).length;
  return {
    compatible: linked > 0,
    linked: linked,
    linkedByRegistro: groups.filter(function(g){ return saleRegs.has(key(g, false)); }).length,
    relacao: relacao,
    lancamentos: lancamentos,
    cielo: describeSource(cielo || []),
    foraDoPeriodo: foraDoPeriodo,
    sameStore: !lancamentos.lojas.length || !relacao.lojas.length || lancamentos.lojas.some(function(l){ return relacao.lojas.includes(l); }),
    // 11/04 × 04/11: o período do relatório foi lido como mês/dia no ERP.
    swappedDate: lancamentos.datas.length > 0 && foraDoPeriodo.length === lancamentos.datas.length && lancamentos.datas.every(function(d){ return relacao.datas.includes(swapDayMonth(d)); })
  };
}

function formatDateList(datas){
  if(!datas.length) return 'sem data';
  if(datas.length <= 3) return datas.map(formatDateBR).join(', ');
  return formatDateBR(datas[0]) + ' a ' + formatDateBR(datas[datas.length - 1]) + ' (' + datas.length + ' dias)';
}

function formatMonthDay(iso){
  var p = iso.split('-');
  return p[1] + '/' + p[2] + '/' + p[0];
}

// "1, 3, 4 (código 7 no sistema)": número da loja como o usuário conhece.
function storeNumbers(lojas){
  return lojas.slice().sort(storeOrder).map(function(l){ var note = storeCodeNote(l); return storeName(l).replace(/^Loja /, '') + (note ? ' (' + note + ')' : ''); }).join(', ');
}

function launchCoverageMessage(coverage){
  var rel = coverage.relacao, lan = coverage.lancamentos, cie = coverage.cielo;
  var periodo = formatDateList(rel.datas), relLojas = storeNumbers(rel.lojas);
  var report = '“Lançamentos de Cartão Magnético por Data”';
  var reason, action;
  if(!coverage.sameStore){
    reason = 'Os Lançamentos são da loja ' + storeNumbers(lan.lojas) + ' e a Relação é da loja ' + relLojas + '.';
    action = 'Emita o relatório ' + report + ' da loja ' + relLojas + ' para ' + periodo + ' e envie no lugar deste arquivo.';
  } else if(coverage.linkedByRegistro > 0){
    reason = 'Os registros coincidem, mas as datas não: Lançamentos em ' + formatDateList(lan.datas) + ' e Relação em ' + periodo + '.';
    action = 'Confira o formato de data impresso nos dois relatórios e emita-os novamente com o mesmo período.';
  } else if(coverage.foraDoPeriodo.length === lan.datas.length){
    reason = 'Os Lançamentos são de ' + formatDateList(lan.datas) + ', mas a Relação' + (cie.vendas ? ' e a Cielo são' : ' é') + ' de ' + periodo + '.';
    action = 'Emita de novo o relatório ' + report + ' para ' + periodo + ' e envie no lugar deste arquivo.';
    if(coverage.swappedDate){
      var first = rel.datas[0], last = rel.datas[rel.datas.length - 1];
      action += ' O dia e o mês ficaram invertidos (' + formatDateList(lan.datas) + ' × ' + periodo + '): o período foi lido como mês/dia. Tente digitar ' + (first === last ? formatMonthDay(first) : formatMonthDay(first) + ' a ' + formatMonthDay(last)) + ' no filtro.';
    }
  } else {
    reason = 'As datas coincidem, mas nenhum registro dos Lançamentos aparece na Relação.';
    action = 'Confira se os dois relatórios foram emitidos com os mesmos filtros de loja, período e forma de pagamento.';
  }
  // Conferência no papel antes do novo envio: mesma data e mesma faixa de registros.
  if(coverage.sameStore && rel.registroMin !== null){
    action += ' Antes de enviar, confira no PDF novo: a data acima das linhas deve ser ' + periodo + ' e os registros devem ficar perto de ' + rel.registroMin + ' a ' + rel.registroMax + ', como na Relação.';
  }
  function brandCount(names, src){
    return names.map(function(b){ var n = src.bandeiras[b]; return b + ' (' + n + (n === 1 ? ' venda' : ' vendas') + ')'; }).join(' e ');
  }
  var soNosLancamentos = Object.keys(lan.bandeiras).filter(function(b){ return !cie.bandeiras[b]; }).sort();
  var soNaCielo = Object.keys(cie.bandeiras).filter(function(b){ return !lan.bandeiras[b]; }).sort();
  var brandEvidence = [];
  if(cie.vendas && soNosLancamentos.length) brandEvidence.push('os Lançamentos têm ' + brandCount(soNosLancamentos, lan) + (soNosLancamentos.length > 1 ? ', que não aparecem' : ', que não aparece') + ' na Cielo');
  if(cie.vendas && soNaCielo.length) brandEvidence.push('a Cielo tem ' + brandCount(soNaCielo, cie) + (soNaCielo.length > 1 ? ', que não aparecem' : ', que não aparece') + ' nos Lançamentos');
  if(brandEvidence.length) reason += ' As bandeiras também não batem: ' + brandEvidence.join('; ') + '.';
  function brandList(src){
    return Object.keys(src.bandeiras).sort().map(function(b){ return b + ' ' + src.bandeiras[b]; }).join(' · ');
  }
  function registros(src){
    if(src.registroMin === null) return '';
    return src.registroMin === src.registroMax ? 'Registro ' + src.registroMin : 'Registros ' + src.registroMin + ' a ' + src.registroMax;
  }
  function where(src){
    var lojas = src.lojas.length ? 'Loja ' + storeNumbers(src.lojas) : src.estabelecimentos.length ? 'Estab. ' + src.estabelecimentos.join(', ') : '';
    return [lojas, registros(src)].filter(Boolean).join(' · ');
  }
  var facts = [
    { label: 'Lançamentos de Cartão', datas: formatDateList(lan.datas), local: where(lan), vendas: lan.vendas + ' vendas', total: fmtBRL(lan.total), bandeiras: brandList(lan), off: true },
    { label: 'Relação de Vendas', datas: periodo, local: where(rel), vendas: rel.vendas + ' vendas', total: fmtBRL(rel.total), bandeiras: '' }
  ];
  if(cie.vendas) facts.push({ label: 'Cielo', datas: formatDateList(cie.datas), local: where(cie), vendas: cie.vendas + ' vendas aprovadas', total: fmtBRL(cie.total), bandeiras: brandList(cie) });
  return {
    title: 'Os Lançamentos enviados não são das mesmas vendas da Relação',
    detail: 'Nenhum dos ' + lan.vendas + ' registros dos Lançamentos aparece entre os ' + rel.vendas + ' da Relação. ' + reason + ' Sem esse vínculo não há hora da venda para localizar o pagamento na Cielo, então bandeira, débito/crédito e parcelas não foram comparados.',
    action: action,
    facts: facts
  };
}

function uniqueLaunchLines(lines){
  var seen = new Set();
  return lines.filter(function(l){ var k = normalizeText(l.raw); if(seen.has(k)) return false; seen.add(k); return true; });
}

// A mesma linha impressa duas vezes (parcela única repetida): o cartão ainda
// pode ser conferido, mas o total dos Lançamentos fica maior que a Relação.
function hasRepeatedLaunchLine(launch){
  var distinct = uniqueLaunchLines(launch.linhas);
  return distinct.length < launch.linhas.length && distinct.length === launch.parcelas && distinct.every(function(l){ return l.parcelas === launch.parcelas; });
}

// Liga cada venda da Relação aos Lançamentos pela loja, data e registro. Quando a
// venda foi paga com dois cartões, a Relação repete o registro numa linha "Cartao
// Mag" sem número; cada pagamento fica com o lançamento de mesmo valor.
function linkLaunches(caixa, groups){
  function key(t){ return [t.loja, t.data, t.registro].join('|'); }
  var byKey = new Map(), salesByKey = new Map(), links = new Map();
  groups.forEach(function(g){ var k = key(g); if(!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(g); });
  caixa.forEach(function(s){ var k = key(s); if(!salesByKey.has(k)) salesByKey.set(k, []); salesByKey.get(k).push(s); });
  salesByKey.forEach(function(sales, k){
    var internal = byKey.get(k) || [];
    var split = sales.length > 1 && sales.filter(function(s){ return s.pagamentoAdicional; }).length === sales.length - 1;
    var chosen = new Map();
    if(split){
      var free = internal.slice();
      sales.forEach(function(sale){
        var exact = free.filter(function(g){ return cents(g.valor) === cents(sale.valor); });
        var options = exact.length ? exact : free.filter(function(g){ return cents(sumValues(uniqueLaunchLines(g.linhas))) === cents(sale.valor); });
        if(options.length === 1){ chosen.set(sale, options[0]); free.splice(free.indexOf(options[0]), 1); }
      });
      var rest = sales.filter(function(s){ return !chosen.has(s); });
      if(rest.length === 1 && free.length === 1) chosen.set(rest[0], free.pop());
    }
    sales.forEach(function(sale){
      var launch = split ? chosen.get(sale) || null : internal.length === 1 ? internal[0] : null;
      var linked = launch ? [launch] : split ? internal.filter(function(g){ return !Array.from(chosen.values()).includes(g); }) : internal;
      var canal = linked.length && linked.every(function(g){ return g.canal === linked[0].canal; }) ? linked[0].canal : '';
      links.set(sale, { internal: linked, launch: launch, repeated: sales.length > 1 && !split, splitUnmatched: split && !launch, canal: canal });
    });
  });
  return links;
}

function buildCardAudit(caixa, launchLines, cielo, pairs){
  var groups = aggregateCardLaunches(launchLines), used = new Set(), rows = [];
  var coverage = assessLaunchCoverage(caixa, groups, cielo);
  if(groups.length && !coverage.compatible) return { blocked: true, coverage: coverage, rows: [], groups: groups, lineCount: launchLines.length, internalCount: 0 };
  var links = linkLaunches(caixa, groups);
  caixa.forEach(function(sale){
    var link = links.get(sale), internal = link.internal, launch = link.launch;
    var pair = pairs.matched.concat(pairs.divergValor).find(function(p){ return p.caixa === sale; });
    var issues = [];
    if(link.repeated) issues.push('Registro repetido na Relação');
    internal.forEach(function(g){ used.add(g); });
    if(link.splitUnmatched) issues.push('Pago com dois cartões: falta o lançamento de mesmo valor');
    else if(internal.length === 0) issues.push('Sem lançamento interno');
    else if(internal.length > 1) issues.push('Mais de um lançamento para o registro');
    if(launch && hasRepeatedLaunchLine(launch)) issues.push('Linha repetida nos Lançamentos');
    else if(launch && (launch.linhas.length !== launch.parcelas || launch.linhas.some(function(l){ return l.parcelas !== launch.parcelas; }))) issues.push('Parcelas internas incompletas ou repetidas');
    if(launch && launch.linhas.some(function(l){ return !l.cadastroValido; })) issues.push('Código e descrição divergentes do cadastro de cartões');
    if(launch && launch.faixaParcelas && !launch.faixaParcelas.includes(launch.parcelas)) issues.push('Parcelas fora da faixa do cartão cadastrado');
    var confirmed = !!pair && (pair.confidence === 'horario' || pair.confidence === 'entrega');
    if(!pair) issues.push(pairs.posSemCielo && pairs.posSemCielo.has(sale) ? 'Venda POS: Cielo da ' + storeName(POS_STORE) + ' não enviada' : 'Sem correspondência segura na Cielo');
    if(pair && !confirmed) issues.push('Conferir vínculo: apenas data e valor');
    if(pair && cents(sale.valor) !== cents(pair.banco.valor)) issues.push('Valor Cielo divergente');
    var reliable = launch && confirmed && cents(sale.valor) === cents(pair.banco.valor) && !issues.some(function(issue){ return /Registro repetido|Sem lançamento|Mais de um lançamento|Parcelas internas|Código e descrição|dois cartões/.test(issue); });
    var brand = false, mode = false, installments = false;
    if(reliable){
      if(!launch.bandeira || !pair.banco.bandeira) issues.push('Bandeira não identificada');
      else if(launch.bandeira !== pair.banco.bandeira){ brand = true; issues.push('Bandeira divergente'); }
      if(!/^(Debito|Credito)$/.test(launch.modalidade) || !/^(Debito|Credito)$/.test(pair.banco.modalidade)) issues.push('Modalidade não identificada');
      else if(launch.modalidade !== pair.banco.modalidade){ mode = true; issues.push('Débito / crédito divergente'); }
      if(!launch.parcelas || !pair.banco.parcelas) issues.push('Parcelas não identificadas');
      else if(launch.parcelas !== pair.banco.parcelas){ installments = true; issues.push('Parcelas divergentes'); }
    }
    rows.push({ sale: sale, launch: launch, bank: pair ? pair.banco : null, issues: issues, brand: brand, mode: mode, installments: installments, internalOK: internal.length === 1 && launch && launch.linhas.length === launch.parcelas, confidence: pair ? pair.confidence : null });
  });
  groups.filter(function(g){ return !used.has(g); }).forEach(function(g){ rows.push({ sale: null, launch: g, bank: null, issues: ['Lançamento sem venda na Relação'], internalOK: false }); });
  pairs.sobras.forEach(function(b){ rows.push({ sale: null, launch: null, bank: b, issues: ['Venda Cielo sem correspondência segura'], internalOK: false }); });
  rows.sort(function(a,b){ var x = a.sale || a.launch || a.bank, y = b.sale || b.launch || b.bank; return (x.data + (x.hora || '') + (x.registro || '')).localeCompare(y.data + (y.hora || '') + (y.registro || '')); });
  return { rows: rows, groups: groups, lineCount: launchLines.length, internalCount: rows.filter(function(r){ return r.internalOK; }).length, coverage: coverage };
}

function cardRangeWarning(row){
  var launch = row.launch;
  if(!launch || !launch.faixaParcelas || launch.faixaParcelas.includes(launch.parcelas)) return null;
  var actual = launch.parcelas + 'x';
  var registered = launch.faixaParcelas.map(function(n){ return n + 'x'; }).join(' ou ');
  var card = launch.descricao.replace(/^\d+\s*-\s*/, '');
  var detail = 'O caixa registrou ' + actual + ' para a venda (coluna Parc. dos Lançamentos). Na escolha seguinte, foi selecionado o cartão “' + card + '” (cód. ' + launch.codigoCartao + '), cadastrado para ' + registered + '. ';
  if((row.confidence === 'horario' || row.confidence === 'entrega') && row.bank && row.bank.parcelas){
    detail += row.bank.parcelas === launch.parcelas
      ? 'A Cielo também informa ' + actual + '. '
      : 'A Cielo informa ' + row.bank.parcelas + 'x; confira também o comprovante. ';
  }
  detail += 'Confira o cartão escolhido nessa segunda etapa.';
  return { title: 'Venda em ' + actual + '; cartão selecionado de ' + registered, detail: detail };
}

/* =========================================================================
   VÁRIAS LOJAS
   A Relação e os Lançamentos podem trazer todas as lojas; a Cielo vem uma por
   loja. Cada loja é conciliada com a própria Cielo e as vendas POS também são
   procuradas na Cielo da Loja 5. Com os arquivos de uma loja só, o resultado é
   o mesmo da conciliação de loja única.
   ========================================================================= */
function assignCieloStores(caixa, cielo){
  var relLojas = uniqueSorted(caixa.map(function(t){ return t.loja; }));
  var estabs = uniqueSorted(cielo.map(function(t){ return t.estabelecimento || 'sem número'; }));
  var unknown = estabs.filter(function(e){ return !storeByEstablishment(e); });
  // Loja única, como antes: um estabelecimento fora do cadastro vale para a loja da Relação.
  var single = unknown.length === 1 && estabs.length === 1 && relLojas.length <= 1;
  if(unknown.length && !single){
    var known = Object.keys(STORES).filter(function(k){ return STORES[k].estabelecimento; }).sort(storeOrder).map(function(k){ return storeName(k) + ' ' + STORES[k].estabelecimento; }).join(', ');
    throw new Error('O extrato Cielo do estabelecimento ' + unknown.join(', ') + ' não está ligado a nenhuma loja. Estabelecimentos cadastrados: ' + known + '.');
  }
  return cielo.map(function(t){ return Object.assign({}, t, { loja: single ? (relLojas[0] || '') : storeByEstablishment(t.estabelecimento) }); });
}

function cardDifferences(launch, bank){
  if(!launch || !bank) return [];
  var out = [];
  if(launch.bandeira && bank.bandeira && launch.bandeira !== bank.bandeira) out.push('Bandeira divergente');
  if(/^(Debito|Credito)$/.test(launch.modalidade) && /^(Debito|Credito)$/.test(bank.modalidade) && launch.modalidade !== bank.modalidade) out.push('Débito / crédito divergente');
  if(launch.parcelas && bank.parcelas && launch.parcelas !== bank.parcelas) out.push('Parcelas divergentes');
  return out;
}

function reconcileStores(caixa, cieloTx, launchLines){
  launchLines = launchLines || [];
  var cielo = assignCieloStores(caixa, cieloTx);
  var links = linkLaunches(caixa, aggregateCardLaunches(launchLines));
  function launchOf(sale){ var l = links.get(sale); return l ? l.launch : null; }
  function isPos(sale){ var l = links.get(sale); return !!l && l.canal === 'POS'; }
  var cieloStores = uniqueSorted(cielo.map(function(t){ return t.loja; })).sort(storeOrder);
  var relStores = uniqueSorted(caixa.map(function(t){ return t.loja; })).sort(storeOrder);
  if(!cieloStores.some(function(l){ return relStores.includes(l); })){
    throw new Error('A Cielo enviada é da ' + storeList(cieloStores) + ', mas a Relação de Vendas só tem vendas da ' + storeList(relStores) + '. Envie a Relação da mesma loja ou a Relação com todas as lojas.');
  }
  var posStoreSent = cieloStores.includes(POS_STORE);
  function posRouted(sale){ return isPos(sale) && sale.loja !== POS_STORE && POS_SOURCE_STORES.includes(sale.loja); }
  function allowed(sale, bank){ return bank.loja === sale.loja || (bank.loja === POS_STORE && posRouted(sale)); }
  var inScope = caixa.filter(function(s){ return cieloStores.includes(s.loja) || (posStoreSent && posRouted(s)); });
  var pairs = matchCardTransactions(inScope, cielo, { allowed: allowed, isPos: isPos, launchOf: launchOf });
  var linked = pairs.matched.concat(pairs.divergValor);
  var multi = cieloStores.length > 1 || relStores.length > 1;
  function bankSum(list){ return cents(sumValues(list.map(function(p){ return p.banco; }))); }

  var views = cieloStores.map(function(loja){
    function own(p){ return p.caixa.loja === loja; }
    function here(p){ return own(p) || p.banco.loja === loja; }
    var sales = caixa.filter(function(s){ return s.loja === loja; });
    var pool = cielo.filter(function(b){ return b.loja === loja; });
    var viewPairs = {
      matched: pairs.matched.filter(here), divergValor: pairs.divergValor.filter(here),
      ausentes: pairs.ausentes.filter(function(s){ return s.loja === loja; }),
      sobras: pairs.sobras.filter(function(b){ return b.loja === loja; })
    };
    viewPairs.posSemCielo = new Set(posStoreSent ? [] : viewPairs.ausentes.filter(posRouted));
    var posFora = linked.filter(function(p){ return own(p) && p.banco.loja !== loja; });
    var posRecebidas = linked.filter(function(p){ return !own(p) && p.banco.loja === loja; });

    var divergences = [];
    pairs.divergValor.filter(own).forEach(function(p){
      var d = buildDivergence('valor_divergente', p, 'Cielo');
      if(p.banco.loja !== loja) d.origemBanco = 'Cielo · ' + storeName(p.banco.loja);
      divergences.push(d);
    });
    viewPairs.ausentes.forEach(function(s){ divergences.push(buildDivergence(viewPairs.posSemCielo.has(s) ? 'pos_sem_cielo' : 'ausente_banco', s, 'Cielo')); });
    viewPairs.sobras.forEach(function(b){ divergences.push(buildDivergence('sobra_banco', b, 'Cielo')); });

    var caixaCents = cents(sumValues(sales)), poolCents = cents(sumValues(pool));
    var foraCents = bankSum(posFora), recebidasCents = bankSum(posRecebidas);
    var summary = [{ modalidade: multi ? 'Caixa × Cielo · ' + storeName(loja) : 'Caixa × Cielo', caixa: caixaCents / 100, banco: poolCents / 100, batidos: pairs.matched.filter(function(p){ return own(p) && p.banco.loja === loja; }).length, totalCaixaCount: sales.length }];
    if(posFora.length) summary.push({ ajuste: true, modalidade: 'Vendas POS desta loja recebidas na Cielo da ' + storeName(POS_STORE), banco: foraCents / 100, qtd: posFora.length });
    if(posRecebidas.length){
      var origem = uniqueSorted(posRecebidas.map(function(p){ return p.caixa.loja; })).sort(storeOrder).map(function(l){ return storeName(l) + ': ' + posRecebidas.filter(function(p){ return p.caixa.loja === l; }).length; }).join(' · ');
      summary.push({ ajuste: true, modalidade: 'Vendas POS de outras lojas nesta Cielo (' + origem + ')', banco: -recebidasCents / 100, qtd: posRecebidas.length });
    }
    if(summary.length > 1) summary.push({ total: true, modalidade: 'Total separando as vendas POS', caixa: caixaCents / 100, banco: (poolCents + foraCents - recebidasCents) / 100, batidos: pairs.matched.filter(own).length, totalCaixaCount: sales.length });
    if(viewPairs.posSemCielo.size) summary.push({ nota: true, modalidade: 'Vendas POS desta loja: ficam na Cielo da ' + storeName(POS_STORE) + ', que não foi enviada', caixa: sumValues(Array.from(viewPairs.posSemCielo)), qtd: viewPairs.posSemCielo.size });

    // Lançamentos sem esta loja: o aviso de cobertura explica qual loja veio.
    var storeLaunches = launchLines.filter(function(l){ return l.loja === loja; });
    var cardAudit = launchLines.length ? buildCardAudit(sales, storeLaunches.length ? storeLaunches : launchLines, pool, viewPairs) : null;
    return {
      loja: loja, nome: storeName(loja), caixa: sales, cielo: pool, lancamentos: storeLaunches, pairs: viewPairs,
      divergences: divergences, summary: summary, cardAudit: cardAudit, posFora: posFora, posRecebidas: posRecebidas,
      // Cielo − Relação, como no PIX: positivo = sobra na Cielo; negativo = falta na Cielo.
      diferencaFinal: (poolCents + foraCents - recebidasCents - caixaCents) / 100, semVendas: !sales.length
    };
  });

  var semCielo = relStores.filter(function(l){ return !cieloStores.includes(l); }).map(function(loja){
    var sales = caixa.filter(function(s){ return s.loja === loja; });
    return { loja: loja, nome: storeName(loja), vendas: sales.length, total: sumValues(sales), motivo: STORES[loja] && STORES[loja].semCielo || 'Cielo desta loja não enviada', posFora: linked.filter(function(p){ return p.caixa.loja === loja; }) };
  });
  var posEntreLojas = linked.filter(function(p){ return p.caixa.loja !== p.banco.loja; }).map(function(p){
    var launch = launchOf(p.caixa);
    return { caixa: p.caixa, banco: p.banco, confidence: p.confidence, launch: launch, diferencas: cardDifferences(launch, p.banco), valorDivergente: cents(p.caixa.valor) !== cents(p.banco.valor) };
  }).sort(function(a, b){ return storeOrder(a.caixa.loja, b.caixa.loja) || (a.caixa.data + a.caixa.hora).localeCompare(b.caixa.data + b.caixa.hora); });
  return { cielo: cielo, views: views, semCielo: semCielo, posEntreLojas: posEntreLojas, pairs: pairs, multi: multi, cieloStores: cieloStores, relStores: relStores };
}

/* =========================================================================
   CONCILIAÇÃO PIX
   Relação de Vendas emitida com CARTEIRA DIGITAL ("Cart. Dig" = Pix) × extratos
   Sicredi, usando só os lançamentos RECEBIMENTO PIX. Cada loja recebe na própria
   conta; a Loja 4 (código 7) não tem conta e recebe na conta da Loja 2; a conta
   da Loja 5 (código 6) atende o delivery e pode receber vendas "Dom" das outras.
   Valores em centavos. Status e regras seguem a conferência manual da planilha.
   ========================================================================= */
var PIX_CONTAS = [
  { conta: '87041-2', lojas: ['1'] },
  { conta: '75073-5', lojas: ['2', '7'] },
  { conta: '75079-4', lojas: ['3'] },
  { conta: '83679-6', lojas: ['6'] }
];
var PIX_CONTA_DELIVERY = '83679-6';
var PIX_TOLERANCIA_CENTAVOS = 5;
var PIX_STATUS = {
  conciliado: 'CONCILIADO',
  outraConta: 'CONCILIADO - CAIU NA CONTA DE OUTRA LOJA',
  diferenca: 'CONCILIADO C/ DIFERENÇA',
  naoEncontrado: 'NÃO ENCONTRADO NO EXTRATO',
  semVenda: 'SEM VENDA NO SISTEMA',
  foraDoPeriodo: 'FORA DO PERÍODO'
};

function pixLojas(){ return [].concat.apply([], PIX_CONTAS.map(function(c){ return c.lojas; })).sort(storeOrder); }
function pixContaCadastrada(conta){ return PIX_CONTAS.find(function(c){ return c.conta === conta; }) || null; }
function pixContaDaLoja(loja){ var c = PIX_CONTAS.find(function(x){ return x.lojas.includes(loja); }); return c ? c.conta : ''; }
function pixNomeConta(conta){ var c = pixContaCadastrada(conta); return c ? c.lojas.slice().sort(storeOrder).map(storeName).join(' + ') : 'Conta ' + conta; }
function pixContasTexto(){ return PIX_CONTAS.map(function(c){ return c.conta + ' (' + pixNomeConta(c.conta) + ')'; }).join(', '); }
function pixReais(c){ return (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pixId(prefixo, n){ return prefixo + String(n).padStart(3, '0'); }
function pixSoma(lista, campo){ return lista.reduce(function(s, x){ return s + x[campo || 'centavos']; }, 0); }
function pixPeriodoTexto(p){ return p.inicio === p.fim ? formatDateBR(p.inicio) : formatDateBR(p.inicio) + ' a ' + formatDateBR(p.fim); }

// Relação do PIX: cabeçalho "Forma Pagto.: CARTEIRA DIGITAL" ou vendas só em "Cart. Dig".
function isRelacaoPix(lines){
  if(/FORMA PAGTO\.?\s*:?\s*CARTEIRA DIGITAL/.test(normalizeText(lines.slice(0, 15).join(' ')))) return true;
  var pix = 0, outras = 0;
  lines.forEach(function(line){
    if(!/\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}/.test(line)) return;
    if(/\bCART\.?\s*DIG\b/i.test(line)) pix++; else outras++;
  });
  return pix > 0 && outras === 0;
}

// Vendas "Cart. Dig" por loja, com página, Sit (Bal/Dom) e conferência do "Total da Loja".
function parseRelacaoPix(lines){
  var valor = '(-?\\d{1,3}(?:\\.\\d{3})*,\\d{2})';
  var vendaRe = new RegExp('^(\\d+)\\s+([A-Za-z]{2,4})\\s+(?:(\\S+)\\s+)?(\\d+)\\s+(\\d{2}/\\d{2}/\\d{4})\\s+(\\d{1,2}:\\d{2})(?::\\d{2})?\\s+(\\d+)\\s*/\\s*(\\d+)\\s+(\\d+)\\s+(\\S*%)\\s+(.+?)\\s+' + valor + '$');
  var adicionalRe = new RegExp('^Cart\\.?\\s*Dig\\.?\\s+' + valor + '$', 'i');
  var vendas = [], lojas = new Map(), avisos = [], ignoradas = 0;
  var pagina = 1, loja = null, periodo = null, formaPagamento = '', totalGeral = null, ultima = null;

  function registrar(venda){
    venda.centavos = cents(venda.valor);
    venda.delivery = /^DOM$/i.test(venda.sit);
    venda.ordem = vendas.length;
    vendas.push(venda);
    loja.totalLido += venda.centavos;
    loja.vendas++;
  }

  lines.forEach(function(line){
    var t = String(line || '').trim(), m;
    if((m = t.match(/Pagina\s*:\s*(\d+)/i))) pagina = Number(m[1]);
    if(!periodo && (m = t.match(/Per[ií]odo\s*:\s*(\d{2}\/\d{2}\/\d{2,4})\s*a\s*(\d{2}\/\d{2}\/\d{2,4})/i))) periodo = { inicio: parseDateAny(m[1]), fim: parseDateAny(m[2]) };
    if(!formaPagamento && (m = t.match(/Forma Pagto\.?\s*:\s*(.+?)(?:\s+-\s+<[^>]*>)?\s*$/i))) formaPagamento = m[1].trim();
    if((m = t.match(/^(\d+)\s*-\s*(LOJA\b.*)$/i))){
      if(!lojas.has(m[1])) lojas.set(m[1], { codigo: m[1], nomePdf: m[1] + '-' + m[2].trim(), totalImpresso: null, totalLido: 0, vendas: 0 });
      loja = lojas.get(m[1]); ultima = null; return;
    }
    if((m = t.match(/Total da Loja[\s.]*:\s*(-?[\d.]+,\d{2})/i))){ if(loja) loja.totalImpresso = cents(parseValorBR(m[1])); ultima = null; return; }
    if((m = t.match(/Total Geral[\s.]*:\s*(-?[\d.]+,\d{2})/i))){ totalGeral = cents(parseValorBR(m[1])); ultima = null; return; }
    if((m = t.match(vendaRe))){
      if(!/^CART\.?\s*DIG\.?$/i.test(m[11].trim())){ ignoradas++; ultima = null; return; }
      if(!loja) throw new Error('A Relação tem venda PIX antes do nome da loja. Confira o layout do PDF.');
      ultima = { loja: loja.codigo, lojaPdf: loja.nomePdf, pagina: pagina, registro: m[1], sit: m[2], bd: m[3] || '', documento: m[4], data: parseDateAny(m[5]), hora: parseTimeAny(m[6]), caixaTurno: m[7] + '/' + m[8], vendedor: m[9], valor: parseValorBR(m[12]), pagamentoAdicional: false, raw: t };
      registrar(ultima);
      return;
    }
    // "Cart. Dig 20,00" sem registro: outro Pix da venda anterior.
    if(ultima && (m = t.match(adicionalRe))){
      registrar(Object.assign({}, ultima, { pagina: pagina, valor: parseValorBR(m[1]), pagamentoAdicional: true, raw: t }));
    }
  });

  if(!vendas.length) throw new Error('Nenhuma venda "Cart. Dig" foi reconhecida na Relação de Vendas. Emita o relatório com Forma Pagto. CARTEIRA DIGITAL.');
  var semConta = Array.from(lojas.values()).filter(function(l){ return l.vendas && !pixContaDaLoja(l.codigo); });
  if(semConta.length) throw new Error('A Relação tem vendas PIX de ' + semConta.map(function(l){ return l.nomePdf; }).join(', ') + ', sem conta PIX cadastrada. Contas cadastradas: ' + pixContasTexto() + '.');
  lojas.forEach(function(l){
    if(!l.vendas && l.totalImpresso === null) return;
    var nome = storeName(l.codigo) + ' (' + l.nomePdf + ')';
    if(l.totalImpresso === null) avisos.push('A ' + nome + ' não tem a linha "Total da Loja" no PDF. Confira se o relatório veio completo.');
    else if(l.totalImpresso !== l.totalLido) avisos.push('A soma das vendas PIX lidas da ' + nome + ' é R$ ' + pixReais(l.totalLido) + ', mas o "Total da Loja" do PDF é R$ ' + pixReais(l.totalImpresso) + '. Confira o PDF antes de usar o resultado desta loja.');
  });
  var totalLido = pixSoma(vendas);
  if(totalGeral !== null && totalGeral !== totalLido) avisos.push('A soma de todas as vendas PIX lidas é R$ ' + pixReais(totalLido) + ', mas o "Total Geral" do PDF é R$ ' + pixReais(totalGeral) + '.');
  if(ignoradas) avisos.push(ignoradas + ' venda(s) com outra forma de pagamento foram ignoradas: a conciliação PIX usa só as vendas "Cart. Dig".');
  if(formaPagamento && !/CARTEIRA DIGITAL/i.test(formaPagamento)) avisos.push('A Relação foi emitida com Forma Pagto. "' + formaPagamento + '". Para o PIX, emita com CARTEIRA DIGITAL.');
  if(!periodo){
    var datas = uniqueSorted(vendas.map(function(v){ return v.data; }));
    periodo = { inicio: datas[0], fim: datas[datas.length - 1] };
  }
  // IDs como na planilha de conferência: por loja (1 a 5) e na ordem do PDF.
  vendas.sort(function(a, b){ return storeOrder(a.loja, b.loja) || a.ordem - b.ordem; });
  vendas.forEach(function(v, i){ v.id = pixId('S', i + 1); });
  return {
    vendas: vendas,
    lojas: Array.from(lojas.values()).sort(function(a, b){ return storeOrder(a.codigo, b.codigo); }),
    periodo: periodo, formaPagamento: formaPagamento, totalLido: totalLido, totalGeralImpresso: totalGeral, avisos: avisos
  };
}

// Extrato Sicredi: conta pela célula "Conta:", só "RECEBIMENTO PIX" (pela descrição,
// não pelo documento, que pode vir cortado como "PIX_CRE") e número da linha no Excel.
function parseExtratoPix(matrix, opcoes){
  opcoes = opcoes || {};
  var arquivo = opcoes.arquivo || 'extrato', primeiraLinha = opcoes.primeiraLinha || 1;
  var conta = '', associado = '', periodo = null;
  function texto(c){ return String(c == null ? '' : c).trim(); }
  function aoLado(row, i){ for(var j = i + 1; j < row.length; j++){ if(texto(row[j])) return texto(row[j]); } return ''; }
  matrix.slice(0, 40).forEach(function(row){
    (row || []).forEach(function(cell, i){
      var t = normalizeText(cell), m;
      if(!conta && /^CONTA\s*:?$/.test(t)) conta = aoLado(row, i);
      if(!associado && /^ASSOCIADO\s*:?$/.test(t)) associado = aoLado(row, i);
      if(!periodo && (m = texto(cell).match(/per[ií]odo de (\d{2}\/\d{2}\/\d{4}) a (\d{2}\/\d{2}\/\d{4})/i))) periodo = { inicio: parseDateAny(m[1]), fim: parseDateAny(m[2]) };
    });
  });
  var headerIdx = findPixHeaderRow(matrix);
  if(headerIdx === -1) throw new Error('O arquivo "' + arquivo + '" não parece um extrato Sicredi: falta o cabeçalho "Data | Descrição | Documento | Valor".');
  if(!conta) throw new Error('Não achei o número da conta (linha "Conta:") no extrato "' + arquivo + '".');
  var header = matrix[headerIdx];
  var colData = findColIndex(header, ['data']), colDesc = findColIndex(header, ['descri', 'hist']);
  var colDoc = findColIndex(header, ['documento', 'doc']), colValor = findColIndex(header, ['valor']);
  if(colData === -1 || colDesc === -1 || colValor === -1) throw new Error('O extrato "' + arquivo + '" não tem as colunas Data, Descrição e Valor.');
  var pix = [], ultimaData = null;
  for(var i = headerIdx + 1; i < matrix.length; i++){
    var row = matrix[i] || [];
    var primeira = normalizeText(row.find(function(c){ return texto(c); }) || '');
    if(/^(SALDO DA CONTA|LANCAMENTOS FUTUROS)/.test(primeira)) break;
    var data = parseDateAny(row[colData]);
    if(data) ultimaData = data;
    var descricao = texto(row[colDesc]);
    if(!/^RECEBIMENTO PIX\b/.test(normalizeText(descricao))) continue;
    var valor = parseValorBR(row[colValor]);
    if(!Number.isFinite(valor) || valor <= 0) continue;
    var pagador = descricao.replace(/^\s*RECEBIMENTO\s+PIX\s*/i, '').trim();
    var doc = pagador.match(/^(\d{11}|\d{14})\b\s*(.*)$/);
    pix.push({
      arquivo: arquivo, conta: conta, linha: primeiraLinha + i, data: data || ultimaData,
      descricao: descricao, pagador: pagador, pagadorDoc: doc ? doc[1] : '', pagadorNome: doc ? doc[2].trim() : pagador,
      documento: colDoc !== -1 ? texto(row[colDoc]) : '', valor: valor, centavos: cents(valor)
    });
  }
  return { arquivo: arquivo, conta: conta, associado: associado, periodo: periodo, pix: pix };
}

// Cada Pix é usado uma vez, só no período da Relação e na data da venda. Ordem:
// valor exato na conta da loja → venda "Dom" na conta da Loja 5 → dois Pix do mesmo
// pagador somando o valor → um Pix com até 5 centavos de diferença → dois Pix com até
// 5 centavos. Vendas em ordem de hora e Pix em ordem de linha desempatam valores iguais.
function conciliarPix(relacao, extratos){
  var avisos = relacao.avisos.slice(), periodo = relacao.periodo, porConta = new Map();
  extratos.forEach(function(ex){
    if(!pixContaCadastrada(ex.conta)) throw new Error('O extrato "' + ex.arquivo + '" é da conta ' + ex.conta + ', que não está no cadastro PIX. Contas cadastradas: ' + pixContasTexto() + '.');
    if(porConta.has(ex.conta)) throw new Error('Foram enviados dois extratos da conta ' + ex.conta + ' (' + porConta.get(ex.conta).arquivo + ' e ' + ex.arquivo + ').');
    porConta.set(ex.conta, ex);
  });
  PIX_CONTAS.forEach(function(c){
    var ex = porConta.get(c.conta);
    if(!ex) avisos.push('Falta o extrato da conta ' + c.conta + ' (' + pixNomeConta(c.conta) + '): as vendas dessas lojas ficam como não encontradas.');
    else if(ex.periodo && (ex.periodo.inicio > periodo.inicio || ex.periodo.fim < periodo.fim)) avisos.push('O extrato da conta ' + c.conta + ' (' + ex.arquivo + ') vai de ' + pixPeriodoTexto(ex.periodo) + ' e não cobre a data da Relação (' + pixPeriodoTexto(periodo) + ').');
  });
  function noPeriodo(data){ return !!data && data >= periodo.inicio && data <= periodo.fim; }

  var pix = [];
  PIX_CONTAS.forEach(function(c){
    var ex = porConta.get(c.conta);
    if(ex) ex.pix.slice().sort(function(a, b){ return a.linha - b.linha; }).forEach(function(p){ pix.push(Object.assign({}, p, { venda: null })); });
  });
  pix.forEach(function(p, i){ p.id = pixId('E', i + 1); p.noPeriodo = noPeriodo(p.data); });

  var vendas = relacao.vendas.map(function(v){ return Object.assign({}, v, { conta: pixContaDaLoja(v.loja), pix: [] }); });
  var fila = vendas.slice().sort(function(a, b){ return (a.data + (a.hora || '')).localeCompare(b.data + (b.hora || '')) || a.id.localeCompare(b.id); });

  function livres(conta, data){ return pix.filter(function(p){ return p.noPeriodo && !p.venda && p.conta === conta && p.data === data; }); }
  function pagador(p){ return p.pagadorDoc || normalizeText(p.pagadorNome); }
  function umPix(venda, conta, tolerancia){
    var opcoes = livres(conta, venda.data).filter(function(p){ return Math.abs(p.centavos - venda.centavos) <= tolerancia; });
    opcoes.sort(function(a, b){ return Math.abs(a.centavos - venda.centavos) - Math.abs(b.centavos - venda.centavos) || a.linha - b.linha; });
    return opcoes.length ? [opcoes[0]] : null;
  }
  function doisPix(venda, conta, tolerancia){
    var lista = livres(conta, venda.data), melhor = null;
    for(var i = 0; i < lista.length; i++){
      for(var j = i + 1; j < lista.length; j++){
        var a = lista[i], b = lista[j];
        if(!pagador(a) || pagador(a) !== pagador(b)) continue;
        var dif = Math.abs(a.centavos + b.centavos - venda.centavos);
        if(dif <= tolerancia && (!melhor || dif < melhor.dif)) melhor = { par: [a, b], dif: dif };
      }
    }
    return melhor ? melhor.par : null;
  }
  function etapa(buscar, tolerancia, naContaDoDelivery){
    fila.forEach(function(venda){
      if(venda.pix.length || !venda.conta) return;
      var conta = venda.conta;
      if(naContaDoDelivery){
        if(!venda.delivery || venda.conta === PIX_CONTA_DELIVERY) return;
        conta = PIX_CONTA_DELIVERY;
      }
      var achados = buscar(venda, conta, tolerancia);
      if(achados){ achados.forEach(function(p){ p.venda = venda; }); venda.pix = achados; }
    });
  }
  etapa(umPix, 0, false); etapa(umPix, 0, true);
  etapa(doisPix, 0, false); etapa(doisPix, 0, true);
  etapa(umPix, PIX_TOLERANCIA_CENTAVOS, false); etapa(umPix, PIX_TOLERANCIA_CENTAVOS, true);
  etapa(doisPix, PIX_TOLERANCIA_CENTAVOS, false); etapa(doisPix, PIX_TOLERANCIA_CENTAVOS, true);

  vendas.forEach(function(v){
    if(!v.pix.length){
      v.status = PIX_STATUS.naoEncontrado; v.banco = 0; v.diferenca = -v.centavos; v.contaRecebida = '';
      v.observacao = 'Nenhum Pix de ' + pixReais(v.centavos) + ' livre na conta ' + v.conta + ' (' + pixNomeConta(v.conta) + ')'
        + (v.delivery && v.conta !== PIX_CONTA_DELIVERY ? ' nem na conta do delivery ' + PIX_CONTA_DELIVERY + ' (' + pixNomeConta(PIX_CONTA_DELIVERY) + ')' : '')
        + ' em ' + formatDateBR(v.data) + '.';
      return;
    }
    v.banco = pixSoma(v.pix); v.diferenca = v.banco - v.centavos; v.contaRecebida = v.pix[0].conta;
    var partes = [], linhas = v.pix.map(function(p){ return p.linha; }).join(' + ');
    var recebido = v.pix.length > 1 ? 'Pago em ' + v.pix.length + ' Pix do mesmo pagador (' + v.pix.map(function(p){ return pixReais(p.centavos); }).join(' + ') + ' = ' + pixReais(v.banco) + ')' : 'Pix de ' + pixReais(v.banco);
    if(v.diferenca) partes.push(recebido + ' para venda de ' + pixReais(v.centavos) + ': recebido ' + pixReais(Math.abs(v.diferenca)) + (v.diferenca > 0 ? ' a mais' : ' a menos'));
    else if(v.pix.length > 1) partes.push(recebido);
    if(v.contaRecebida !== v.conta) partes.push('Venda da ' + storeName(v.loja) + (v.delivery ? ' (delivery)' : '') + ' recebida no extrato da ' + pixNomeConta(v.contaRecebida) + ' (' + v.pix[0].arquivo + ' · conta ' + v.contaRecebida + ' · linha ' + linhas + ')');
    v.status = v.diferenca ? PIX_STATUS.diferenca : v.contaRecebida !== v.conta ? PIX_STATUS.outraConta : PIX_STATUS.conciliado;
    v.observacao = partes.length ? partes.join('. ') + '.' : '';
  });
  pix.forEach(function(p){ p.situacao = !p.noPeriodo ? PIX_STATUS.foraDoPeriodo : p.venda ? PIX_STATUS.conciliado : PIX_STATUS.semVenda; });

  var porLoja = pixLojas().map(function(loja){
    var vs = vendas.filter(function(v){ return v.loja === loja; });
    var conc = vs.filter(function(v){ return v.pix.length; }), nao = vs.filter(function(v){ return !v.pix.length; });
    var info = relacao.lojas.find(function(l){ return l.codigo === loja; }), conta = pixContaDaLoja(loja);
    var totalSistema = pixSoma(vs), totalBanco = pixSoma(conc, 'banco');
    return {
      loja: loja, nome: storeName(loja), nomePdf: info ? info.nomePdf : '', conta: conta, arquivo: porConta.has(conta) ? porConta.get(conta).arquivo : '',
      qtdVendas: vs.length, totalSistema: totalSistema, qtdConciliadas: conc.length, totalBanco: totalBanco, diferenca: totalBanco - totalSistema,
      qtdNaoEncontradas: nao.length, valorNaoEncontrado: pixSoma(nao),
      qtdAMenos: conc.filter(function(v){ return v.diferenca < 0; }).length, valorAMenos: -pixSoma(conc.filter(function(v){ return v.diferenca < 0; }), 'diferenca'),
      // Só a venda sem Pix deixa a loja pendente; Pix a mais, centavos e outra conta não.
      situacao: !vs.length ? 'SEM VENDAS PIX' : nao.length ? 'PENDENTE' : 'CONCILIADO'
    };
  });

  // Diferença da conta = Pix do período na conta − vendas das lojas que recebem nela.
  var contas = PIX_CONTAS.map(function(c){
    var ex = porConta.get(c.conta), daConta = pix.filter(function(p){ return p.conta === c.conta; });
    var noDia = daConta.filter(function(p){ return p.noPeriodo; }), fora = daConta.filter(function(p){ return !p.noPeriodo; });
    var conc = noDia.filter(function(p){ return p.venda; }), sem = noDia.filter(function(p){ return !p.venda; });
    var proprias = vendas.filter(function(v){ return c.lojas.includes(v.loja); });
    var aqui = proprias.filter(function(v){ return v.pix.length && v.contaRecebida === c.conta; });
    var emOutra = proprias.filter(function(v){ return v.pix.length && v.contaRecebida !== c.conta; });
    var nao = proprias.filter(function(v){ return !v.pix.length; });
    var deOutras = vendas.filter(function(v){ return !c.lojas.includes(v.loja) && v.pix.length && v.contaRecebida === c.conta; });
    var origem = uniqueSorted(deOutras.map(function(v){ return v.loja; })).sort(storeOrder).map(function(l){ var n = deOutras.filter(function(v){ return v.loja === l; }).length; return storeName(l) + ': ' + n + (n === 1 ? ' venda' : ' vendas'); }).join(' · ');
    var destino = uniqueSorted(emOutra.map(function(v){ return v.contaRecebida; })).map(function(x){ return 'extrato da ' + pixNomeConta(x) + (porConta.has(x) ? ' · ' + porConta.get(x).arquivo : ''); }).join(', ');
    var composicao = [
      { tipo: 'centavos', texto: 'Diferenças de centavos nas vendas conciliadas', valor: pixSoma(aqui, 'diferenca'), qtd: aqui.filter(function(v){ return v.diferenca; }).length },
      { tipo: 'outrasLojas', texto: 'Pix de vendas de outras lojas que caíram neste extrato' + (origem ? ' (' + origem + ')' : ''), valor: pixSoma(deOutras, 'banco'), qtd: deOutras.length },
      { tipo: 'semVenda', texto: 'Pix a mais no extrato (sem venda no sistema)', valor: pixSoma(sem), qtd: sem.length },
      { tipo: 'outraConta', texto: (c.lojas.length > 1 ? 'Vendas destas lojas' : 'Vendas desta loja') + ' que caíram no extrato de outra loja' + (destino ? ' (' + destino + ')' : ''), valor: -pixSoma(emOutra), qtd: emOutra.length },
      { tipo: 'naoEncontradas', texto: 'Vendas não encontradas no extrato', valor: -pixSoma(nao), qtd: nao.length }
    ].filter(function(x){ return x.qtd > 0; });
    var totalPeriodo = pixSoma(noDia), totalSistema = pixSoma(proprias);
    return {
      conta: c.conta, lojas: c.lojas.slice(), nome: pixNomeConta(c.conta), arquivo: ex ? ex.arquivo : '', enviado: !!ex,
      qtdPeriodo: noDia.length, totalPeriodo: totalPeriodo, qtdConciliados: conc.length, totalConciliado: pixSoma(conc),
      qtdSemVenda: sem.length, valorSemVenda: pixSoma(sem), qtdFora: fora.length, valorFora: pixSoma(fora),
      qtdVendasSistema: proprias.length, totalSistema: totalSistema, diferenca: totalPeriodo - totalSistema, composicao: composicao
    };
  });

  var conciliadas = vendas.filter(function(v){ return v.pix.length; });
  var naoEncontradas = vendas.filter(function(v){ return !v.pix.length; });
  var semVenda = pix.filter(function(p){ return p.situacao === PIX_STATUS.semVenda; });
  var ponte = {
    totalSistema: pixSoma(vendas), centavos: pixSoma(conciliadas, 'diferenca'), semVenda: pixSoma(semVenda),
    naoEncontradas: pixSoma(naoEncontradas), totalExtratos: pixSoma(pix.filter(function(p){ return p.noPeriodo; }))
  };
  ponte.esperado = ponte.totalSistema + ponte.centavos + ponte.semVenda - ponte.naoEncontradas;
  ponte.checagem = ponte.totalExtratos - ponte.esperado;

  function contar(lista, campo){ var out = {}; lista.forEach(function(x){ out[x[campo]] = (out[x[campo]] || 0) + 1; }); return out; }
  return {
    periodo: periodo, vendas: vendas, pix: pix, porLoja: porLoja, porConta: contas, ponte: ponte,
    naoEncontradas: naoEncontradas, semVenda: semVenda, foraDoPeriodo: pix.filter(function(p){ return !p.noPeriodo; }),
    aMenos: conciliadas.filter(function(v){ return v.diferenca < 0; }),
    observacoes: conciliadas.filter(function(v){ return v.status !== PIX_STATUS.conciliado && v.diferenca >= 0; }),
    contagem: { vendas: contar(vendas, 'status'), pix: contar(pix, 'situacao') },
    avisos: avisos
  };
}

// "Vendas lidas" de uma loja, lado a lado: cada venda da loja com o(s) Pix que a pagaram
// e os Pix sem venda da conta onde a loja recebe. Pix desta conta que pagaram vendas de
// outra loja (delivery na conta da Loja 5) também entram, com a loja da venda, como as
// vendas POS na conciliação de cartão. Lojas que dividem a conta (2 e 4) não se misturam.
// Pix sem venda ficam na altura do extrato: logo depois do Pix da linha anterior.
function pixLadoALado(r, loja){
  var conta = pixContaDaLoja(loja), compartilhada = (pixContaCadastrada(conta) || { lojas: [] }).lojas.length > 1;
  var linhas = [];
  r.vendas.forEach(function(v){
    var daLoja = v.loja === loja;
    var deFora = !daLoja && v.pix.length && v.contaRecebida === conta && pixContaDaLoja(v.loja) !== conta;
    if(!daLoja && !deFora) return;
    linhas.push({ venda: v, pix: v.pix, situacao: v.status, outraLoja: !daLoja, outraConta: daLoja && !!v.pix.length && v.contaRecebida !== conta, chave: v.data + ' ' + (v.hora || '') });
  });
  r.semVenda.filter(function(p){ return p.conta === conta; }).forEach(function(p){
    var antes = r.pix.filter(function(x){ return x.conta === conta && x.noPeriodo && x.venda && x.linha < p.linha; }).sort(function(a, b){ return b.linha - a.linha; })[0];
    var chave = antes ? antes.venda.data + ' ' + (antes.venda.hora || '') + '~' : p.data + ' ';
    linhas.push({ venda: null, pix: [p], situacao: p.situacao, compartilhada: compartilhada, chave: chave });
  });
  linhas.sort(function(a, b){ return a.chave.localeCompare(b.chave) || (a.venda ? a.venda.id : a.pix[0].id).localeCompare(b.venda ? b.venda.id : b.pix[0].id); });
  linhas.forEach(function(l){
    // Pendência é só venda sem Pix; recebido a menos pede atenção; Pix a mais é informação.
    l.pendente = l.situacao === PIX_STATUS.naoEncontrado;
    l.atencao = !!l.venda && !!l.pix.length && l.venda.diferenca < 0;
    l.extra = l.situacao === PIX_STATUS.semVenda;
    l.observacao = !l.pendente && !l.atencao && !l.extra && l.situacao !== PIX_STATUS.conciliado;
  });
  return {
    loja: loja, conta: conta, compartilhada: compartilhada, linhas: linhas,
    vendas: linhas.filter(function(l){ return l.venda && !l.outraLoja; }).length,
    pix: linhas.reduce(function(n, l){ return n + l.pix.length; }, 0),
    pendentes: linhas.filter(function(l){ return l.pendente; }).length,
    atencao: linhas.filter(function(l){ return l.atencao; }).length,
    extras: linhas.filter(function(l){ return l.extra; }).length,
    observacoes: linhas.filter(function(l){ return l.observacao; }).length
  };
}

// Abas do Excel exportado, no formato da planilha de conferência (valores em reais).
function planilhasPix(r){
  function reais(c){ return Math.round(c) / 100; }
  function linhasPix(v){ return v.pix.map(function(p){ return p.linha; }).join(' + '); }
  var resumo = [
    ['CONCILIAÇÃO PIX — Sistema (Relação de Vendas por Período, Cart. Dig) × Extratos Sicredi'],
    ['Data conciliada', pixPeriodoTexto(r.periodo)],
    [],
    ['Resumo por loja'],
    ['Loja', 'Nome no relatório (PDF)', 'Conta onde cai o Pix', 'Extrato', 'Qtd vendas sistema', 'Total sistema (R$)', 'Qtd conciliadas', 'Total banco conciliado (R$)', 'Diferença Banco − Sistema (R$)', 'Qtd não encontradas no extrato', 'Valor não encontrado (R$)', 'Situação']
  ];
  r.porLoja.forEach(function(l){ resumo.push([l.nome, l.nomePdf, l.conta + ' (' + pixNomeConta(l.conta) + ')', l.arquivo, l.qtdVendas, reais(l.totalSistema), l.qtdConciliadas, reais(l.totalBanco), reais(l.diferenca), l.qtdNaoEncontradas, reais(l.valorNaoEncontrado), l.situacao]); });
  resumo.push(['TOTAL', '', '', '', pixSoma(r.porLoja, 'qtdVendas'), reais(pixSoma(r.porLoja, 'totalSistema')), pixSoma(r.porLoja, 'qtdConciliadas'), reais(pixSoma(r.porLoja, 'totalBanco')), reais(pixSoma(r.porLoja, 'diferenca')), pixSoma(r.porLoja, 'qtdNaoEncontradas'), reais(pixSoma(r.porLoja, 'valorNaoEncontrado')), '']);
  resumo.push([], ['Resumo por conta bancária'], ['Conta', 'Lojas que recebem nesta conta', 'Extrato', 'Qtd Pix no período', 'Total Pix no período (R$)', 'Vendas do sistema dessas lojas (R$)', 'Diferença Banco − Sistema (R$)', 'De onde vem a diferença', 'Qtd Pix conciliados', 'Total Pix conciliado (R$)', 'Qtd Pix sem venda', 'Valor Pix sem venda (R$)', 'Qtd Pix fora do período', 'Valor Pix fora do período (R$)']);
  r.porConta.forEach(function(c){
    var explicacao = c.composicao.map(function(x){ return (x.valor < 0 ? '− ' : '+ ') + pixReais(Math.abs(x.valor)) + ' ' + x.texto; }).join('; ');
    resumo.push([c.conta, c.nome, c.arquivo || 'não enviado', c.qtdPeriodo, reais(c.totalPeriodo), reais(c.totalSistema), reais(c.diferenca), explicacao, c.qtdConciliados, reais(c.totalConciliado), c.qtdSemVenda, reais(c.valorSemVenda), c.qtdFora, reais(c.valorFora)]);
  });
  resumo.push(['TOTAL', '', '', pixSoma(r.porConta, 'qtdPeriodo'), reais(pixSoma(r.porConta, 'totalPeriodo')), reais(pixSoma(r.porConta, 'totalSistema')), reais(pixSoma(r.porConta, 'diferenca')), '', pixSoma(r.porConta, 'qtdConciliados'), reais(pixSoma(r.porConta, 'totalConciliado')), pixSoma(r.porConta, 'qtdSemVenda'), reais(pixSoma(r.porConta, 'valorSemVenda')), pixSoma(r.porConta, 'qtdFora'), reais(pixSoma(r.porConta, 'valorFora'))]);
  var p = r.ponte;
  resumo.push([], ['Ponte Sistema × Banco (período)'],
    ['Total vendas PIX no sistema', reais(p.totalSistema)],
    ['(+) Diferenças de centavos nas vendas conciliadas', reais(p.centavos)],
    ['(+) Pix no banco sem venda no sistema', reais(p.semVenda)],
    ['(−) Vendas não encontradas no extrato', reais(-p.naoEncontradas)],
    ['(=) Total Pix esperado nos extratos', reais(p.esperado)],
    ['Total Pix nos extratos (período)', reais(p.totalExtratos)],
    ['Checagem (deve ser 0)', reais(p.checagem)]);
  if(r.avisos.length){ resumo.push([], ['Avisos']); r.avisos.forEach(function(a){ resumo.push([a]); }); }

  var detalhe = [['ID Venda', 'Loja', 'Loja no relatório (PDF)', 'Página PDF', 'Registro', 'Sit', 'Documento', 'Data', 'Hora', 'Cx/Tu', 'Vendedor', 'Valor sistema (R$)', 'Conta do Pix', 'Extrato (arquivo)', 'Linha(s) no extrato', 'Pagador (descrição do extrato)', 'Valor banco (R$)', 'Diferença Banco − Sistema (R$)', 'Status', 'Observação']];
  r.vendas.forEach(function(v){
    detalhe.push([v.id, storeName(v.loja), v.lojaPdf, v.pagina, v.registro, v.sit, v.documento, formatDateBR(v.data), v.hora || '', v.caixaTurno, v.vendedor, reais(v.centavos),
      v.contaRecebida || '', v.pix.length ? v.pix[0].arquivo : '', linhasPix(v), v.pix.map(function(x){ return x.pagador; }).join(' | '), reais(v.banco), reais(v.diferenca), v.status, v.observacao]);
  });
  detalhe.push(['TOTAL', '', '', '', '', '', '', '', '', '', '', reais(pixSoma(r.vendas)), '', '', '', '', reais(pixSoma(r.vendas, 'banco')), reais(pixSoma(r.vendas, 'diferenca')), '', '']);

  var semVenda = [['ID Extrato', 'Conta', 'Extrato (arquivo)', 'Linha no extrato', 'Data', 'Pagador (descrição do extrato)', 'Valor banco (R$)', 'Situação']];
  r.semVenda.forEach(function(x){ semVenda.push([x.id, x.conta + ' (' + pixNomeConta(x.conta) + ')', x.arquivo, x.linha, formatDateBR(x.data), x.pagador, reais(x.centavos), x.situacao]); });

  var extratos = [['ID Extrato', 'Arquivo do extrato', 'Conta', 'Linha no arquivo', 'Data', 'Descrição (RECEBIMENTO PIX)', 'Valor (R$)', 'ID Venda conciliada', 'Situação']];
  r.pix.forEach(function(x){ extratos.push([x.id, x.arquivo, x.conta, x.linha, x.data ? formatDateBR(x.data) : '', x.pagador, reais(x.centavos), x.venda ? x.venda.id : '', x.situacao]); });
  extratos.push(['TOTAL', '', '', '', '', '', reais(pixSoma(r.pix)), '', '']);

  var sistema = [['ID Venda', 'Loja', 'Loja no relatório (PDF)', 'Página PDF', 'Registro', 'Sit', 'Documento', 'Data', 'Hora', 'Cx/Tu', 'Vendedor', 'Valor (R$)']];
  r.vendas.forEach(function(v){ sistema.push([v.id, storeName(v.loja), v.lojaPdf, v.pagina, v.registro, v.sit, v.documento, formatDateBR(v.data), v.hora || '', v.caixaTurno, v.vendedor, reais(v.centavos)]); });
  sistema.push(['TOTAL', '', '', '', '', '', '', '', '', '', '', reais(pixSoma(r.vendas))]);

  return [
    { nome: 'Conciliação PIX', linhas: resumo, colunas: [34, 30, 28, 20, 14, 18, 16, 60, 16, 18, 14, 18, 14, 18] },
    { nome: 'Venda a venda', linhas: detalhe, colunas: [9, 8, 18, 8, 10, 6, 10, 11, 7, 7, 9, 12, 10, 18, 12, 36, 12, 14, 40, 70] },
    { nome: 'Pix sem venda', linhas: semVenda, colunas: [10, 26, 20, 10, 11, 40, 14, 22] },
    { nome: 'Extratos PIX', linhas: extratos, colunas: [10, 20, 10, 10, 11, 40, 12, 12, 22] },
    { nome: 'Vendas Sistema PIX', linhas: sistema, colunas: [9, 8, 18, 8, 10, 6, 10, 11, 7, 7, 9, 12] }
  ];
}

/* =========================================================================
   UI — DROPZONE / SLOTS
   ========================================================================= */
var dropzone = document.getElementById('dropzone');
var fileInput = document.getElementById('fileInput');
document.getElementById('btnAddDetails').addEventListener('click', function(){ fileInput.click(); });

function invalidateResults(){
  state.processedOnce = false;
  state.cardAudit = null;
  state.multi = null;
  state.storeKey = null;
  state.pix = null;
  document.getElementById('view-pix').hidden = true;
  document.getElementById('btnExportLabel').textContent = 'Exportar divergências (.xlsx)';
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
          if((type === 'cielo' || type === 'lancamentos') && relacaoPixEnviada()){
            showToast('A Relação de Vendas enviada é de PIX (Carteira Digital). Cielo e Lançamentos são da conciliação de cartão: use uma conciliação por vez.', true);
          } else if((type === 'cielo' || type === 'lancamentos') && state.files.sicredi.length > 0){
            showToast('Use somente um comparativo por vez: Cielo ou Extrato PIX.', true);
          } else if(type === 'caixa' && !(await aceitarRelacao(file))){
            // O motivo da recusa já foi mostrado.
          } else {
            if(type === 'cielo') warnRepeatedCieloStore(file, cieloStoresFromLines(await extractPdfLines(file)));
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
          else if(state.files.caixa.length > 0 && !relacaoPixEnviada()) showToast('A Relação de Vendas enviada é de cartão magnético. Para o PIX, envie a Relação emitida com Forma Pagto. CARTEIRA DIGITAL.', true);
          else if(await aceitarExtratoPix(file)) assignFile('sicredi', file);
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

// Lojas de um PDF da Cielo, pelo estabelecimento impresso em cada venda.
var cieloFileStores = new WeakMap();
function cieloStoresFromLines(lines){
  return uniqueSorted(lines.map(function(l){ return (l.match(/\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}\s+(\d{6,})\b/) || [])[1]; }))
    .map(function(e){ var loja = storeByEstablishment(e); return loja ? storeName(loja) : 'Estab. ' + e; })
    .sort(function(a, b){ return a.localeCompare(b, 'pt-BR', { numeric: true }); });
}
function warnRepeatedCieloStore(file, names){
  cieloFileStores.set(file, names);
  if(state.files.cielo.some(function(f){ return f.name === file.name && f.size === file.size && f.lastModified === file.lastModified; })) return;
  var existing = [].concat.apply([], state.files.cielo.filter(function(f){ return f !== file; }).map(function(f){ return cieloFileStores.get(f) || []; }));
  var repeated = names.filter(function(n){ return existing.includes(n); });
  if(repeated.length) showToast('Já existe um extrato Cielo da ' + repeated.join(', ') + '. Se for do mesmo dia, as vendas vão contar em dobro.', true);
}
function updateCieloSlotStatus(){
  var names = uniqueSorted([].concat.apply([], state.files.cielo.map(function(f){ return cieloFileStores.get(f) || []; })))
    .sort(function(a, b){ return a.localeCompare(b, 'pt-BR', { numeric: true }); });
  if(names.length) document.getElementById('slot-cielo').querySelector('.fs-status').textContent = 'Pronto · ' + names.join(', ').replace(/, ([^,]*)$/, ' e $1');
  return names;
}

function assignFile(slot, file){
  if(state.files[slot].some(function(f){ return f.name === file.name && f.size === file.size && f.lastModified === file.lastModified; })){
    showToast('Este arquivo já foi adicionado.', true); return;
  }
  invalidateResults();
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
  if(slot === 'cielo') updateCieloSlotStatus();
  if(slot === 'sicredi') updatePixSlotStatus();
  if(slot === 'caixa' && relacaoPixEnviada()) el.querySelector('.fs-status').textContent = 'Pronto · PIX (Carteira Digital)';
  el.querySelector('.fs-icon').textContent = file.name.split('.').pop().toUpperCase();
  el.querySelector('.fs-remove').style.display = 'inline-flex';
}

function clearSlot(slot){
  invalidateResults();
  state.files[slot] = [];
  var el = document.getElementById('slot-' + slot);
  el.classList.remove('filled', 'partial');
  el.classList.add('empty');
  el.querySelector('.fs-name').textContent = 'Nenhum arquivo';
  el.querySelector('.fs-status').textContent = 'Aguardando envio';
  el.querySelector('.fs-remove').style.display = 'none';
  updateProcessButtonState();
}

document.querySelectorAll('.fs-remove').forEach(function(btn){
  btn.addEventListener('click', function(e){
    e.stopPropagation();
    clearSlot(btn.dataset.slot);
  });
});

function updateProcessButtonState(){
  // Extrato Sicredi ou Relação de CARTEIRA DIGITAL: conciliação PIX.
  var modoPix = state.files.sicredi.length > 0 || relacaoPixEnviada();
  document.querySelector('.detail-upload').hidden = modoPix;
  if(modoPix){ updatePixProcessState(); return; }
  var hasCaixa = state.files.caixa.length > 0;
  var hasComparativo = state.files.sicredi.length > 0 || state.files.cielo.length > 0;
  var ready = hasCaixa && hasComparativo;
  document.getElementById('btnProcess').disabled = !ready;
  var hint = document.getElementById('processHint');
  if(!hasCaixa && !hasComparativo){
    hint.textContent = 'Envie o relatório de Caixa e um relatório Cielo ou extrato PIX.';
  } else if(!hasCaixa){
    hint.textContent = 'Falta o relatório "Relação de Vendas por Período" do Caixa.';
  } else if(!hasComparativo){
    hint.textContent = 'Envie o "Detalhado de vendas Cielo" ou a planilha de extrato PIX.';
  } else {
    var lojasCielo = state.files.cielo.length ? updateCieloSlotStatus().filter(function(n){ return /^Loja /.test(n); }) : [];
    var lojasTexto = lojasCielo.length > 1 ? ' das lojas ' + lojasCielo.map(function(n){ return n.replace(/^Loja /, ''); }).join(', ').replace(/, ([^,]*)$/, ' e $1') : '';
    hint.textContent = state.files.lancamentos.length ? 'Conferência detalhada' + lojasTexto + ' pronta: valores, bandeiras, débito/crédito e parcelas.' : 'Conciliação de valores' + lojasTexto + ' pronta. O relatório de lançamentos é opcional.';
  }
  document.getElementById('btnAddDetails').hidden = state.files.lancamentos.length > 0;
  document.querySelector('.detail-upload').classList.toggle('is-ready', state.files.lancamentos.length > 0);
  document.getElementById('slot-sicredi').hidden = state.files.cielo.length > 0;
  document.getElementById('slot-cielo').hidden = state.files.sicredi.length > 0;
  document.querySelector('.file-slots').classList.toggle('has-comparative', hasComparativo);
}

/* =========================================================================
   PIX — arquivos, processamento e resultado
   A Relação de CARTEIRA DIGITAL e os extratos Sicredi usam as mesmas vagas do
   Caixa e do extrato. Cada extrato é reconhecido pela conta do cabeçalho.
   ========================================================================= */
var relacaoPixArquivos = new WeakMap();
var extratosPixCache = new WeakMap();
function mesmoArquivo(a, b){ return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified; }
function relacaoPixEnviada(){ return state.files.caixa.some(function(f){ return relacaoPixArquivos.get(f) === true; }); }
function extratosPixEnviados(){ return state.files.sicredi.map(function(f){ return extratosPixCache.get(f); }).filter(Boolean); }
function contasPixFaltando(){ var contas = extratosPixEnviados().map(function(e){ return e.conta; }); return PIX_CONTAS.filter(function(c){ return !contas.includes(c.conta); }); }
function listaTexto(itens){ return itens.join(', ').replace(/, ([^,]*)$/, ' e $1'); }

async function aceitarRelacao(file){
  if(state.files.caixa.some(function(f){ return mesmoArquivo(f, file); })) return true; // assignFile avisa a repetição
  var pix = isRelacaoPix(await extractPdfLines(file));
  relacaoPixArquivos.set(file, pix);
  if(pix && (state.files.cielo.length || state.files.lancamentos.length)){ showToast('Esta Relação de Vendas é de PIX (Carteira Digital), mas já há arquivos de cartão (Cielo ou Lançamentos). Use uma conciliação por vez.', true); return false; }
  if(!pix && state.files.sicredi.length){ showToast('Esta Relação de Vendas é de cartão magnético. Com extratos PIX, envie a Relação emitida com Forma Pagto. CARTEIRA DIGITAL.', true); return false; }
  if(state.files.caixa.some(function(f){ return relacaoPixArquivos.get(f) !== pix; })){ showToast('Já existe uma Relação de Vendas de ' + (pix ? 'cartão' : 'PIX') + '. Use uma conciliação por vez: cartão ou PIX.', true); return false; }
  if(pix && state.files.caixa.length){ showToast('A conciliação PIX usa uma Relação de Vendas só, com todas as lojas. Remova a anterior para enviar esta.', true); return false; }
  return true;
}

async function readExtratoPix(file){
  if(extratosPixCache.has(file)) return extratosPixCache.get(file);
  var wb = await readWorkbook(file);
  var ws = wb.Sheets[wb.SheetNames[0]];
  // A linha do Excel aparece no resultado; a matriz começa na primeira linha da planilha.
  var primeiraLinha = ws && ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.r + 1 : 1;
  var matrix = ws ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true }) : [];
  var extrato = parseExtratoPix(matrix, { arquivo: file.name, primeiraLinha: primeiraLinha });
  extratosPixCache.set(file, extrato);
  return extrato;
}

async function aceitarExtratoPix(file){
  if(state.files.sicredi.some(function(f){ return mesmoArquivo(f, file); })) return true; // assignFile avisa a repetição
  var extrato;
  try{ extrato = await readExtratoPix(file); }
  catch(err){ showToast(err.message, true); return false; }
  if(!pixContaCadastrada(extrato.conta)){ showToast('O extrato "' + file.name + '" é da conta ' + extrato.conta + ', que não está no cadastro PIX. Contas cadastradas: ' + pixContasTexto() + '.', true); return false; }
  var repetido = state.files.sicredi.find(function(f){ var e = extratosPixCache.get(f); return e && e.conta === extrato.conta; });
  if(repetido){ showToast('Já existe o extrato da conta ' + extrato.conta + ' (' + pixNomeConta(extrato.conta) + '): "' + repetido.name + '".', true); return false; }
  return true;
}

function updatePixSlotStatus(){
  var el = document.getElementById('slot-sicredi');
  if(!state.files.sicredi.length) return;
  var contas = extratosPixEnviados().map(function(e){ return e.conta; });
  var recebidos = PIX_CONTAS.filter(function(c){ return contas.includes(c.conta); }).map(function(c){ return pixNomeConta(c.conta); });
  var faltando = contasPixFaltando();
  el.querySelector('.fs-status').textContent = faltando.length
    ? recebidos.length + ' de ' + PIX_CONTAS.length + ' · ' + recebidos.join(', ') + ' · falta ' + listaTexto(faltando.map(function(c){ return pixNomeConta(c.conta); }))
    : 'Pronto · ' + recebidos.join(', ');
  el.classList.toggle('partial', faltando.length > 0);
}

function updatePixProcessState(){
  var temRelacao = relacaoPixEnviada(), faltando = contasPixFaltando();
  var ready = temRelacao && state.files.caixa.length === 1 && !faltando.length;
  var falta = [];
  if(!temRelacao) falta.push('a "Relação de Vendas por Período" emitida com CARTEIRA DIGITAL');
  faltando.forEach(function(c){ falta.push('o extrato da ' + pixNomeConta(c.conta) + ' (conta ' + c.conta + ')'); });
  document.getElementById('btnProcess').disabled = !ready;
  document.getElementById('processHint').textContent = ready ? 'Conciliação PIX pronta: Relação de Vendas + extratos das ' + PIX_CONTAS.length + ' contas.' : 'Conciliação PIX: falta ' + listaTexto(falta) + '.';
  document.getElementById('slot-sicredi').hidden = false;
  document.getElementById('slot-cielo').hidden = true;
  document.querySelector('.file-slots').classList.add('has-comparative');
}

async function processarPix(){
  if(!relacaoPixEnviada()) throw new Error('Envie a "Relação de Vendas por Período" emitida com Forma Pagto. CARTEIRA DIGITAL.');
  var faltando = contasPixFaltando();
  if(faltando.length) throw new Error('Falta o extrato da ' + listaTexto(faltando.map(function(c){ return pixNomeConta(c.conta) + ' (conta ' + c.conta + ')'; })) + '.');
  showOverlay('Lendo a Relação de Vendas (PIX)…');
  var relacao = parseRelacaoPix(await extractPdfLines(state.files.caixa[0]));
  showOverlay('Lendo os extratos Sicredi…');
  var extratos = [];
  for(var i = 0; i < state.files.sicredi.length; i++) extratos.push(await readExtratoPix(state.files.sicredi[i]));
  showOverlay('Conciliando os Pix…');
  state.pix = conciliarPix(relacao, extratos);
  state.pixFiltro = 'pending';
  state.pixLoja = 'todas';
  state.pixAba = 'overview';
  document.getElementById('pixSearch').value = '';
  state.processedOnce = true;
  renderPix();
  var r = state.pix, nao = r.naoEncontradas.length;
  if(r.avisos.length) showToast('Conciliação PIX processada com avisos. Confira o quadro vermelho antes de usar o resultado.', true);
  else showToast(nao ? 'Conciliação PIX: ' + pixQtd(nao, 'venda do sistema não foi encontrada', 'vendas do sistema não foram encontradas') + ' no extrato.' : 'Conciliação PIX: todas as vendas do sistema foram encontradas nos extratos.', nao > 0);
}

// Só a venda do sistema sem Pix é pendência (vermelho). Recebido a menos pede conferência
// (âmbar). Pix a mais no extrato, centavos a mais e outra conta são apenas informação.
function pixDiferencaTexto(c){ return c === 0 ? fmtBRL(0) : (c > 0 ? '+ ' : '− ') + fmtBRL(Math.abs(c) / 100); }
function pixStatusHtml(status, aMenos){
  var classe = status === PIX_STATUS.naoEncontrado || status === 'PENDENTE' ? 'bad'
    : aMenos ? 'warn'
    : status === PIX_STATUS.semVenda ? 'bad'
    : status === PIX_STATUS.foraDoPeriodo || status === 'SEM VENDAS PIX' ? 'off' : 'ok';
  return '<span class="pix-status ' + classe + '">' + escapeHtml(status) + '</span>';
}
function pixVendaAMenos(v){ return !!v && v.pix.length > 0 && v.diferenca < 0; }
function pixClasseDiferenca(c, pendente){ return c === 0 ? 'diff-zero' : pendente ? 'diff-neg' : c < 0 ? 'pix-diff-warn' : 'pix-diff-info'; }
function pixContaPendente(c){ return c.composicao.some(function(x){ return x.tipo === 'naoEncontradas'; }); }
function pixComposicaoClasse(x){ return x.tipo === 'naoEncontradas' || x.tipo === 'semVenda' ? 'bad' : x.tipo === 'centavos' && x.valor < 0 ? 'warn' : 'info'; }
// Cor da diferença da conta: vermelho para venda sem Pix ou Pix a mais; âmbar para centavos a menos.
function pixClasseConta(c){
  if(c.diferenca === 0) return 'diff-zero';
  if(c.composicao.some(function(x){ return x.tipo === 'naoEncontradas' || x.tipo === 'semVenda'; })) return 'diff-neg';
  return c.composicao.some(function(x){ return x.tipo === 'centavos' && x.valor < 0; }) ? 'pix-diff-warn' : 'pix-diff-info';
}
function pixQtd(n, singular, plural){ return n + ' ' + (n === 1 ? singular : plural); }

function renderPix(){
  var r = state.pix, p = r.ponte;
  document.getElementById('resultsWrap').classList.add('show');
  document.getElementById('storeSwitch').hidden = true;
  document.getElementById('view-stores').hidden = true;
  document.getElementById('storeDetail').hidden = true;
  document.getElementById('view-pix').hidden = false;
  document.getElementById('btnExport').disabled = false;
  document.getElementById('btnExportLabel').textContent = 'Exportar conciliação PIX (.xlsx)';
  document.getElementById('pixRunLabel').textContent = 'Data conciliada ' + pixPeriodoTexto(r.periodo) + ' · processado em ' + new Date().toLocaleString('pt-BR');

  var nao = r.naoEncontradas.length, sem = r.semVenda.length, aMenos = r.aMenos.length;
  var encontradas = r.vendas.length - nao;
  var status = nao
    ? ['bad', 'Pendente', pixQtd(nao, 'venda do sistema sem Pix no extrato', 'vendas do sistema sem Pix no extrato') + ' (' + fmtBRL(p.naoEncontradas / 100) + ')']
    : aMenos ? ['review', 'Conferir centavos', pixQtd(aMenos, 'venda recebida', 'vendas recebidas') + ' com até R$ 0,05 a menos']
    : ['ok', 'Conciliado', 'Todas as vendas PIX do sistema foram encontradas nos extratos'];
  var metrics = [
    ['Vendas PIX · sistema', fmtBRL(p.totalSistema / 100), pixQtd(r.vendas.length, 'venda', 'vendas') + ' em ' + r.porLoja.filter(function(l){ return l.qtdVendas; }).length + ' loja(s)'],
    ['Vendas encontradas nos extratos', encontradas + ' de ' + r.vendas.length, nao ? pixQtd(nao, 'venda sem Pix', 'vendas sem Pix') : 'Nenhuma venda faltando'],
    ['Pix nos extratos · ' + pixPeriodoTexto(r.periodo), fmtBRL(p.totalExtratos / 100), pixQtd(r.pix.length - r.foraDoPeriodo.length, 'Pix', 'Pix') + ' em ' + r.porConta.filter(function(c){ return c.enviado; }).length + ' contas' + (sem ? ' · ' + sem + ' a mais, sem venda' : '') + ' · ' + r.foraDoPeriodo.length + ' de outro dia']
  ];
  document.getElementById('pixMetrics').innerHTML = metrics.map(function(x){ return '<div class="metric-card"><div class="m-label">' + escapeHtml(x[0]) + '</div><div class="m-value">' + x[1] + '</div><div class="m-sub">' + escapeHtml(x[2]) + '</div></div>'; }).join('')
    + '<div class="metric-card status"><div class="m-label">Status geral</div><div class="m-value"><span class="status-badge ' + status[0] + '">' + status[1] + '</span></div><div class="m-sub">' + escapeHtml(status[2]) + '</div></div>';

  var alertEl = document.getElementById('pixAlerts');
  alertEl.hidden = !r.avisos.length;
  alertEl.innerHTML = r.avisos.length ? '<span class="integrity-symbol" aria-hidden="true">!</span><div><strong>Confira antes de usar o resultado</strong><ul>' + r.avisos.map(function(a){ return '<li>' + escapeHtml(a) + '</li>'; }).join('') + '</ul></div>' : '';

  document.getElementById('pixLojasBody').innerHTML = r.porLoja.map(function(l){
    var diffClass = pixClasseDiferenca(l.diferenca, l.qtdNaoEncontradas > 0);
    var nota = l.qtdAMenos ? '<small class="pix-diff-warn">' + pixQtd(l.qtdAMenos, 'venda recebida', 'vendas recebidas') + ' ' + fmtBRL(l.valorAMenos / 100) + ' a menos</small>' : '';
    return '<tr class="' + (l.qtdNaoEncontradas ? 'pix-row-bad' : '') + '"><td><button type="button" class="store-link" data-pix-loja="' + escapeHtml(l.loja) + '">' + escapeHtml(l.nome) + '</button><small>' + escapeHtml(l.nomePdf || storeCodeNote(l.loja) || '') + '</small></td>'
      + '<td class="mono">' + escapeHtml(l.conta) + '<small>conta da ' + escapeHtml(pixNomeConta(l.conta)) + (l.arquivo ? ' · ' + escapeHtml(l.arquivo) : '') + '</small></td>'
      + '<td class="num">' + fmtBRL(l.totalSistema / 100) + '<small>' + pixQtd(l.qtdVendas, 'venda', 'vendas') + '</small></td>'
      + '<td class="num">' + fmtBRL(l.totalBanco / 100) + '<small>' + pixQtd(l.qtdConciliadas, 'conciliada', 'conciliadas') + '</small></td>'
      + '<td class="num ' + diffClass + '">' + pixDiferencaTexto(l.diferenca) + '</td>'
      + '<td class="num">' + (l.qtdNaoEncontradas ? '<span class="diff-neg">' + fmtBRL(l.valorNaoEncontrado / 100) + '</span><small>' + pixQtd(l.qtdNaoEncontradas, 'venda', 'vendas') + '</small>' : '—') + '</td>'
      + '<td>' + pixStatusHtml(l.situacao) + nota + '</td></tr>';
  }).join('');
  document.getElementById('pixLojasFoot').innerHTML = '<tr><td>Total</td><td></td><td class="num">' + fmtBRL(pixSoma(r.porLoja, 'totalSistema') / 100) + '</td><td class="num">' + fmtBRL(pixSoma(r.porLoja, 'totalBanco') / 100) + '</td><td class="num">' + pixDiferencaTexto(pixSoma(r.porLoja, 'diferenca')) + '</td><td class="num">' + (nao ? fmtBRL(pixSoma(r.porLoja, 'valorNaoEncontrado') / 100) : '—') + '</td><td></td></tr>';

  document.getElementById('pixContasBody').innerHTML = r.porConta.map(function(c){
    var pendente = pixContaPendente(c);
    var diffClass = pixClasseConta(c);
    var composicao = c.composicao.length
      ? '<ul class="pix-composicao">' + c.composicao.map(function(x){ return '<li class="' + pixComposicaoClasse(x) + '"><b>' + pixDiferencaTexto(x.valor) + '</b> ' + escapeHtml(x.texto) + '</li>'; }).join('') + '</ul>'
      : '<span class="muted">Sem diferença</span>';
    return '<tr class="' + (pendente ? 'pix-row-bad' : '') + '"><td class="mono"><strong>' + escapeHtml(c.conta) + '</strong><small>' + escapeHtml(c.arquivo || 'extrato não enviado') + '</small></td>'
      + '<td>' + escapeHtml(c.nome) + '</td>'
      + '<td class="num">' + fmtBRL(c.totalPeriodo / 100) + '<small>' + pixQtd(c.qtdPeriodo, 'Pix', 'Pix') + '</small></td>'
      + '<td class="num">' + fmtBRL(c.totalSistema / 100) + '<small>' + pixQtd(c.qtdVendasSistema, 'venda', 'vendas') + '</small></td>'
      + '<td class="num ' + diffClass + '"><strong>' + pixDiferencaTexto(c.diferenca) + '</strong></td>'
      + '<td>' + composicao + '</td>'
      + '<td class="num">' + (c.qtdFora ? fmtBRL(c.valorFora / 100) + '<small>' + pixQtd(c.qtdFora, 'Pix', 'Pix') + ' de outro dia</small>' : '—') + '</td></tr>';
  }).join('');
  document.getElementById('pixContasFoot').innerHTML = '<tr><td>Total</td><td></td><td class="num">' + fmtBRL(pixSoma(r.porConta, 'totalPeriodo') / 100) + '</td><td class="num">' + fmtBRL(pixSoma(r.porConta, 'totalSistema') / 100) + '</td><td class="num">' + pixDiferencaTexto(pixSoma(r.porConta, 'diferenca')) + '</td><td></td><td class="num">' + fmtBRL(pixSoma(r.porConta, 'valorFora') / 100) + '</td></tr>';

  var ponte = [
    ['Total vendas PIX no sistema', fmtBRL(p.totalSistema / 100), ''],
    ['(+) Diferenças de centavos nas vendas conciliadas', pixDiferencaTexto(p.centavos), p.centavos < 0 ? 'pix-diff-warn' : ''],
    ['(+) Pix a mais no extrato (sem venda no sistema)', pixDiferencaTexto(p.semVenda), p.semVenda ? 'diff-neg' : ''],
    ['(−) Vendas não encontradas no extrato', pixDiferencaTexto(-p.naoEncontradas), p.naoEncontradas ? 'diff-neg' : ''],
    ['(=) Total Pix esperado nos extratos', fmtBRL(p.esperado / 100), 'pix-strong'],
    ['Total Pix nos extratos (período)', fmtBRL(p.totalExtratos / 100), 'pix-strong'],
    ['Checagem (deve ser 0)', pixDiferencaTexto(p.checagem), p.checagem ? 'diff-neg' : 'pix-check-ok']
  ];
  document.getElementById('pixPonteBody').innerHTML = ponte.map(function(x){ return '<tr><td>' + escapeHtml(x[0]) + '</td><td class="num ' + x[2] + '">' + x[1] + '</td></tr>'; }).join('');

  renderPixVendas();

  document.getElementById('pixSemVendaCount').textContent = sem ? pixQtd(sem, 'Pix', 'Pix') + ' · ' + fmtBRL(p.semVenda / 100) : 'nenhum';
  document.getElementById('pixSemVendaEmpty').hidden = sem > 0;
  document.getElementById('pixSemVendaWrap').hidden = !sem;
  document.getElementById('pixSemVendaBody').innerHTML = r.semVenda.map(function(x){
    return '<tr class="pix-row-bad"><td class="mono">' + escapeHtml(x.id) + '</td><td class="mono">' + escapeHtml(x.conta) + '<small>conta da ' + escapeHtml(pixNomeConta(x.conta)) + '</small></td><td>' + escapeHtml(x.arquivo) + '<small>linha ' + x.linha + '</small></td><td class="mono">' + formatDateBR(x.data) + '</td><td>' + escapeHtml(x.pagador) + '</td><td class="num diff-neg">' + fmtBRL(x.centavos / 100) + '</td><td>' + pixStatusHtml(x.situacao) + '</td></tr>';
  }).join('');

  document.getElementById('pixForaCount').textContent = r.foraDoPeriodo.length ? pixQtd(r.foraDoPeriodo.length, 'Pix', 'Pix') + ' · ' + fmtBRL(pixSoma(r.foraDoPeriodo) / 100) : 'nenhum';
  document.getElementById('pixForaBody').innerHTML = r.foraDoPeriodo.map(function(x){
    return '<tr><td class="mono">' + escapeHtml(x.id) + '</td><td class="mono">' + escapeHtml(x.conta) + '<small>conta da ' + escapeHtml(pixNomeConta(x.conta)) + '</small></td><td>' + escapeHtml(x.arquivo) + '<small>linha ' + x.linha + '</small></td><td class="mono">' + (x.data ? formatDateBR(x.data) : '—') + '</td><td>' + escapeHtml(x.pagador) + '</td><td class="num">' + fmtBRL(x.centavos / 100) + '</td></tr>';
  }).join('');

  mostrarPixLoja(state.pixLoja, true);
}

/* ---------- PIX por loja: botões das lojas, visão geral e vendas lidas lado a lado ---------- */
function renderPixStoreSwitch(){
  var r = state.pix;
  var botoes = [{ key: 'todas', label: 'Todas as lojas', lado: null }].concat(r.porLoja.map(function(l){ return { key: l.loja, label: l.nome, lado: pixLadoALado(r, l.loja) }; }));
  document.getElementById('pixStoreSwitch').innerHTML = botoes.map(function(b){
    var active = state.pixLoja === b.key, contador = '';
    if(b.lado){
      if(b.lado.pendentes) contador = '<span class="bad" title="' + pixQtd(b.lado.pendentes, 'venda sem Pix no extrato', 'vendas sem Pix no extrato') + '">' + b.lado.pendentes + '</span>';
      else if(b.lado.atencao) contador = '<span title="' + pixQtd(b.lado.atencao, 'venda recebida', 'vendas recebidas') + ' com centavos a menos">' + b.lado.atencao + '</span>';
      else contador = '<span class="ok" title="Todas as vendas conciliadas">✓</span>';
    }
    return '<button type="button" data-pix-loja="' + escapeHtml(b.key) + '" class="' + (active ? 'active' : '') + '" aria-pressed="' + active + '">' + escapeHtml(b.label) + contador + '</button>';
  }).join('');
}

function mostrarPixLoja(key, manterAba){
  if(!state.pix) return;
  if(key !== 'todas' && !state.pix.porLoja.some(function(l){ return l.loja === key; })) key = 'todas';
  state.pixLoja = key;
  renderPixStoreSwitch();
  var todas = key === 'todas';
  document.getElementById('pixTodas').hidden = !todas;
  document.getElementById('pixLoja').hidden = todas;
  if(todas) return;
  renderPixLoja(key);
  selecionarPixAba(manterAba ? state.pixAba : 'overview');
}

function selecionarPixAba(aba){
  state.pixAba = aba;
  document.querySelectorAll('[data-pix-tab]').forEach(function(button){
    var active = button.dataset.pixTab === aba;
    button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    document.getElementById('pixLoja-' + button.dataset.pixTab).hidden = !active;
  });
}

function renderPixLoja(loja){
  var r = state.pix, l = r.porLoja.find(function(x){ return x.loja === loja; }), lado = pixLadoALado(r, loja);
  var conta = r.porConta.find(function(c){ return c.conta === lado.conta; });
  document.getElementById('pixLojaTitulo').textContent = l.nome + ' · PIX';
  document.getElementById('pixLojaSub').textContent = (l.nomePdf ? l.nomePdf + ' no PDF · ' : '') + 'recebe na conta ' + lado.conta + (lado.compartilhada ? ' (' + pixNomeConta(lado.conta) + ')' : '');
  document.getElementById('pixLojaH2').textContent = '2. Visão geral · ' + l.nome;
  document.getElementById('pixLojaRunLabel').textContent = 'Data conciliada ' + pixPeriodoTexto(r.periodo);

  var status = !l.qtdVendas ? ['idle', 'Sem vendas PIX', 'A Relação não tem vendas PIX desta loja']
    : l.qtdNaoEncontradas ? ['bad', 'Pendente', pixQtd(l.qtdNaoEncontradas, 'venda sem Pix no extrato', 'vendas sem Pix no extrato')]
    : l.qtdAMenos ? ['review', 'Conferir centavos', pixQtd(l.qtdAMenos, 'venda recebida', 'vendas recebidas') + ' ' + fmtBRL(l.valorAMenos / 100) + ' a menos']
    : ['ok', 'Conciliado', 'Todas as vendas desta loja têm o seu Pix'];
  var metrics = [
    ['Vendas PIX · sistema', fmtBRL(l.totalSistema / 100), pixQtd(l.qtdVendas, 'venda', 'vendas') + ' no PDF'],
    ['Vendas encontradas', l.qtdConciliadas + ' de ' + l.qtdVendas, fmtBRL(l.totalBanco / 100) + ' recebidos em Pix'],
    ['Vendas sem Pix', l.qtdNaoEncontradas ? fmtBRL(l.valorNaoEncontrado / 100) : 'Nenhuma', l.qtdNaoEncontradas ? pixQtd(l.qtdNaoEncontradas, 'venda não encontrada', 'vendas não encontradas') + ' no extrato' : 'Nada faltando no extrato']
  ];
  document.getElementById('pixLojaMetrics').innerHTML = metrics.map(function(x){ return '<div class="metric-card"><div class="m-label">' + escapeHtml(x[0]) + '</div><div class="m-value">' + x[1] + '</div><div class="m-sub">' + escapeHtml(x[2]) + '</div></div>'; }).join('')
    + '<div class="metric-card status"><div class="m-label">Status da loja</div><div class="m-value"><span class="status-badge ' + status[0] + '">' + status[1] + '</span></div><div class="m-sub">' + escapeHtml(status[2]) + '</div></div>';

  document.getElementById('pixLojaContaSub').textContent = lado.compartilhada ? 'Conta dividida: ' + pixNomeConta(lado.conta) : '';
  var diffClass = pixClasseConta(conta);
  var nota = loja === '7' ? '<p class="pix-conta-nota">A ' + escapeHtml(l.nome) + ' não tem conta própria: recebe na conta da Loja 2. Os números abaixo são da conta inteira (' + escapeHtml(conta.nome) + ').</p>'
    : lado.compartilhada ? '<p class="pix-conta-nota">Esta conta também recebe os Pix da ' + escapeHtml(conta.nome.split(' + ').filter(function(n){ return n !== l.nome; }).join(' + ')) + '. Os números abaixo são da conta inteira.</p>' : '';
  document.getElementById('pixLojaConta').innerHTML = nota
    + '<div class="pix-conta-grid">'
    + '<div><span>Conta</span><strong class="mono">' + escapeHtml(conta.conta) + '</strong><small>' + escapeHtml(conta.arquivo || 'extrato não enviado') + '</small></div>'
    + '<div><span>Pix no extrato (dia)</span><strong>' + fmtBRL(conta.totalPeriodo / 100) + '</strong><small>' + pixQtd(conta.qtdPeriodo, 'Pix', 'Pix') + '</small></div>'
    + '<div><span>Vendas de ' + escapeHtml(conta.nome) + '</span><strong>' + fmtBRL(conta.totalSistema / 100) + '</strong><small>' + pixQtd(conta.qtdVendasSistema, 'venda', 'vendas') + '</small></div>'
    + '<div><span>Diferença Banco − Sistema</span><strong class="' + diffClass + '">' + pixDiferencaTexto(conta.diferenca) + '</strong><small>' + (conta.qtdFora ? pixQtd(conta.qtdFora, 'Pix', 'Pix') + ' de outro dia fora da conta' : 'nenhum Pix de outro dia') + '</small></div>'
    + '</div>'
    + (conta.composicao.length ? '<ul class="pix-composicao pix-conta-composicao">' + conta.composicao.map(function(x){ return '<li class="' + pixComposicaoClasse(x) + '"><b>' + pixDiferencaTexto(x.valor) + '</b> ' + escapeHtml(x.texto) + '</li>'; }).join('') + '</ul>' : '<p class="pix-conta-nota">Sem diferença nesta conta.</p>');

  var conferir = lado.linhas.map(function(linha, i){ return { linha: linha, i: i }; }).filter(function(x){ return x.linha.pendente || x.linha.atencao; });
  var centavos = lado.linhas.filter(function(x){ return x.venda && !x.outraLoja && x.pix.length && x.venda.diferenca > 0; }).length;
  document.getElementById('pixLojaObs').hidden = !centavos;
  document.getElementById('pixLojaObs').textContent = centavos ? pixQtd(centavos, 'venda foi recebida', 'vendas foram recebidas') + ' com centavos a mais (troquinho). Não precisa de ação; detalhes em "Vendas lidas".' : '';
  renderPixLojaBlocos(lado, l);
  document.getElementById('pixLojaConferirCount').textContent = conferir.length ? pixQtd(conferir.length, 'item', 'itens') : '';
  document.getElementById('pixLojaConferirEmpty').hidden = conferir.length > 0;
  document.getElementById('pixLojaConferir').hidden = !conferir.length;
  document.getElementById('pixLojaConferir').innerHTML = conferir.map(function(x){
    var linha = x.linha, v = linha.venda;
    var titulo = v.id + ' · ' + (linha.outraLoja ? 'venda da ' + storeName(v.loja) + ' · ' : '') + 'Reg. ' + v.registro + ' · ' + (v.hora || '') + ' · ' + fmtBRL(v.centavos / 100);
    return '<li class="' + (linha.pendente ? 'bad' : 'warn') + '"><div><strong>' + escapeHtml(titulo) + '</strong>' + pixStatusHtml(linha.situacao, linha.atencao) + '<p>' + escapeHtml(v.observacao) + '</p></div><button type="button" class="store-link" data-pix-ver="' + x.i + '">Ver nas vendas lidas</button></li>';
  }).join('');

  var problemas = lado.pendentes + lado.atencao, tabCount = document.getElementById('pixSourceTabCount');
  tabCount.hidden = !problemas; tabCount.textContent = problemas;
  renderPixLadoALado(lado, l);
}

function renderPixLojaBlocos(lado, l){
  function verLink(i){ return '<button type="button" class="store-link" data-pix-ver="' + i + '">Ver nas vendas lidas</button>'; }
  function extrato(p){ return p.arquivo + ' · conta ' + p.conta + ' · linha '; }
  var numero = 5;

  // Pix que caíram no extrato de outra loja (vendas desta loja) ou vendas de outra loja pagas neste extrato.
  var outra = lado.linhas.map(function(linha, i){ return { linha: linha, i: i }; }).filter(function(x){ return x.linha.outraConta || x.linha.outraLoja; });
  document.getElementById('pixLojaOutraWrap').hidden = !outra.length;
  if(outra.length) document.getElementById('pixLojaOutraTitulo').textContent = (numero++) + '. Pix em extrato de outra loja';
  document.getElementById('pixLojaOutraCount').textContent = outra.length ? pixQtd(outra.length, 'venda', 'vendas') : '';
  document.getElementById('pixLojaOutra').innerHTML = outra.map(function(x){
    var v = x.linha.venda, p = v.pix[0], linhas = v.pix.map(function(y){ return y.linha; }).join(' + ');
    var titulo = v.id + ' · ' + (x.linha.outraLoja ? 'venda da ' + storeName(v.loja) + ' · ' : '') + 'Reg. ' + v.registro + ' · ' + (v.hora || '') + ' · ' + fmtBRL(v.centavos / 100) + (v.delivery ? ' · delivery' : '');
    var texto = x.linha.outraConta
      ? 'O Pix desta venda caiu no extrato da ' + pixNomeConta(p.conta) + ': ' + extrato(p) + linhas + '. Pagador: ' + v.pix.map(function(y){ return y.pagador; }).join(' | ') + '.'
      : 'A venda é da ' + storeName(v.loja) + ', mas o Pix caiu neste extrato (' + extrato(p) + linhas + '). Pagador: ' + v.pix.map(function(y){ return y.pagador; }).join(' | ') + '.';
    var etiqueta = x.linha.outraConta ? 'Extrato da ' + pixNomeConta(p.conta) : 'Venda da ' + storeName(v.loja);
    return '<li class="info"><div><strong>' + escapeHtml(titulo) + '</strong><span class="pix-status ok">' + escapeHtml(etiqueta) + '</span><p>' + escapeHtml(texto) + '</p></div>' + verLink(x.i) + '</li>';
  }).join('');

  // Pix a mais no extrato da conta: destaque em vermelho, sem mudar o status da loja.
  var extras = lado.linhas.map(function(linha, i){ return { linha: linha, i: i }; }).filter(function(x){ return x.linha.extra; });
  document.getElementById('pixLojaExtraWrap').hidden = !extras.length;
  if(extras.length) document.getElementById('pixLojaExtraTitulo').textContent = (numero++) + '. Pix a mais no extrato (sem venda no sistema)';
  document.getElementById('pixLojaExtraCount').textContent = extras.length ? pixQtd(extras.length, 'Pix', 'Pix') + ' · ' + fmtBRL(pixSoma(extras.map(function(x){ return x.linha.pix[0]; })) / 100) : '';
  document.getElementById('pixLojaExtraNota').textContent = 'Não muda o status da loja: as vendas do sistema estão conciliadas. Fica em destaque para você conferir a origem desse valor.'
    + (lado.compartilhada ? ' A conta é dividida (' + pixNomeConta(lado.conta) + '): estes Pix aparecem nas abas das duas lojas.' : '');
  document.getElementById('pixLojaExtra').innerHTML = extras.map(function(x){
    var p = x.linha.pix[0];
    return '<li class="bad"><div><strong>' + escapeHtml(p.id + ' · ' + fmtBRL(p.centavos / 100) + ' · ' + formatDateBR(p.data)) + '</strong>' + pixStatusHtml(p.situacao) + '<p>' + escapeHtml('Extrato da ' + pixNomeConta(p.conta) + ': ' + extrato(p) + p.linha + '. Pagador: ' + p.pagador + '.') + '</p></div>' + verLink(x.i) + '</li>';
  }).join('');
}

function renderPixLadoALado(lado, l){
  var countA = 0, countB = 0, temProblema = false;
  document.getElementById('pixSourceNote').textContent = 'Vendas da ' + l.nome + ' no PDF (lado A) e os Pix do extrato que pagaram cada uma (lado B). '
    + 'Entram também os Pix sem venda da conta ' + lado.conta + ' e os Pix desta conta que pagaram vendas de outras lojas (delivery), na altura em que aparecem no extrato. '
    + (lado.compartilhada ? 'A conta é dividida (' + pixNomeConta(lado.conta) + '): os Pix sem venda dela aparecem nas abas das duas lojas. ' : '')
    + 'Pix de outro dia ficam em "Todas as lojas".';
  document.getElementById('pixSourceCount').textContent = pixQtd(lado.vendas, 'venda', 'vendas') + ' · ' + pixQtd(lado.pix, 'Pix', 'Pix');
  document.getElementById('pixSourceBody').innerHTML = lado.linhas.map(function(linha, i){
    var v = linha.venda, pix = linha.pix, a, b;
    if(linha.pendente || linha.atencao || linha.extra) temProblema = true;
    if(!v) a = '<td colspan="6" class="missing-side">— sem venda no sistema (Pix a mais no extrato) —</td>';
    else {
      var tagA = linha.outraLoja ? '<span class="store-tag">Venda da ' + escapeHtml(storeName(v.loja)) + '</span>' : linha.outraConta ? '<span class="store-tag">Pix no extrato da ' + escapeHtml(pixNomeConta(v.contaRecebida)) + '</span>' : '';
      a = '<td class="num pix-idx">' + (++countA) + '</td><td><strong>' + escapeHtml(v.id) + '</strong>' + tagA + '<small>Reg. ' + escapeHtml(v.registro) + ' · Doc. ' + escapeHtml(v.documento) + '</small></td>'
        + '<td class="mono">' + escapeHtml(v.hora || '—') + '</td><td>' + escapeHtml(v.sit) + (v.delivery ? '<small>delivery</small>' : '') + '</td>'
        + '<td class="num">' + fmtBRL(v.centavos / 100) + '</td><td class="raw" title="' + escapeHtml(v.raw) + '">' + escapeHtml(v.raw) + '</td>';
    }
    if(!pix.length) b = '<td colspan="6" class="missing-side side-divider">— nenhum Pix encontrado no extrato —</td>';
    else {
      var inicio = countB + 1; countB += pix.length;
      var tagB = linha.outraConta ? '<span class="store-tag">extrato da ' + escapeHtml(pixNomeConta(pix[0].conta)) + '</span>' : linha.compartilhada ? '<span class="store-tag">conta da ' + escapeHtml(pixNomeConta(pix[0].conta)) + '</span>' : '';
      var valorB = pix.length > 1 ? pix.map(function(p){ return pixReais(p.centavos); }).join(' + ') + '<small>= ' + fmtBRL(pixSoma(pix) / 100) + '</small>' : fmtBRL(pix[0].centavos / 100);
      var diff = v && v.diferenca ? '<small>diferença ' + pixDiferencaTexto(v.diferenca) + '</small>' : '';
      b = '<td class="num side-divider pix-idx">' + (pix.length > 1 ? inicio + '–' + countB : inicio) + '</td><td><strong>' + escapeHtml(pix.map(function(p){ return p.id; }).join(' + ')) + '</strong></td>'
        + '<td class="mono">' + escapeHtml(pix[0].conta) + tagB + '<small>' + escapeHtml(pix[0].arquivo) + ' · linha ' + pix.map(function(p){ return p.linha; }).join(' + ') + '</small></td>'
        + '<td class="raw" title="' + escapeHtml(pix.map(function(p){ return p.descricao; }).join(' | ')) + '">' + escapeHtml(pix.map(function(p){ return p.pagador; }).join(' | ')) + '</td>'
        + '<td class="num">' + valorB + '</td><td>' + pixStatusHtml(linha.situacao, linha.atencao) + diff + '</td>';
    }
    var classe = linha.pendente || linha.extra ? 'has-divergence pix-row-bad' : linha.atencao ? 'has-divergence pix-row-warn' : '';
    return '<tr data-linha="' + i + '" class="' + classe + '">' + a + b + '</tr>';
  }).join('');
  document.getElementById('btnPixPrev').hidden = !temProblema;
  document.getElementById('btnPixNext').hidden = !temProblema;
  pixNavIdx = -1;
}

var pixNavIdx = -1;
function pixIrPara(tr){
  if(!tr) return;
  var container = document.getElementById('pixSourceScroll');
  container.scrollTo({ top: tr.offsetTop - 82 - 4, behavior: 'smooth' });
  tr.classList.add('pix-flash');
  setTimeout(function(){ tr.classList.remove('pix-flash'); }, 1500);
}
function pixNavegar(direcao){
  var rows = document.querySelectorAll('#pixSourceBody tr.has-divergence');
  if(!rows.length) return;
  pixNavIdx = (pixNavIdx + (direcao === 'next' ? 1 : -1) + rows.length) % rows.length;
  pixIrPara(rows[pixNavIdx]);
}

document.getElementById('pixStoreSwitch').addEventListener('click', function(e){
  var button = e.target.closest('[data-pix-loja]');
  if(button) mostrarPixLoja(button.dataset.pixLoja, true);
});
document.getElementById('pixLojasBody').addEventListener('click', function(e){
  var link = e.target.closest('[data-pix-loja]');
  if(link){ mostrarPixLoja(link.dataset.pixLoja, false); document.getElementById('pixStoreSwitch').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});
document.getElementById('pixLoja-overview').addEventListener('click', function(e){
  var ver = e.target.closest('[data-pix-ver]');
  if(!ver) return;
  selecionarPixAba('source');
  var tr = document.querySelector('#pixSourceBody tr[data-linha="' + ver.dataset.pixVer + '"]');
  requestAnimationFrame(function(){ pixIrPara(tr); });
});
document.querySelectorAll('[data-pix-tab]').forEach(function(button){
  button.addEventListener('click', function(){ selecionarPixAba(button.dataset.pixTab); });
  button.addEventListener('keydown', function(event){
    if(!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    var tabs = Array.from(document.querySelectorAll('[data-pix-tab]'));
    var index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(button) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selecionarPixAba(tabs[index].dataset.pixTab); tabs[index].focus();
  });
});
document.getElementById('btnPixNext').addEventListener('click', function(){ pixNavegar('next'); });
document.getElementById('btnPixPrev').addEventListener('click', function(){ pixNavegar('prev'); });

function renderPixVendas(){
  if(!state.pix) return;
  var query = normalizeText(document.getElementById('pixSearch').value);
  var vendas = state.pix.vendas.filter(function(v){
    if(state.pixFiltro === 'pending' && v.status !== PIX_STATUS.naoEncontrado && !pixVendaAMenos(v)) return false;
    if(!query) return true;
    return normalizeText([v.id, storeName(v.loja), v.registro, v.documento, v.sit, pixReais(v.centavos), v.status, v.observacao, v.contaRecebida].concat(v.pix.map(function(p){ return p.pagador + ' ' + p.linha; })).join(' ')).includes(query);
  });
  document.querySelectorAll('[data-pix-filter]').forEach(function(b){ var active = b.dataset.pixFilter === state.pixFiltro; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
  document.getElementById('pixVendasCount').textContent = vendas.length + ' de ' + state.pix.vendas.length + ' vendas';
  document.getElementById('pixVendasEmpty').hidden = vendas.length > 0;
  document.getElementById('pixVendasBody').innerHTML = vendas.map(function(v){
    var bad = v.status === PIX_STATUS.naoEncontrado, warn = pixVendaAMenos(v);
    var outra = v.pix.length && v.contaRecebida !== v.conta ? '<span class="store-tag">extrato da ' + escapeHtml(pixNomeConta(v.contaRecebida)) + '</span>' : '';
    var banco = v.pix.length
      ? '<span class="mono">' + escapeHtml(v.contaRecebida) + '</span>' + outra + '<small>' + escapeHtml(v.pix[0].arquivo) + ' · linha ' + v.pix.map(function(p){ return p.linha; }).join(' + ') + '</small><small>' + escapeHtml(v.pix.map(function(p){ return p.pagador; }).join(' | ')) + '</small>'
      : '<span class="diff-neg">Não encontrado</span><small>conta ' + escapeHtml(v.conta) + (v.delivery && v.conta !== PIX_CONTA_DELIVERY ? ' e ' + PIX_CONTA_DELIVERY + ' (delivery)' : '') + '</small>';
    return '<tr class="' + (bad ? 'pix-row-bad' : warn ? 'pix-row-warn' : '') + '">'
      + '<td><strong>' + escapeHtml(v.id) + '</strong><small>' + escapeHtml(storeName(v.loja)) + ' · Reg. ' + escapeHtml(v.registro) + '</small></td>'
      + '<td class="mono">' + formatDateBR(v.data) + ' · ' + escapeHtml(v.hora || '—') + '<small>' + escapeHtml(v.sit) + (v.delivery ? ' (delivery)' : '') + ' · Doc. ' + escapeHtml(v.documento) + ' · Cx/Tu ' + escapeHtml(v.caixaTurno) + ' · Vend. ' + escapeHtml(v.vendedor) + ' · Pág. ' + v.pagina + '</small></td>'
      + '<td class="num">' + fmtBRL(v.centavos / 100) + '</td>'
      + '<td>' + banco + '</td>'
      + '<td class="num">' + (v.pix.length ? fmtBRL(v.banco / 100) : '—') + '</td>'
      + '<td class="num ' + pixClasseDiferenca(v.diferenca, bad) + '">' + pixDiferencaTexto(v.diferenca) + '</td>'
      + '<td>' + pixStatusHtml(v.status, warn) + (v.observacao ? '<small class="pix-obs">' + escapeHtml(v.observacao) + '</small>' : '') + '</td></tr>';
  }).join('');
}
document.querySelectorAll('[data-pix-filter]').forEach(function(b){ b.addEventListener('click', function(){ state.pixFiltro = b.dataset.pixFilter; renderPixVendas(); }); });
document.getElementById('pixSearch').addEventListener('input', renderPixVendas);

function exportarPix(){
  var wb = XLSX.utils.book_new();
  planilhasPix(state.pix).forEach(function(aba){
    var ws = XLSX.utils.aoa_to_sheet(aba.linhas);
    ws['!cols'] = aba.colunas.map(function(w){ return { wch: w }; });
    XLSX.utils.book_append_sheet(wb, ws, aba.nome);
  });
  XLSX.writeFile(wb, 'conciliacao_pix_' + state.pix.periodo.inicio + '.xlsx');
  showToast('Conciliação PIX exportada.');
}

/* =========================================================================
   PROCESSAMENTO PRINCIPAL
   ========================================================================= */
document.getElementById('btnProcess').addEventListener('click', async function(){
  showOverlay('Lendo arquivos…');
  try{
    var caixaTx = [], sicrediTx = [], cieloTx = [], launchTx = [];
    invalidateResults();
    if(state.files.sicredi.length > 0 || relacaoPixEnviada()){ await processarPix(); return; }

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
    if(state.files.lancamentos.length){
      if(!cieloTx.length) throw new Error('A conferência de cartões precisa do relatório Cielo.');
      showOverlay('Consolidando parcelas e conferindo os lançamentos…');
      for(var li = 0; li < state.files.lancamentos.length; li++) launchTx = launchTx.concat(parseCardLaunchLines(await extractPdfLines(state.files.lancamentos[li])));
    }

    showOverlay('Cruzando transações…');
    state.cardFilter = 'pending';
    document.getElementById('cardSearch').value = '';
    if(cieloTx.length){
      // Uma ou várias lojas: cada Cielo é ligada à loja pelo estabelecimento.
      state.multi = reconcileStores(caixaTx, cieloTx, launchTx);
      state.processedOnce = true;
      showStoreView(state.multi.views.length > 1 ? 'todas' : state.multi.views[0].loja);
    } else {
      state.multi = null;
      state.parsed = { caixa: caixaTx, sicredi: sicrediTx, cielo: cieloTx, lancamentos: launchTx };
      var result = reconcile(caixaTx, sicrediTx, cieloTx);
      state.divergences = result.divergences;
      state.summary = result.summary;
      state.pairs = result.pairs;
      state.cardAudit = null;
      state.processedOnce = true;
      showStoreView(null);
    }

    var blockedStores = state.multi ? state.multi.views.filter(function(v){ return v.cardAudit && v.cardAudit.blocked; }) : [];
    if(blockedStores.length) showToast('Valores conferidos, mas os Lançamentos de Cartão não são das mesmas vendas' + (state.multi.views.length > 1 ? ' (' + blockedStores.map(function(v){ return v.nome; }).join(', ') + ')' : '') + '. Veja a aba Detalhes dos cartões.', true);
    else showToast(state.multi && state.multi.views.length > 1 ? 'Conciliação de ' + state.multi.views.length + ' lojas processada.' : 'Conciliação processada com sucesso.');
  } catch(err){
    console.error(err);
    showToast('Erro ao processar: ' + err.message, true);
  } finally {
    hideOverlay();
  }
});

/* =========================================================================
   LOJAS — seletor, visão de todas as lojas e troca da loja exibida
   ========================================================================= */
function viewPendingCount(view){
  if(view.cardAudit && view.cardAudit.blocked) return view.divergences.length + 1;
  if(view.cardAudit) return view.cardAudit.rows.filter(function(r){ return r.issues.length; }).length;
  return view.divergences.length;
}
function pairsTotal(list){ return sumValues(list.map(function(p){ return p.banco; })); }
function posOrigins(list){
  return uniqueSorted(list.map(function(p){ return p.caixa.loja; })).sort(storeOrder).map(function(l){ return storeName(l) + ': ' + list.filter(function(p){ return p.caixa.loja === l; }).length; }).join(' · ');
}
function deliveryGapText(sale, bank){
  if(!sale || !bank || !sale.hora || !bank.hora) return '';
  var gap = minutesOf(sale.hora) - minutesOf(bank.hora);
  return gap >= 0 ? gap + ' min antes do caixa' : (-gap) + ' min depois do caixa';
}

function renderStoreSwitch(){
  var el = document.getElementById('storeSwitch'), m = state.multi;
  el.hidden = !m || !m.multi;
  if(el.hidden){ el.innerHTML = ''; return; }
  var buttons = [{ key: 'todas', label: 'Todas as lojas', count: null }].concat(m.views.map(function(v){ return { key: v.loja, label: v.nome, count: viewPendingCount(v) }; }));
  el.innerHTML = buttons.map(function(b){
    var active = state.storeKey === b.key;
    var count = b.count === null ? '' : '<span class="' + (b.count ? '' : 'ok') + '" title="' + (b.count ? b.count + ' pendência(s)' : 'Sem pendências') + '">' + (b.count ? b.count : '✓') + '</span>';
    return '<button type="button" data-store="' + escapeHtml(b.key) + '" class="' + (active ? 'active' : '') + '" aria-pressed="' + active + '">' + escapeHtml(b.label) + count + '</button>';
  }).join('');
}

function showStoreView(key, keepTab){
  state.storeKey = key;
  renderStoreSwitch();
  var overview = key === 'todas';
  document.getElementById('resultsWrap').classList.add('show');
  document.getElementById('view-stores').hidden = !overview;
  document.getElementById('storeDetail').hidden = overview;
  if(overview){ renderStoresOverview(); updateExportButton(); return; }
  if(state.multi){
    var view = state.multi.views.find(function(v){ return v.loja === key; }) || state.multi.views[0];
    state.storeKey = view.loja;
    state.currentView = view;
    state.parsed = { caixa: view.caixa, sicredi: [], cielo: view.cielo, lancamentos: view.lancamentos };
    state.divergences = view.divergences;
    state.summary = view.summary;
    state.pairs = view.pairs;
    state.cardAudit = view.cardAudit;
  } else {
    state.currentView = null;
  }
  renderResults(keepTab);
}

document.getElementById('storeSwitch').addEventListener('click', function(e){
  var button = e.target.closest('[data-store]');
  if(button) showStoreView(button.dataset.store, true);
});
document.getElementById('storesBody').addEventListener('click', function(e){
  var link = e.target.closest('[data-store]');
  if(link){ showStoreView(link.dataset.store, false); document.getElementById('storeSwitch').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});

function renderStoresOverview(){
  var m = state.multi, views = m.views;
  document.getElementById('storesRunLabel').textContent = 'Processado em ' + new Date().toLocaleString('pt-BR');
  var relCents = 0, poolCents = 0, foraCents = 0, recCents = 0, diffCents = 0, salesCount = 0;
  var rows = views.map(function(v){
    var rel = sumValues(v.caixa), pool = sumValues(v.cielo), fora = pairsTotal(v.posFora), rec = pairsTotal(v.posRecebidas);
    relCents += cents(rel); poolCents += cents(pool); foraCents += cents(fora); recCents += cents(rec); diffCents += cents(v.diferencaFinal); salesCount += v.caixa.length;
    // Qualquer diferença depois de separar as vendas POS pede conferência.
    var diffClass = cents(v.diferencaFinal) === 0 ? 'diff-zero' : 'diff-neg';
    var cardPending = v.cardAudit && !v.cardAudit.blocked ? v.cardAudit.rows.filter(function(r){ return r.issues.length; }).length : 0;
    var status = v.divergences.length
      ? '<span class="status-badge bad sm">' + v.divergences.length + ' divergência(s) de valor</span>'
      : '<span class="status-badge ok sm">Valores conciliados</span>';
    if(v.cardAudit && v.cardAudit.blocked) status += '<small>Lançamentos de outro dia ou loja</small>';
    else if(cardPending) status += '<small>' + cardPending + ' venda(s) para revisar nos cartões</small>';
    if(v.semVendas) status += '<small>A Relação não tem vendas desta loja</small>';
    return '<tr><td><button type="button" class="store-link" data-store="' + escapeHtml(v.loja) + '">' + escapeHtml(v.nome) + '</button>' + (storeCodeNote(v.loja) ? '<small>' + escapeHtml(storeCodeNote(v.loja)) + '</small>' : '') + '</td>'
      + '<td class="num">' + fmtBRL(rel) + '<small>' + v.caixa.length + ' vendas</small></td>'
      + '<td class="num">' + fmtBRL(pool) + '<small>' + v.cielo.length + ' vendas</small></td>'
      + '<td class="num">' + (v.posFora.length ? '+ ' + fmtBRL(fora) + '<small>' + v.posFora.length + ' venda(s) desta loja</small>' : '—') + '</td>'
      + '<td class="num">' + (v.posRecebidas.length ? '− ' + fmtBRL(rec) + '<small>' + escapeHtml(posOrigins(v.posRecebidas)) + '</small>' : '—') + '</td>'
      + '<td class="num ' + diffClass + '">' + (v.diferencaFinal > 0 ? '+' : '') + fmtBRL(v.diferencaFinal) + '</td>'
      + '<td>' + status + '</td></tr>';
  });
  m.semCielo.forEach(function(s){
    var fora = pairsTotal(s.posFora);
    rows.push('<tr class="is-off"><td><strong>' + escapeHtml(s.nome) + '</strong><small>' + escapeHtml(s.motivo) + '</small></td>'
      + '<td class="num">' + fmtBRL(s.total) + '<small>' + s.vendas + ' vendas</small></td><td class="num">—</td>'
      + '<td class="num">' + (s.posFora.length ? '+ ' + fmtBRL(fora) + '<small>' + s.posFora.length + ' venda(s) desta loja</small>' : '—') + '</td>'
      + '<td class="num">—</td><td class="num">—</td><td><span class="muted">Não conciliada</span></td></tr>');
  });
  document.getElementById('storesBody').innerHTML = rows.join('');
  document.getElementById('storesFoot').innerHTML = views.length > 1 ? '<tr><td>Lojas conciliadas (' + views.length + ')</td><td class="num">' + fmtBRL(relCents / 100) + '</td><td class="num">' + fmtBRL(poolCents / 100) + '</td><td class="num">' + (foraCents ? '+ ' + fmtBRL(foraCents / 100) : '—') + '</td><td class="num">' + (recCents ? '− ' + fmtBRL(recCents / 100) : '—') + '</td><td class="num ' + (diffCents === 0 ? 'diff-zero' : 'diff-neg') + '">' + (diffCents > 0 ? '+' : '') + fmtBRL(diffCents / 100) + '</td><td></td></tr>' : '';

  var divTotal = views.reduce(function(n, v){ return n + v.divergences.length; }, 0);
  var cardTotal = views.reduce(function(n, v){ return n + (v.cardAudit && !v.cardAudit.blocked ? v.cardAudit.rows.filter(function(r){ return r.issues.length; }).length : 0); }, 0);
  var blocked = views.filter(function(v){ return v.cardAudit && v.cardAudit.blocked; }).length;
  var status = divTotal ? ['bad', 'Divergente', divTotal + ' divergência(s) de valor'] : (cardTotal || blocked) ? ['review', 'Conferir cartões', cardTotal + ' venda(s) com pendências nos detalhes'] : ['ok', 'Tudo conciliado', 'Valores e cartões conferidos'];
  var posTotal = sumValues(m.posEntreLojas.map(function(p){ return p.banco; }));
  var metrics = [
    ['Relação · lojas conciliadas', fmtBRL(relCents / 100), salesCount + ' vendas em ' + views.length + ' loja(s)'],
    ['Cielo · ' + views.length + ' extrato(s)', fmtBRL(sumValues(m.cielo)), m.cielo.length + ' vendas aprovadas'],
    ['POS na Cielo da ' + storeName(POS_STORE), fmtBRL(posTotal), m.posEntreLojas.length + ' pagamento(s) de outras lojas']
  ];
  document.getElementById('storesMetrics').innerHTML = metrics.map(function(x){ return '<div class="metric-card"><div class="m-label">' + escapeHtml(x[0]) + '</div><div class="m-value">' + x[1] + '</div><div class="m-sub">' + escapeHtml(x[2]) + '</div></div>'; }).join('')
    + '<div class="metric-card status"><div class="m-label">Status geral</div><div class="m-value"><span class="status-badge ' + status[0] + '">' + status[1] + '</span></div><div class="m-sub">' + escapeHtml(status[2]) + '</div></div>';

  var posStoreSent = m.cieloStores.includes(POS_STORE);
  document.getElementById('posCount').textContent = m.posEntreLojas.length ? m.posEntreLojas.length + ' pagamento(s) · ' + fmtBRL(posTotal) : '';
  document.getElementById('posEmpty').hidden = m.posEntreLojas.length > 0;
  document.getElementById('posEmptyNote').textContent = posStoreSent ? 'As vendas POS das outras lojas foram encontradas na Cielo da própria loja ou não houve vendas POS.' : 'A Cielo da ' + storeName(POS_STORE) + ' não foi enviada; as vendas POS das outras lojas ficam como pendência na loja de origem.';
  document.getElementById('posBody').innerHTML = m.posEntreLojas.map(function(p){
    var issues = (p.valorDivergente ? ['Valor divergente'] : []).concat(p.diferencas);
    var launch = p.launch;
    return '<tr class="' + (issues.length ? 'audit-pending' : '') + '"><td><strong>' + escapeHtml(storeName(p.caixa.loja)) + '</strong><small>Registro ' + escapeHtml(p.caixa.registro || '—') + '</small></td>'
      + '<td class="mono">' + formatDateBR(p.caixa.data) + ' · ' + escapeHtml(p.caixa.hora || '—') + responsibilityMeta(p.caixa) + '</td>'
      + '<td>Cielo da ' + escapeHtml(storeName(p.banco.loja)) + '<small>' + escapeHtml(p.banco.hora || '—') + ' · ' + escapeHtml(deliveryGapText(p.caixa, p.banco)) + '</small></td>'
      + '<td class="num">' + fmtBRL(p.caixa.valor) + (p.valorDivergente ? '<small>Cielo ' + fmtBRL(p.banco.valor) + '</small>' : '') + '</td>'
      + '<td>' + (launch ? escapeHtml(launch.descricao.replace(/^\d+\s*-\s*/, '')) + '<small>' + (launch.parcelas || '—') + 'x · ' + escapeHtml(MODAL_LABEL[launch.modalidade] || 'Não identificado') + '</small>' : '<span class="muted">Sem lançamento</span>') + '</td>'
      + '<td>' + escapeHtml(p.banco.bandeira || 'Não identificada') + '<small>' + escapeHtml(MODAL_LABEL[p.banco.modalidade] || 'Não identificado') + ' · ' + (p.banco.parcelas || '—') + 'x</small></td>'
      + '<td>' + (issues.length ? issues.map(function(i){ return '<span class="audit-issue">' + escapeHtml(i) + '</span>'; }).join('') : '<span class="audit-success">✓ Conferido</span>') + '</td></tr>';
  }).join('');
}

function updateExportButton(){
  var count = state.multi && state.multi.multi ? state.multi.views.reduce(function(n, v){ return n + v.divergences.length; }, 0) : state.divergences.length;
  document.getElementById('btnExport').disabled = count === 0;
}

/* =========================================================================
   RENDER
   ========================================================================= */
function renderResults(keepTab){
  document.getElementById('resultsWrap').classList.add('show');

  var caixa = state.parsed.caixa, sicredi = state.parsed.sicredi, cielo = state.parsed.cielo;
  var view = state.currentView, storePrefix = view && state.multi && state.multi.multi ? view.nome + ' · ' : '';
  document.getElementById('mSicredi').closest('.metric-card').hidden = cielo.length > 0;
  document.getElementById('mCielo').closest('.metric-card').hidden = !cielo.length && !view;
  document.getElementById('analysisMode').textContent = storePrefix + (state.cardAudit ? 'Conferência detalhada · 3 relatórios' : 'Conciliação de valores');
  document.getElementById('analysisScope').textContent = state.cardAudit ? 'Valores + dados dos cartões' : 'Bandeira e modalidade internas não verificadas';
  if(!cielo.length) document.getElementById('analysisScope').textContent = 'Recebimentos PIX';
  document.getElementById('tab-cards').hidden = !state.cardAudit;
  var activeTab = document.querySelector('.tool-conciliacao [data-view].active');
  selectResultView(keepTab && activeTab && !activeTab.hidden ? activeTab.dataset.view : 'overview');
  document.getElementById('mCaixa').textContent = fmtBRL(caixa.reduce(function(s,t){ return s+t.valor; },0));
  document.getElementById('mCaixaSub').textContent = caixa.length + ' lançamentos';
  document.getElementById('mSicredi').textContent = fmtBRL(sicredi.reduce(function(s,t){ return s+t.valor; },0));
  document.getElementById('mSicrediSub').textContent = sicredi.length + ' lançamentos';
  document.getElementById('mCielo').textContent = fmtBRL(cielo.reduce(function(s,t){ return s+t.valor; },0));
  document.getElementById('mCieloSub').textContent = cielo.length + ' lançamentos';

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
  if(view && view.posFora.length && state.divergences.length === 0) statusSub.textContent = 'Todas batidas; ' + view.posFora.length + ' venda(s) POS recebida(s) na Cielo da ' + storeName(POS_STORE);
  if(state.cardAudit && state.cardAudit.blocked){
    statusEl.textContent = 'Reenviar lançamentos';
    statusEl.className = 'status-badge review';
    statusSub.textContent = (state.divergences.length ? state.divergences.length + ' divergência(s) de valor. ' : 'Valores conciliados. ') + 'Cartões não conferidos: os Lançamentos são de outro dia ou loja.';
    document.getElementById('analysisScope').textContent = 'Valores conferidos · Lançamentos incompatíveis com a Relação';
    document.getElementById('valueEmptyNote').textContent = 'Os valores batem, mas os Lançamentos enviados não são das mesmas vendas. Veja a aba Detalhes dos cartões.';
    renderCardAudit();
  } else if(state.cardAudit){
    var pending = state.cardAudit.rows.filter(function(r){ return r.issues.length; }).length;
    if(pending){ statusEl.textContent = 'Conferir cartões'; statusEl.className = 'status-badge review'; statusSub.textContent = pending + ' venda(s) com pendências nos detalhes'; }
    document.getElementById('valueEmptyNote').textContent = pending ? 'Os valores batem. Há ' + pending + ' venda(s) para revisar na aba Detalhes dos cartões.' : 'Valores e dados dos cartões conferidos nos relatórios enviados.';
    renderCardAudit();
  } else {
    document.getElementById('valueEmptyNote').textContent = 'Nenhuma divergência de valor encontrada. Adicione os Lançamentos para conferir os dados internos dos cartões.';
  }
  if(view && view.semVendas){
    statusEl.textContent = 'Sem vendas na Relação';
    statusEl.className = 'status-badge review';
    statusSub.textContent = 'A Relação enviada não tem vendas da ' + view.nome + '. A Cielo desta loja serviu para achar as vendas POS das outras lojas.';
  }

  document.getElementById('lastRunLabel').textContent = 'Processado em ' + new Date().toLocaleString('pt-BR');

  // Tabela resumo
  var summaryBody = document.getElementById('summaryBody');
  summaryBody.innerHTML = '';
  state.summary.forEach(function(row){
    var tr = document.createElement('tr');
    if(row.ajuste){
      tr.className = 'summary-adjust';
      tr.innerHTML = '<td>' + escapeHtml(row.modalidade) + '</td><td class="num">—</td><td class="num">' + (row.banco < 0 ? '− ' : '+ ') + fmtBRL(Math.abs(row.banco)) + '</td><td class="num diff-zero">—</td><td class="num">' + row.qtd + '</td>';
    } else if(row.nota){
      tr.className = 'summary-adjust';
      tr.innerHTML = '<td>' + escapeHtml(row.modalidade) + '</td><td class="num">' + fmtBRL(row.caixa) + '</td><td class="num">—</td><td class="num diff-zero">—</td><td class="num">' + row.qtd + '</td>';
    } else if(row.info){
      tr.innerHTML = '<td><strong>' + row.modalidade + '</strong> <span style="font-size:11px;color:var(--gray-400);font-weight:500;">(sem comparação bancária)</span></td><td class="num">' + fmtBRL(row.caixa) + '</td><td class="num">—</td><td class="num diff-zero">—</td><td class="num">' + row.totalCaixaCount + '</td>';
    } else {
      // Banco − Caixa: positivo = sobra no banco (verde); negativo = falta (vermelho).
      var diff = (cents(row.banco) - cents(row.caixa)) / 100;
      var diffClass = Math.abs(diff) < 0.01 ? 'diff-zero' : (diff < 0 ? 'diff-neg' : 'diff-pos');
      tr.innerHTML = '<td><strong>' + row.modalidade + '</strong></td><td class="num">' + fmtBRL(row.caixa) + '</td><td class="num">' + fmtBRL(row.banco) + '</td><td class="num ' + diffClass + '">' + (diff > 0 ? '+' : '') + fmtBRL(diff) + '</td><td class="num">' + row.batidos + '/' + row.totalCaixaCount + '</td>';
      if(row.total) tr.className = 'summary-total';
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
      tr.innerHTML = '<td>' + badgeFor(d.tipo) + '</td><td>' + (MODAL_LABEL[d.modalidade] || d.modalidade) + '</td><td class="mono">' + (d.data ? formatDateBR(d.data) : '—') + '</td><td class="mono">' + (d.hora || '—') + '</td><td class="mono">' + (d.documento || '—') + responsibilityMeta(d) + '</td><td class="num">' + (d.valorCaixa !== null && d.valorCaixa !== undefined ? fmtBRL(d.valorCaixa) : '—') + '</td><td class="num">' + (d.valorBanco !== null && d.valorBanco !== undefined ? fmtBRL(d.valorBanco) : '—') + '</td><td>' + (d.origemBanco || '—') + '</td>';
      divBody.appendChild(tr);
    });
  }

  updateExportButton();

  // Source compare
  var comparativo = cielo.length ? cielo : sicredi;
  var comparativoNome = cielo.length ? 'Cielo' + (storePrefix ? ' · ' + view.nome : '') : 'Extrato PIX';
  document.getElementById('sourceBTitle').textContent = 'B · ' + comparativoNome;
  document.getElementById('sourceBNote').textContent = cielo.length
    ? 'Vendas aprovadas da Cielo. O cruzamento usa data, valor e proximidade de horário; os pares são os mesmos da conciliação. Sem vínculo único, a venda fica sem correspondência.' + (view && (view.posFora.length || view.posRecebidas.length) ? ' Vendas POS aparecem com a etiqueta da outra loja: a Cielo da ' + storeName(POS_STORE) + ' recebe as vendas POS de todas as lojas.' : '')
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
    // Venda POS entre lojas: etiqueta com a loja da venda ou da Cielo.
    var tag = view && t.loja && t.loja !== view.loja ? '<span class="store-tag">' + (divider ? 'Cielo · ' : 'POS · ') + escapeHtml(storeName(t.loja)) + '</span>' : '';
    return '<td class="num' + dividerClass + '" style="color:var(--gray-400);font-size:11px;text-align:center;">' + num + '</td><td class="mono" style="text-align:center;">' + (t.data ? formatDateBR(t.data) : '—') + '</td><td class="mono" style="text-align:center;">' + (t.hora || '—') + '</td><td class="mono" style="text-align:center;">' + escapeHtml(t.documento || '—') + tag + '</td><td class="num">' + fmtBRL(t.valor) + '</td><td class="raw" title="' + escapeHtml(raw) + '">' + escapeHtml(raw) + '</td>';
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

function buildCardGroups(audit, cielo){
  var groups = new Map();
  function add(list, side){ list.forEach(function(item){
    var tx = item.classification || {};
    var key = (tx.bandeira || 'Não identificada') + ' · ' + (MODAL_LABEL[tx.modalidade] || 'Não identificado');
    if(!groups.has(key)) groups.set(key, { categoria: key, sistema: 0, cielo: 0, qtdSistema: 0, qtdCielo: 0 });
    var g = groups.get(key); g[side] += cents(item.valor); g[side === 'sistema' ? 'qtdSistema' : 'qtdCielo']++;
  }); }
  add(audit.rows.filter(function(r){ return r.sale; }).map(function(r){ return { valor: r.sale.valor, classification: r.launch }; }), 'sistema');
  add(cielo.map(function(tx){ return { valor: tx.valor, classification: tx }; }), 'cielo');
  return Array.from(groups.values()).sort(function(a,b){ return a.categoria.localeCompare(b.categoria); });
}

function buildCardChannelGroups(audit){
  var groups = new Map();
  audit.rows.filter(function(row){ return row.sale; }).forEach(function(row){
    var canal = row.launch && row.launch.canal || 'Não identificado';
    if(!groups.has(canal)) groups.set(canal, { canal: canal, qtd: 0, total: 0 });
    var group = groups.get(canal);
    group.qtd++;
    group.total += cents(row.sale.valor);
  });
  return Array.from(groups.values()).sort(function(a,b){ return a.canal.localeCompare(b.canal); });
}

// Vendas Cielo desta loja: as ligadas às vendas dela (inclusive POS na Cielo da
// Loja 5) e as sem correspondência; as POS de outras lojas ficam de fora.
// Com uma loja só, são todas as vendas da Cielo enviada.
function cardBanks(){ return state.cardAudit.rows.filter(function(r){ return r.bank; }).map(function(r){ return r.bank; }); }
function cardGroups(){ return buildCardGroups(state.cardAudit, cardBanks()); }

function coverageAlertHtml(message){
  var facts = message.facts.map(function(f){
    return '<div' + (f.off ? ' class="is-off"' : '') + '><dt>' + escapeHtml(f.label) + '</dt><dd><b>' + escapeHtml(f.datas) + '</b>' + (f.local ? '<span>' + escapeHtml(f.local) + '</span>' : '') + '<span>' + escapeHtml(f.vendas) + ' · ' + escapeHtml(f.total) + '</span>' + (f.bandeiras ? '<span class="coverage-brands">' + escapeHtml(f.bandeiras) + '</span>' : '') + '</dd></div>';
  }).join('');
  return '<span class="integrity-symbol" aria-hidden="true">!</span><div><strong>' + escapeHtml(message.title) + '</strong><p>' + escapeHtml(message.detail) + '</p><dl class="coverage-compare">' + facts + '</dl><p class="coverage-action"><b>Como resolver:</b> ' + escapeHtml(message.action) + '</p></div>';
}

function renderCardAudit(){
  var audit = state.cardAudit, rows = audit.rows;
  var blocked = !!audit.blocked, alertEl = document.getElementById('cardCoverageAlert');
  alertEl.hidden = !blocked;
  document.getElementById('cardAuditContent').hidden = blocked;
  document.getElementById('btnExportDetails').disabled = blocked;
  if(blocked){
    document.getElementById('cardTabCount').textContent = '!';
    alertEl.innerHTML = coverageAlertHtml(launchCoverageMessage(audit.coverage));
    return;
  }
  var pending = rows.filter(function(r){ return r.issues.length; });
  document.getElementById('cardTabCount').textContent = pending.length;
  var metrics = [
    ['Vendas conferidas', rows.filter(function(r){ return !r.issues.length; }).length, state.parsed.caixa.length + ' vendas na Relação', 'good'],
    ['Bandeira divergente', rows.filter(function(r){ return r.brand; }).length, 'Sistema diferente da Cielo', 'warn'],
    ['Débito / crédito', rows.filter(function(r){ return r.mode; }).length, 'Modalidade divergente', 'warn'],
    ['Outras pendências', rows.filter(function(r){ return r.issues.length && !r.brand && !r.mode; }).length, 'Parcelas, valores ou vínculo', 'neutral']
  ];
  document.getElementById('cardMetrics').innerHTML = metrics.map(function(m){ return '<div class="detail-metric ' + m[3] + '"><span>' + m[0] + '</span><strong>' + m[1] + '</strong><small>' + m[2] + '</small></div>'; }).join('');
  var integrityOK = audit.internalCount === state.parsed.caixa.length && audit.groups.length === state.parsed.caixa.length && !rows.some(function(r){ return r.issues.some(function(i){ return /internas|interno|registro|Relação|cadastro|faixa|repetida|dois cartões/.test(i); }); });
  var outside = audit.coverage && audit.coverage.foraDoPeriodo.length ? ' Lançamentos com data fora da Relação: ' + formatDateList(audit.coverage.foraDoPeriodo) + '.' : '';
  var view = state.currentView, posNote = '';
  if(view && view.posFora.length) posNote += ' ' + view.posFora.length + ' venda(s) POS desta loja foram conferidas na Cielo da ' + storeName(POS_STORE) + ' (' + fmtBRL(pairsTotal(view.posFora)) + ').';
  if(view && view.posRecebidas.length) posNote += ' A Cielo desta loja tem ' + view.posRecebidas.length + ' venda(s) POS de outras lojas (' + posOrigins(view.posRecebidas) + '), conferidas na aba de cada loja.';
  var banner = document.getElementById('cardIntegrity');
  banner.className = 'integrity-banner ' + (integrityOK ? 'good' : 'warn');
  banner.innerHTML = '<span class="integrity-symbol">' + (integrityOK ? '✓' : '!') + '</span><div><strong>' + (integrityOK ? 'Relatórios internos vinculados' : 'Confira a cobertura dos relatórios internos') + '</strong><p>' + audit.lineCount + ' linhas de parcelas → ' + audit.groups.length + ' vendas classificadas. ' + audit.internalCount + ' de ' + state.parsed.caixa.length + ' registros vinculados à Relação. Total da Relação: ' + fmtBRL(sumValues(state.parsed.caixa)) + '.' + escapeHtml(outside + posNote) + '</p></div>';
  document.getElementById('cardGroupBody').innerHTML = cardGroups().map(function(g){ return '<tr><td>' + escapeHtml(g.categoria) + '</td><td class="num">' + g.qtdSistema + '</td><td class="num">' + fmtBRL(g.sistema / 100) + '</td><td class="num">' + g.qtdCielo + '</td><td class="num">' + fmtBRL(g.cielo / 100) + '</td><td class="num ' + (g.sistema === g.cielo ? 'diff-zero' : 'diff-neg') + '">' + fmtBRL((g.sistema - g.cielo) / 100) + '</td></tr>'; }).join('');
  var banks = cardBanks();
  var grossSystem = sumValues(state.parsed.caixa), grossBank = sumValues(banks), netBank = sumValues(banks, 'valorLiquido');
  var bankHasNet = banks.every(function(t){ return Number.isFinite(t.valorLiquido); });
  document.getElementById('cardNetSummary').innerHTML = '<div><span>Bruto · Relação</span><strong>' + fmtBRL(grossSystem) + '</strong></div><div><span>Bruto · Cielo' + (view && (view.posFora.length || view.posRecebidas.length) ? ' (vendas desta loja)' : '') + '</span><strong>' + fmtBRL(grossBank) + '</strong></div><div><span>Diferença bruta</span><strong>' + fmtBRL((cents(grossSystem) - cents(grossBank)) / 100) + '</strong></div><div><span>Taxas · Cielo</span><strong>' + (bankHasNet ? fmtBRL((cents(grossBank) - cents(netBank)) / 100) : '—') + '</strong></div>' + buildCardChannelGroups(audit).map(function(g){ return '<div><span>Sistema · ' + escapeHtml(g.canal) + ' (' + g.qtd + ' vendas)</span><strong>' + fmtBRL(g.total / 100) + '</strong></div>'; }).join('');
  renderCardRows();
}

function renderCardRows(){
  if(!state.cardAudit || state.cardAudit.blocked) return;
  var query = normalizeText(document.getElementById('cardSearch').value);
  var rows = state.cardAudit.rows.filter(function(r){
    var filterOK = state.cardFilter === 'all' || (state.cardFilter === 'pending' ? r.issues.length > 0 : !!r[state.cardFilter]);
    return filterOK && (!query || normalizeText(JSON.stringify([r.sale, r.launch && Object.assign({}, r.launch, { linhas: undefined }), r.bank, r.issues])).includes(query));
  });
  document.querySelectorAll('[data-card-filter]').forEach(function(button){ var active = button.dataset.cardFilter === state.cardFilter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  function cardCell(tx, row){
    if(!tx) return '<span class="muted">Não identificado</span>';
    var otherStore = tx.origem === 'Cielo' && row.sale && tx.loja && tx.loja !== row.sale.loja ? '<span class="store-tag">Cielo da ' + escapeHtml(storeName(tx.loja)) + '</span>' : '';
    return brandLabel(tx.bandeira, row.brand) + paymentLabel(tx, row) + '<small>' + (tx.codigoCartao ? 'Cód. ' + escapeHtml(tx.codigoCartao) + ' · ' : '') + (tx.hora ? 'Hora Cielo ' + escapeHtml(tx.hora) : 'NSU ' + escapeHtml(tx.nsu || 'não informado')) + otherStore + '</small>';
  }
  function linkText(r){
    if(r.confidence === 'horario') return 'Data e horário próximo (até 2 minutos); confira os valores acima.';
    if(r.confidence === 'entrega') return 'Venda POS: a Cielo' + (r.bank && r.sale && r.bank.loja && r.bank.loja !== r.sale.loja ? ' da ' + storeName(r.bank.loja) : '') + ' registrou ' + deliveryGapText(r.sale, r.bank) + ' (tempo da entrega).';
    return 'Revisão necessária.';
  }
  function issueCell(issue, row){
    if(issue === 'Parcelas fora da faixa do cartão cadastrado'){
      var warning = cardRangeWarning(row);
      if(warning) return '<div class="audit-card-range"><strong>' + escapeHtml(warning.title) + '</strong><p>' + escapeHtml(warning.detail) + '</p></div>';
    }
    return '<span class="audit-issue">' + escapeHtml(issue) + '</span>';
  }
  document.getElementById('cardAuditBody').innerHTML = rows.map(function(r){
    var tx = r.sale || r.launch || r.bank;
    return '<tr class="' + (r.issues.length ? 'audit-pending' : '') + '"><td><strong>' + (tx.data ? formatDateBR(tx.data) : '—') + (r.sale && r.sale.hora ? ' · ' + escapeHtml(r.sale.hora) : '') + '</strong><small>Registro ' + escapeHtml((r.sale || r.launch || {}).registro || '—') + '</small>' + (r.issues.length ? responsibilityMeta(r.sale) : '') + '</td><td class="num">' + fmtBRL(tx.valor) + (r.bank && cents(r.bank.valor) !== cents(tx.valor) ? '<small>Cielo ' + fmtBRL(r.bank.valor) + '</small>' : '') + '</td><td>' + cardCell(r.launch, r) + '</td><td>' + cardCell(r.bank, r) + '</td><td>' + (r.issues.length ? r.issues.map(function(issue){ return issueCell(issue, r); }).join('') : '<span class="audit-success">✓ Conferido</span>') + '<details class="audit-evidence"><summary>Ver origem</summary><p>Relação: ' + escapeHtml(r.sale && r.sale.raw || 'Não encontrada') + '</p><p>Lançamentos: ' + escapeHtml(r.launch ? r.launch.linhas.map(function(l){ return l.raw; }).join(' / ') : 'Sem vínculo único') + '</p><p>Cielo: ' + escapeHtml(r.bank && r.bank.raw || 'Sem vínculo seguro') + '</p><p>Vínculo Cielo: ' + escapeHtml(linkText(r)) + '</p></details></td></tr>';
  }).join('');
  document.getElementById('cardVisibleCount').textContent = rows.length + ' de ' + state.cardAudit.rows.length + ' vendas';
  document.getElementById('cardEmpty').hidden = rows.length > 0;
}
document.querySelectorAll('[data-card-filter]').forEach(function(button){ button.addEventListener('click', function(){ state.cardFilter = button.dataset.cardFilter; renderCardRows(); }); });
document.getElementById('cardSearch').addEventListener('input', renderCardRows);

function exportVinculo(confidence){ return confidence === 'horario' ? 'Data e horário próximo' : confidence === 'entrega' ? 'POS: tempo da entrega' : 'Revisar'; }
function withStore(loja, row){ return loja ? Object.assign({ 'Loja': storeName(loja) }, row) : row; }

function cardExportRows(audit, loja){
  return audit.rows.map(function(r){ var tx = r.sale || r.launch || r.bank, rangeWarning = cardRangeWarning(r); var row = {
    'Data': tx.data ? formatDateBR(tx.data) : '', 'Registro': (r.sale || r.launch || {}).registro || '',
    'Cx/Tu': r.sale && r.sale.caixaTurno || '', 'Código vendedor': r.sale && r.sale.codigoVendedor || '',
    'Hora sistema': r.sale && r.sale.hora || '', 'Hora Cielo': r.bank && r.bank.hora || '', 'NSU interno': r.launch && r.launch.nsu || '',
    'Valor Relação': r.sale ? r.sale.valor : '', 'Valor Cielo': r.bank ? r.bank.valor : ''
  };
  if(loja) row['Cielo da loja'] = r.bank && r.bank.loja ? storeName(r.bank.loja) : '';
  return withStore(loja, Object.assign(row, {
    'Código cartão sistema': r.launch && r.launch.codigoCartao || '', 'Canal sistema': r.launch && r.launch.canal || '',
    'Cartão cadastrado': r.launch && r.launch.descricao || '',
    'Bandeira sistema': r.launch && r.launch.bandeira || '', 'Bandeira Cielo': r.bank && r.bank.bandeira || '',
    'Modalidade sistema': r.launch ? MODAL_LABEL[r.launch.modalidade] : '', 'Modalidade Cielo': r.bank ? MODAL_LABEL[r.bank.modalidade] : '',
    'Parcelas sistema': r.launch && r.launch.parcelas || '', 'Parcelas Cielo': r.bank && r.bank.parcelas || '',
    'Líquido Cielo': r.bank ? r.bank.valorLiquido : '',
    'Conferência': r.issues.join('; ') || 'Conferido', 'Aviso do cartão': rangeWarning ? rangeWarning.detail : '', 'Vínculo': exportVinculo(r.confidence),
    'Origem Relação': r.sale && r.sale.raw || '', 'Origem Lançamentos': r.launch ? r.launch.linhas.map(function(l){ return l.raw; }).join(' / ') : '', 'Origem Cielo': r.bank && r.bank.raw || ''
  })); });
}

function posExportRows(){
  return state.multi.posEntreLojas.map(function(p){
    var launch = p.launch;
    return {
      'Loja da venda': storeName(p.caixa.loja), 'Registro': p.caixa.registro || '', 'Data': formatDateBR(p.caixa.data),
      'Hora caixa': p.caixa.hora || '', 'Cx/Tu': p.caixa.caixaTurno || '', 'Código vendedor': p.caixa.codigoVendedor || '',
      'Cielo da loja': storeName(p.banco.loja), 'Hora Cielo': p.banco.hora || '', 'Diferença de horário': deliveryGapText(p.caixa, p.banco),
      'Valor Relação': p.caixa.valor, 'Valor Cielo': p.banco.valor,
      'Cartão no sistema': launch ? launch.descricao : '', 'Parcelas sistema': launch ? launch.parcelas : '',
      'Bandeira Cielo': p.banco.bandeira || '', 'Modalidade Cielo': MODAL_LABEL[p.banco.modalidade] || '', 'Parcelas Cielo': p.banco.parcelas || '',
      'Conferência': (p.valorDivergente ? ['Valor divergente'] : []).concat(p.diferencas).join('; ') || 'Conferido'
    };
  });
}

function storesExportRows(){
  var rows = state.multi.views.map(function(v){
    return { 'Loja': v.nome, 'Código no sistema': v.loja, 'Vendas Relação': v.caixa.length, 'Total Relação': sumValues(v.caixa), 'Vendas Cielo': v.cielo.length, 'Total Cielo da loja': sumValues(v.cielo),
      'POS da loja na Cielo da Loja 5': pairsTotal(v.posFora), 'POS de outras lojas nesta Cielo': pairsTotal(v.posRecebidas), 'Diferença final (Cielo − Relação)': v.diferencaFinal, 'Divergências de valor': v.divergences.length, 'Situação': 'Conciliada' };
  });
  state.multi.semCielo.forEach(function(s){
    rows.push({ 'Loja': s.nome, 'Código no sistema': s.loja, 'Vendas Relação': s.vendas, 'Total Relação': s.total, 'Vendas Cielo': '', 'Total Cielo da loja': '', 'POS da loja na Cielo da Loja 5': pairsTotal(s.posFora), 'POS de outras lojas nesta Cielo': '', 'Diferença final (Cielo − Relação)': '', 'Divergências de valor': '', 'Situação': 'Não conciliada: ' + s.motivo });
  });
  return rows;
}

document.getElementById('btnExportDetails').addEventListener('click', function(){
  if(!state.cardAudit || state.cardAudit.blocked) return;
  var multi = state.multi && state.multi.multi;
  var sources = multi ? state.multi.views.filter(function(v){ return v.cardAudit && !v.cardAudit.blocked; }).map(function(v){ return { audit: v.cardAudit, loja: v.loja }; }) : [{ audit: state.cardAudit, loja: '' }];
  var rows = [].concat.apply([], sources.map(function(s){ return cardExportRows(s.audit, s.loja); }));
  var groups = [].concat.apply([], sources.map(function(s){ return buildCardGroups(s.audit, s.audit.rows.filter(function(r){ return r.bank; }).map(function(r){ return r.bank; })).map(function(g){ return withStore(s.loja, { 'Categoria': g.categoria, 'Vendas sistema': g.qtdSistema, 'Total sistema': g.sistema / 100, 'Vendas Cielo': g.qtdCielo, 'Total Cielo': g.cielo / 100, 'Diferença': (g.sistema - g.cielo) / 100 }); }); }));
  var channels = [].concat.apply([], sources.map(function(s){ return buildCardChannelGroups(s.audit).map(function(g){ return withStore(s.loja, { 'Canal sistema': g.canal, 'Vendas': g.qtd, 'Total bruto': g.total / 100 }); }); }));
  var wb = XLSX.utils.book_new();
  var ws = XLSX.utils.json_to_sheet(rows); ws['!cols'] = Object.keys(rows[0] || {}).map(function(){ return { wch: 24 }; });
  XLSX.utils.book_append_sheet(wb, ws, 'Conferência de cartões');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(groups), 'Totais por categoria');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(channels), 'Totais POS TEF');
  if(multi) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(posExportRows()), 'POS entre lojas');
  XLSX.writeFile(wb, 'conferencia_cartoes_' + new Date().toISOString().slice(0,10) + '.xlsx');
});

function badgeFor(tipo){
  if(tipo === 'ausente_banco') return '<span class="badge b-red"><span class="badge-dot"></span>Ausente no banco</span>';
  if(tipo === 'valor_divergente') return '<span class="badge b-amber"><span class="badge-dot"></span>Valor divergente</span>';
  if(tipo === 'sobra_banco') return '<span class="badge b-blue"><span class="badge-dot"></span>Sobra no banco</span>';
  if(tipo === 'pos_sem_cielo') return '<span class="badge b-gray" title="Venda POS: o pagamento cai na Cielo da ' + storeName(POS_STORE) + ', que não foi enviada"><span class="badge-dot"></span>POS · Cielo da ' + storeName(POS_STORE) + ' não enviada</span>';
  if(tipo === 'nao_identificado') return '<span class="badge b-gray"><span class="badge-dot"></span>Não identificado</span>';
  return tipo;
}

/* =========================================================================
   EXPORTAÇÃO
   ========================================================================= */
function divergenceTypeLabel(tipo){
  if(tipo === 'ausente_banco') return 'Ausente no banco/adquirente';
  if(tipo === 'valor_divergente') return 'Valor divergente';
  if(tipo === 'pos_sem_cielo') return 'Venda POS: Cielo da ' + storeName(POS_STORE) + ' não enviada';
  return 'Sobra no banco/adquirente';
}

document.getElementById('btnExport').addEventListener('click', function(){
  if(state.pix){ exportarPix(); return; }
  var multi = state.multi && state.multi.multi;
  var sources = multi ? state.multi.views.map(function(v){ return { divergences: v.divergences, summary: v.summary, loja: v.loja }; }) : [{ divergences: state.divergences, summary: state.summary, loja: '' }];
  if(!sources.some(function(s){ return s.divergences.length; })){ showToast('Não há divergências para exportar.', true); return; }
  var rows = [].concat.apply([], sources.map(function(s){ return s.divergences.map(function(d){
    return withStore(s.loja, {
      'Tipo': divergenceTypeLabel(d.tipo),
      'Modalidade': MODAL_LABEL[d.modalidade] || d.modalidade,
      'Data': d.data ? formatDateBR(d.data) : '',
      'Hora': d.hora || '',
      'Documento': d.documento || '',
      'Cx/Tu': d.caixaTurno || '',
      'Código vendedor': d.codigoVendedor || '',
      'Valor Caixa (R$)': d.valorCaixa !== null && d.valorCaixa !== undefined ? Number(d.valorCaixa.toFixed(2)) : '',
      'Valor Banco (R$)': d.valorBanco !== null && d.valorBanco !== undefined ? Number(d.valorBanco.toFixed(2)) : '',
      'Origem Banco': d.origemBanco || ''
    });
  }); }));
  var ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = (multi ? [{wch:10}] : []).concat([{wch:26},{wch:12},{wch:12},{wch:8},{wch:14},{wch:9},{wch:16},{wch:16},{wch:16},{wch:14}]);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Divergências');

  var summaryRows = [].concat.apply([], sources.map(function(src){ return src.summary.map(function(s){
    if(s.ajuste) return withStore(src.loja, { 'Modalidade': s.modalidade, 'Total Caixa (R$)': '', 'Total Banco/Adquirente (R$)': Number(s.banco.toFixed(2)), 'Diferença Banco − Caixa (R$)': '', 'Transações batidas': s.qtd });
    if(s.nota) return withStore(src.loja, { 'Modalidade': s.modalidade, 'Total Caixa (R$)': Number(s.caixa.toFixed(2)), 'Total Banco/Adquirente (R$)': '', 'Diferença Banco − Caixa (R$)': '', 'Transações batidas': s.qtd });
    return withStore(src.loja, {
      'Modalidade': s.modalidade,
      'Total Caixa (R$)': Number(s.caixa.toFixed(2)),
      'Total Banco/Adquirente (R$)': Number(s.banco.toFixed(2)),
      'Diferença Banco − Caixa (R$)': Number((s.banco - s.caixa).toFixed(2)),
      'Transações batidas': s.batidos + '/' + s.totalCaixaCount
    });
  }); }));
  var ws2 = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, ws2, 'Resumo');
  if(multi){
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(storesExportRows()), 'Lojas');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(posExportRows()), 'POS entre lojas');
  }

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
      'Caixa - Cx/Tu': left && left.caixaTurno ? left.caixaTurno : '—',
      'Caixa - Código vendedor': left && left.codigoVendedor ? left.codigoVendedor : '—',
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
  state.processedOnce = false;
  state.multi = null;
  state.storeKey = null;
  state.currentView = null;
  document.getElementById('storeSwitch').hidden = true;
  document.getElementById('view-stores').hidden = true;
  document.getElementById('storeDetail').hidden = false;
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
