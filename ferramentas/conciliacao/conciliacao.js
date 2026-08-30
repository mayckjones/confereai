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
  files: { caixa: [], sicredi: [], cielo: [] },
  parsed: { caixa: [], sicredi: [], cielo: [] },
  divergences: [],
  summary: [],
  alignedRows: [],
  processedOnce: false
};

var MODAL_LABEL = { PIX: 'PIX', Debito: 'Débito', Credito: 'Crédito', Dinheiro: 'Dinheiro', Cartao: 'Cartão (não especificado)', Outro: 'Não identificado' };

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
    var text = lines.slice(0, 80).join(' ').toUpperCase();
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
      valor: valor,
      raw: line
    });
    return true;
  }

  var pendente = '';
  lines.forEach(function(originalLine){
    var line = originalLine;
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

  if(colData === -1 || colForma === -1 || colBruto === -1) throw new Error('Colunas obrigatórias não encontradas no extrato Cielo.');

  var out = [];
  for(var i = headerIdx + 1; i < matrix.length; i++){
    var row = matrix[i];
    if(!row || row.every(function(c){ return String(c || '').trim() === ''; })) continue;
    var data = parseDateAny(row[colData]);
    var valorBruto = parseValorBR(row[colBruto]);
    if(!data || isNaN(valorBruto)) continue;
    var modalidade = detectModalidadeFromText(String(row[colForma] || ''));
    out.push({
      origem: 'Cielo', data: data,
      hora: colHora !== -1 ? parseTimeAny(row[colHora]) : null,
      modalidade: modalidade, documento: '', valor: valorBruto,
      valorLiquido: colLiq !== -1 ? parseValorBR(row[colLiq]) : null,
      raw: String(row[colForma] || '')
    });
  }
  return out;
}

function parseCieloPdfLines(lines){
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
    out.push({
      origem: 'Cielo',
      data: parseDateAny(dateM[1]),
      hora: timeMatch ? parseTimeAny(timeMatch[1]) : null,
      modalidade: 'Cartao', documento: '', valor: valor, raw: line
    });
  });
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

function reconcile(caixaTx, sicrediTx, cieloTx){
  var bancoTx = cieloTx.length ? cieloTx : sicrediTx;
  var origem = cieloTx.length ? 'Cielo' : 'Extrato PIX';
  var resultado = matchModalidade(caixaTx, bancoTx);
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

  function sumBy(list){ return list.reduce(function(s,t){ return s + t.valor; }, 0); }

  var summary = [{
    modalidade: 'Caixa × ' + origem,
    caixa: sumBy(caixaTx), banco: sumBy(bancoTx),
    batidos: resultado.matched.length, totalCaixaCount: caixaTx.length
  }];

  return { divergences: divergences, summary: summary };
}

/* =========================================================================
   UI — DROPZONE / SLOTS
   ========================================================================= */
var dropzone = document.getElementById('dropzone');
var fileInput = document.getElementById('fileInput');

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
        if(type === 'caixa' || type === 'cielo'){
          if(type === 'cielo' && state.files.sicredi.length > 0){
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
          if(state.files.cielo.length > 0) showToast('Use somente um comparativo por vez: Cielo ou Extrato PIX.', true);
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
  el.querySelector('.fs-remove').style.display = 'inline-flex';
}

function clearSlot(slot){
  state.files[slot] = [];
  var el = document.getElementById('slot-' + slot);
  el.classList.remove('filled');
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
    hint.textContent = 'Arquivos prontos. A conciliação mostrará somente o que não bate.';
  }
}

/* =========================================================================
   PROCESSAMENTO PRINCIPAL
   ========================================================================= */
document.getElementById('btnProcess').addEventListener('click', async function(){
  showOverlay('Lendo arquivos…');
  try{
    var caixaTx = [], sicrediTx = [], cieloTx = [];

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

    showOverlay('Cruzando transações…');
    state.parsed = { caixa: caixaTx, sicredi: sicrediTx, cielo: cieloTx };
    var result = reconcile(caixaTx, sicrediTx, cieloTx);
    state.divergences = result.divergences;
    state.summary = result.summary;
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
function renderResults(){
  document.getElementById('resultsWrap').classList.add('show');

  var caixa = state.parsed.caixa, sicredi = state.parsed.sicredi, cielo = state.parsed.cielo;
  document.getElementById('mCaixa').textContent = fmtBRL(caixa.reduce(function(s,t){ return s+t.valor; },0));
  document.getElementById('mCaixaSub').textContent = caixa.length + ' lançamentos';
  document.getElementById('mSicredi').textContent = fmtBRL(sicredi.reduce(function(s,t){ return s+t.valor; },0));
  document.getElementById('mSicrediSub').textContent = sicredi.length + ' lançamentos';
  document.getElementById('mCielo').textContent = fmtBRL(cielo.reduce(function(s,t){ return s+t.valor; },0));
  document.getElementById('mCieloSub').textContent = cielo.length + ' lançamentos';

  var statusEl = document.getElementById('mStatus');
  var statusSub = document.getElementById('mStatusSub');
  if(state.divergences.length === 0){
    statusEl.textContent = 'Conciliado';
    statusEl.className = 'status-badge ok';
    statusSub.textContent = 'Todas as transações foram batidas';
  } else {
    statusEl.textContent = 'Divergente';
    statusEl.className = 'status-badge bad';
    statusSub.textContent = state.divergences.length + ' pendência(s) encontrada(s)';
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
      var diff = row.caixa - row.banco;
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
    ? 'Vendas aprovadas extraídas do relatório "Detalhado de vendas Cielo". Valores iguais ficam na mesma linha do Caixa.'
    : 'Somente lançamentos "RECEBIMENTO PIX" extraídos da planilha. Valores iguais ficam na mesma linha do Caixa.';

  function escapeHtml(value){
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function sortTransactions(list){
    return list.slice().sort(function(a,b){ return ((a.data||'')+(a.hora||'')).localeCompare((b.data||'')+(b.hora||'')); });
  }
  function alignTransactions(leftList, rightList){
    var rightRemaining = sortTransactions(rightList);
    var aligned = [];
    sortTransactions(leftList).forEach(function(left){
      var index = rightRemaining.findIndex(function(right){
        return isDateMatch(left, right) && Math.abs(left.valor - right.valor) <= 0.009;
      });
      aligned.push({ left: left, right: index >= 0 ? rightRemaining.splice(index, 1)[0] : null });
    });
    rightRemaining.forEach(function(right){ aligned.push({ left: null, right: right }); });
    return aligned;
  }
  var countA = 0, countB = 0;
  function sourceCells(t, divider){
    var dividerClass = divider ? ' side-divider' : '';
    if(!t) return '<td colspan="6" class="missing-side' + dividerClass + '">— sem lançamento correspondente —</td>';
    var num = divider ? ++countB : ++countA;
    var raw = t.raw || '—';
    return '<td class="num' + dividerClass + '" style="color:var(--gray-400);font-size:11px;text-align:center;">' + num + '</td><td class="mono" style="text-align:center;">' + (t.data ? formatDateBR(t.data) : '—') + '</td><td class="mono" style="text-align:center;">' + (t.hora || '—') + '</td><td class="mono" style="text-align:center;">' + escapeHtml(t.documento || '—') + '</td><td class="num">' + fmtBRL(t.valor) + '</td><td class="raw" title="' + escapeHtml(raw) + '">' + escapeHtml(raw) + '</td>';
  }
  var alignedRows = alignTransactions(caixa, comparativo);
  state.alignedRows = alignedRows;
  document.getElementById('sourceCompareCount').textContent = alignedRows.length + ' linhas';
  var compareBody = document.getElementById('sourceCompareBody');
  compareBody.innerHTML = '';
  var hasDivergences = false;
  alignedRows.forEach(function(row){
    var isDivergent = !row.left || !row.right;
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
      'Status': (!left || !right) ? 'Divergente' : 'Batido'
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
  state.parsed = { caixa: [], sicredi: [], cielo: [] };
  state.divergences = [];
  state.summary = [];
  state.alignedRows = [];
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
