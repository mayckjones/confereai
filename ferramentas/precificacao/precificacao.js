/* =========================================================================
   ConfereAI — Ferramenta: Precificação (etiquetas De/Por)
   Compara as planilhas de Produtos do Infarma (uma por loja) com a base de
   preços do dia anterior, separa o que baixou, subiu ou é novo em cada loja
   e monta as etiquetas prontas para imprimir (A4 ou térmica 80 mm).
   A comparação é feita pelo código interno do produto, que não muda.
   Registrada como window.__tool_init_precificacao — chamada pelo router.
   ========================================================================= */

window.__tool_init_precificacao = function(){

/* =========================================================================
   REGRAS (sem acesso à tela; testadas em tests/precificacao.test.cjs)
   ========================================================================= */
var LOJA_NOMES = { 1: 'LOJA 1 JIE', 2: 'LOJA 2 MEG 1', 3: 'LOJA 3 L E', 6: 'LOJA 6 MEG 5', 7: 'LOJA 7 MEG 4' };
var BASE_COLUNAS = ['loja', 'codigo', 'ean', 'descricao', 'classificacao', 'estoque', 'venda', 'data_ref'];
var TIPOS = { down: ['Baixou', 'p-down'], up: ['Subiu', 'p-up'], new: ['Novo', 'p-new'], eq: ['Igual', 'p-eq'] };

function chave(loja, codigo){ return loja + '|' + codigo; }
function nomeLoja(loja){ return LOJA_NOMES[loja] || ('LOJA ' + loja); }

// Número em qualquer formato que o Infarma ou o Excel entregam: 22.99, 7,49, 1.299,90 ou número.
function brNum(valor){
  if(typeof valor === 'number') return valor;
  var s = String(valor == null ? '' : valor).trim();
  if(/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  if(/^-?[\d.]*\d,\d+$/.test(s)) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  return NaN;
}

function dataHoje(agora){
  var d = agora || new Date();
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}
function dataIso(br){
  var m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(br || '');
  return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
}
function precoCsv(v){ return v == null ? '' : v.toFixed(2).replace('.', ','); }
function semPontoVirgula(s){ return String(s || '').replace(/;/g, ','); }

// Dígito verificador de EAN-8 e EAN-13.
function eanValido(c){
  if(!/^\d{8}$|^\d{13}$/.test(c)) return false;
  var d = c.split('').map(Number), chk = d.pop(), s = 0;
  d.reverse().forEach(function(n, i){ s += n * (i % 2 === 0 ? 3 : 1); });
  return (10 - s % 10) % 10 === chk;
}

// Código que vai para o código de barras: tira o zero extra de EAN de 14 dígitos; ignora código interno preenchido com zeros.
function codigoBarras(ean){
  var e = String(ean || '').trim();
  if(e.length < 6 || /^0{4,}/.test(e)) return '';
  return e.replace(/^0(?=\d{13}$)/, '');
}

// Nome que sai na etiqueta: sem o "*" do início e sem o "( P )" do fim.
function nomeEtiqueta(desc){ return String(desc || '').replace(/^\*+/, '').replace(/\(\s*P\s*\)\s*$/, '').trim(); }

/* ---------- Base (CSV gerado por esta ferramenta) ---------- */
function lerBaseCsv(texto){
  var linhas = String(texto).replace(/^﻿/, '').split(/\r?\n/);
  var cab = linhas[0].split(';').map(function(h){ return h.trim().toLowerCase(); });
  function ix(n){ return cab.indexOf(n); }
  if(ix('ean') < 0 || ix('codigo') < 0 || ix('venda') < 0 || ix('loja') < 0){
    throw new Error('este não é um arquivo de base desta ferramenta (faltam as colunas loja, codigo, ean e venda).');
  }
  var recs = [], data = '';
  for(var i = 1; i < linhas.length; i++){
    if(!linhas[i].trim()) continue;
    var c = linhas[i].split(';'), v = brNum(c[ix('venda')]);
    if(isNaN(v)) continue;
    if(!data && ix('data_ref') >= 0) data = c[ix('data_ref')] || '';
    recs.push({
      loja: Number(c[ix('loja')]), codigo: String(c[ix('codigo')]).trim(), ean: String(c[ix('ean')] || '').trim(),
      descricao: ix('descricao') >= 0 ? c[ix('descricao')] || '' : '',
      classificacao: ix('classificacao') >= 0 ? c[ix('classificacao')] || '' : '',
      estoque: ix('estoque') >= 0 ? parseInt(c[ix('estoque')], 10) || 0 : 0, venda: v
    });
  }
  return { recs: recs, data: data };
}

function paraMapa(recs){ var m = new Map(); recs.forEach(function(r){ m.set(chave(r.loja, r.codigo), r); }); return m; }
function lojasDaBase(mapa){
  var s = new Set(); mapa.forEach(function(r){ s.add(r.loja); });
  return Array.from(s).sort(function(a, b){ return a - b; });
}

function baseParaCsv(mapa, data){
  var linhas = Array.from(mapa.values()).sort(function(a, b){
    return a.loja - b.loja || String(a.codigo).localeCompare(String(b.codigo), undefined, { numeric: true });
  }).map(function(r){
    return [r.loja, r.codigo, r.ean || '', semPontoVirgula(r.descricao), semPontoVirgula(r.classificacao), r.estoque || 0, precoCsv(r.venda), data].join(';');
  });
  return [BASE_COLUNAS.join(';')].concat(linhas).join('\n');
}

/* ---------- Planilha "Produtos" do Infarma (matriz de linhas × colunas) ---------- */
function lerPlanilhaMatriz(linhas){
  var hi = linhas.findIndex(function(r){
    return (r || []).some(function(c){ return String(c).trim() === 'Código'; }) &&
           (r || []).some(function(c){ return /Prc\.?\s*Venda/i.test(String(c)); });
  });
  if(hi < 0) throw new Error('não achei as colunas "Código" e "Prc. Venda". Exporte pela tela Estoque › Produtos › Planilha.');
  var H = linhas[hi].map(function(c){ return String(c).trim(); });
  function col(re){ return H.findIndex(function(h){ return re.test(h); }); }
  var cC = col(/^Código$/), cE = col(/Barras/i), cD = col(/^Descri/i), cK = col(/^Classifica/i), cS = col(/Est\.?\s*Disp/i), cV = col(/Prc\.?\s*Venda/i);
  var recs = [];
  linhas.slice(hi + 1).forEach(function(r){
    r = r || [];
    var codigo = String(r[cC] == null ? '' : r[cC]).trim(), v = brNum(r[cV]);
    if(!codigo || isNaN(v)) return;
    var ean = cE >= 0 ? String(r[cE] == null ? '' : r[cE]).trim() : '';
    if(/e\+/i.test(ean)) ean = Number(r[cE]).toFixed(0);
    recs.push({
      codigo: codigo, ean: ean,
      descricao: cD >= 0 ? String(r[cD] == null ? '' : r[cD]).trim() : '',
      classificacao: cK >= 0 ? String(r[cK] == null ? '' : r[cK]).trim() : '',
      estoque: cS >= 0 ? Math.round(brNum(r[cS]) || 0) : 0,
      venda: Math.round(v * 100) / 100
    });
  });
  return recs;
}

function lojaPeloNome(nome){ var m = /loja\s*0*(\d+)/i.exec(nome || ''); return m ? Number(m[1]) : null; }

// A planilha não diz de qual loja é: compara o estoque com o da base. A loja certa bate em 90%+; as outras, em ~25%.
function detectarLoja(recs, base){
  if(!base) return null;
  var melhor = null;
  lojasDaBase(base).forEach(function(l){
    var n = 0, ok = 0;
    recs.forEach(function(r){ var b = base.get(chave(l, r.codigo)); if(!b) return; n++; if(b.estoque === r.estoque) ok++; });
    var p = n ? ok / n : 0;
    if(!melhor || p > melhor.p) melhor = { loja: l, p: p, n: n };
  });
  return melhor && melhor.p >= 0.6 && melhor.n >= 50 ? melhor : null;
}

// arquivos: [{ nome, loja, recs }]. Devolve as linhas comparadas e os avisos.
function conciliar(arquivos, base){
  var linhas = [], avisos = [], vistas = {};
  arquivos.forEach(function(f){
    if(f.erro || !f.recs || !f.recs.length) return;
    if(!f.loja){ avisos.push('Escolha a loja do arquivo <b>' + f.nome + '</b>. Enquanto isso ele fica de fora.'); return; }
    if(vistas[f.loja]) avisos.push('Dois arquivos foram marcados como <b>' + nomeLoja(f.loja) + '</b>: ' + vistas[f.loja] + ' e ' + f.nome + '. Confira.');
    vistas[f.loja] = f.nome;
    f.recs.forEach(function(n){
      var o = base.get(chave(f.loja, n.codigo)), tipo = 'new';
      if(o){ var d = Math.round((n.venda - o.venda) * 100); tipo = d < 0 ? 'down' : d > 0 ? 'up' : 'eq'; }
      linhas.push(Object.assign({}, n, { loja: f.loja, ean: n.ean || (o && o.ean) || '', de: o ? o.venda : null, por: n.venda, tipo: tipo }));
    });
  });
  var faltam = lojasDaBase(base).filter(function(l){ return !vistas[l]; });
  if(arquivos.length && faltam.length) avisos.push('Sem planilha hoje para: ' + faltam.map(nomeLoja).join(', ') + '.');
  return { linhas: linhas, avisos: avisos };
}

// Base nova: preço e estoque de hoje; produto que sumiu da planilha da loja fica com estoque 0 e o último preço.
function atualizarBase(base, arquivos){
  var m = new Map(base);
  arquivos.forEach(function(f){
    if(f.erro || !f.loja || !f.recs) return;
    var hoje = new Set();
    f.recs.forEach(function(n){
      var k = chave(f.loja, n.codigo), o = m.get(k) || {};
      hoje.add(n.codigo);
      m.set(k, Object.assign({}, o, n, { loja: f.loja, ean: n.ean || o.ean || '' }));
    });
    m.forEach(function(r, k){ if(r.loja === f.loja && !hoje.has(r.codigo) && r.estoque !== 0) m.set(k, Object.assign({}, r, { estoque: 0 })); });
  });
  return m;
}

function filtrar(linhas, f){
  var q = String(f.busca || '').trim().toUpperCase(), min = Number(f.minimo) || 0;
  return linhas.filter(function(r){
    if(f.loja !== 'todas' && f.loja != null && r.loja !== f.loja) return false;
    if(f.tipo === 'down' && r.tipo !== 'down') return false;
    if(f.tipo === 'up' && r.tipo !== 'up') return false;
    if(f.tipo === 'new' && r.tipo !== 'new') return false;
    if(f.tipo === 'changed' && r.tipo === 'eq') return false;
    if(f.classe && r.classificacao !== f.classe) return false;
    if(f.soEstoque && !(r.estoque > 0)) return false;
    if(r.por < min || (r.de != null && r.de < min)) return false;
    if(q && !(r.descricao.toUpperCase().includes(q) || String(r.codigo).includes(q) || String(r.ean || '').includes(q))) return false;
    return true;
  });
}

function contar(linhas){
  var c = { down: 0, up: 0, new: 0, eq: 0 };
  linhas.forEach(function(r){ c[r.tipo]++; });
  return c;
}

/* ======================== INTERFACE ======================== */

var LOGO_URL = 'ferramentas/precificacao/logo_etiqueta.png';
var FONTES_URL = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Inter:wght@500;700&family=JetBrains+Mono:wght@400;600&display=swap';
var JSBARCODE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js';

// Visual das etiquetas: usado na prévia e na janela de impressão.
var LABEL_CSS = [
  '.prec-sheet{--f-display:"Barlow Condensed","Arial Narrow",Arial,sans-serif;--f-body:"Inter",system-ui,Arial,sans-serif;--f-mono:"JetBrains Mono",Consolas,monospace;background:#fff;color:#111;padding:8mm;display:flex;flex-direction:column;gap:6mm}',
  '.prec-sheet *{box-sizing:border-box}',
  '.prec-sheet .grid{display:grid;gap:2mm;justify-content:start}',
  '.prec-sheet .grp-h{margin:0 0 2.5mm;font:800 15pt/1 var(--f-display);text-transform:uppercase;letter-spacing:.03em;color:#111;display:flex;align-items:baseline;gap:4mm;border-bottom:1.5px solid #111;padding-bottom:1.5mm}',
  '.prec-sheet .grp-h span{font:500 8pt/1 var(--f-body);color:#555;text-transform:none;letter-spacing:0}',
  '.prec-sheet .empty{padding:30px;text-align:center;color:#555;font:13px var(--f-body)}',
  '.lbl{-webkit-print-color-adjust:exact;print-color-adjust:exact;width:var(--lw);height:var(--lh);border:1px dashed #9aa;border-radius:2mm;padding:2mm 2.5mm;display:flex;flex-direction:column;overflow:hidden;break-inside:avoid;background:#fff;color:#111}',
  '.lbl .top{display:flex;gap:2mm;align-items:center}',
  '.lbl .logo{flex:none;height:calc(var(--s)*8mm);width:auto;display:block}',
  '.lbl .name{flex:1;min-width:0;font:700 calc(var(--s)*8.5pt)/1.15 var(--f-body);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-transform:uppercase}',
  '.lbl .prices{display:flex;align-items:flex-end;justify-content:space-between;gap:2mm;margin-top:auto}',
  '.lbl .de{font:500 calc(var(--s)*8pt)/1 var(--f-body);color:#444}',
  '.lbl .de s{text-decoration-thickness:1.5px}',
  '.lbl .por{display:flex;align-items:flex-start;gap:.6mm;font-family:var(--f-display);font-weight:800;line-height:.85;color:#111}',
  '.lbl .por .rs{font-size:calc(var(--s)*10pt);margin-top:1mm}',
  '.lbl .por .val{font-size:calc(var(--s)*30pt)}',
  '.lbl .por .cents{font-size:calc(var(--s)*15pt)}',
  '.lbl .tr{display:flex;flex-direction:column;align-items:flex-end;gap:.8mm;align-self:flex-start}',
  '.lbl .tag{background:#c8102e;color:#fff;padding:.6mm 1.6mm;border-radius:1mm;font:700 calc(var(--s)*6.5pt)/1 var(--f-body);text-transform:uppercase;letter-spacing:.04em}',
  '.lbl .off{font:800 calc(var(--s)*13pt)/1 var(--f-display);background:#c8102e;color:#fff;border-radius:1.2mm;padding:.8mm 1.6mm}',
  '.lbl .foot{display:flex;justify-content:space-between;align-items:flex-end;gap:2mm;margin-top:1mm}',
  '.lbl .bcw{display:flex;flex-direction:column;max-width:64%;min-width:0}',
  '.lbl .foot svg{height:calc(var(--s)*9mm);width:auto;max-width:100%}',
  '.lbl .meta{font:400 calc(var(--s)*6pt)/1.2 var(--f-mono);color:#555;text-align:right}',
  '.lbl .meta .cod{font:700 calc(var(--s)*7.5pt)/1 var(--f-mono);color:#000}',
  '.lbl.plain .por .val{font-size:calc(var(--s)*32pt)}',
  '.lbl.plain .prices{margin-top:3.5mm}',
  '.lbl.plain .foot{margin-top:auto}',
  '.prec-sheet.termica{width:calc(80mm + 16mm)}',
  '.prec-sheet.termica .grp-h{font-size:12pt;gap:2mm;flex-wrap:wrap}',
  '.prec-sheet.termica .lbl{border:none;border-bottom:1px dashed #000;border-radius:0}',
  '.prec-sheet.termica .tag,.prec-sheet.termica .off{background:#000}',
  '.prec-sheet.termica .de,.prec-sheet.termica .meta{color:#000}'
].join('\n');

function el(id){ return document.getElementById(id); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function brl(v){ return v == null || isNaN(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function avisar(msg, erro){ if(typeof showToast === 'function') showToast(msg, erro); }

var S = { base: null, baseData: '', arquivos: [], linhas: [], loja: 'todas', fora: new Set(), dataHoje: dataHoje(), classeEscolhida: false };

/* ---------- Recursos externos (fonte da etiqueta e código de barras) ---------- */
var estiloEtiqueta = document.createElement('style');
estiloEtiqueta.id = 'precLabelCss';
estiloEtiqueta.textContent = LABEL_CSS;
document.head.appendChild(estiloEtiqueta);
var linkFontes = document.createElement('link');
linkFontes.rel = 'stylesheet'; linkFontes.href = FONTES_URL; linkFontes.id = 'precFontes';
document.head.appendChild(linkFontes);

function carregarJsBarcode(){
  if(window.JsBarcode) return Promise.resolve();
  if(carregarJsBarcode.p) return carregarJsBarcode.p;
  carregarJsBarcode.p = new Promise(function(ok){
    var s = document.createElement('script');
    s.src = JSBARCODE_URL; s.onload = ok; s.onerror = ok;
    document.head.appendChild(s);
  });
  return carregarJsBarcode.p;
}
carregarJsBarcode().then(function(){ if(S.linhas.length) renderEtiquetas(); });

// O logo vai embutido na janela de impressão, para não depender do endereço do site.
var logoDados = '';
fetch(LOGO_URL).then(function(r){ return r.ok ? r.blob() : null; }).then(function(b){
  if(!b) return;
  var leitor = new FileReader();
  leitor.onload = function(){ logoDados = leitor.result; };
  leitor.readAsDataURL(b);
}).catch(function(){});

/* ---------- Passo 1: base ---------- */
function mostrarBase(extra){
  el('precStBase').className = 'prec-status ok';
  el('precStBase').innerHTML = '<b>' + S.base.size.toLocaleString('pt-BR') + '</b> preços · lojas ' + lojasDaBase(S.base).join(', ') +
    ' · base de <b>' + esc(S.baseData || '?') + '</b> ' + (extra || '');
  if(!S.arquivos.length) el('precStNew').textContent = 'Agora arraste as planilhas de hoje (uma por loja).';
}

function aoReceberBase(arquivos){
  var file = arquivos[0];
  if(!file) return;
  el('precStBase').className = 'prec-status';
  el('precStBase').textContent = 'Lendo ' + file.name + '…';
  file.text().then(function(texto){
    var r = lerBaseCsv(texto);
    if(!r.recs.length) throw new Error('nenhum produto no arquivo.');
    S.base = paraMapa(r.recs); S.baseData = r.data;
    mostrarBase();
    S.arquivos.forEach(function(f){ if(f.recs){ var d = detectarLoja(f.recs, S.base); f.det = d; if(d) f.loja = d.loja; } });
    renderArquivos();
    if(S.arquivos.length) recalcular();
  }).catch(function(e){ el('precStBase').textContent = 'Não consegui ler: ' + e.message; });
}

/* ---------- Passo 1: planilhas ---------- */
function lerPlanilha(file){
  if(!window.XLSX) return Promise.reject(new Error('a biblioteca de Excel não carregou. Confira a internet e recarregue a página.'));
  return file.arrayBuffer().then(function(buf){
    var wb = XLSX.read(buf, { type: 'array' });
    var ws = wb.Sheets[wb.SheetNames[0]];
    return lerPlanilhaMatriz(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }));
  });
}

function aoReceberPlanilhas(arquivos){
  if(!S.base){ el('precStNew').textContent = 'Carregue a base primeiro.'; return; }
  if(typeof showOverlay === 'function') showOverlay('Lendo planilhas…');
  Promise.all(arquivos.map(function(file){
    return lerPlanilha(file).then(function(recs){
      var det = detectarLoja(recs, S.base), pelo = lojaPeloNome(file.name);
      return { nome: file.name, recs: recs, det: det, pelo: pelo, loja: det ? det.loja : pelo };
    }).catch(function(e){ return { nome: file.name, erro: e.message, recs: [] }; });
  })).then(function(novos){
    novos.forEach(function(n){
      S.arquivos = S.arquivos.filter(function(f){ return f.nome !== n.nome; });
      S.arquivos.push(n);
    });
    S.dataHoje = dataHoje(); S.fora.clear();
    renderArquivos(); recalcular();
  }).finally(function(){ if(typeof hideOverlay === 'function') hideOverlay(); });
}

function renderArquivos(){
  var st = el('precStNew'), ok = S.arquivos.some(function(f){ return !f.erro; });
  st.className = 'prec-status' + (ok ? ' ok' : '');
  if(!S.arquivos.length){ st.textContent = S.base ? 'Arraste as planilhas de hoje.' : 'Carregue a base primeiro.'; return; }
  var lojas = [''].concat(S.base ? lojasDaBase(S.base) : []);
  st.innerHTML = '<div class="prec-flist">' + S.arquivos.map(function(f, i){
    if(f.erro) return '<div class="prec-frow bad"><span class="fname">' + esc(f.nome) + '</span><span>Não consegui ler: ' + esc(f.erro) + '</span><button class="x" data-rm="' + i + '" type="button" aria-label="Remover">×</button></div>';
    var conflito = f.det && f.pelo && f.det.loja !== f.pelo;
    return '<div class="prec-frow' + (conflito ? ' alert' : '') + '"><span class="fname">' + esc(f.nome) + '</span><span>' + f.recs.length.toLocaleString('pt-BR') + ' produtos</span>' +
      '<label>é a <select data-i="' + i + '">' + lojas.map(function(l){
        return '<option value="' + l + '"' + (l === f.loja ? ' selected' : '') + '>' + (l === '' ? 'escolha a loja' : esc(nomeLoja(l))) + '</option>';
      }).join('') + '</select></label>' +
      '<span class="muted">' + (f.det ? 'detectada pelo estoque (' + Math.round(f.det.p * 100) + '% igual)' + (conflito ? ' · o nome do arquivo diz loja ' + f.pelo : '') : 'pelo nome do arquivo: confira!') + '</span>' +
      '<button class="x" data-rm="' + i + '" type="button" aria-label="Remover">×</button></div>';
  }).join('') + '</div>';
  st.querySelectorAll('select[data-i]').forEach(function(s){
    s.onchange = function(){ S.arquivos[Number(s.dataset.i)].loja = s.value ? Number(s.value) : null; renderArquivos(); recalcular(); };
  });
  st.querySelectorAll('button[data-rm]').forEach(function(b){
    b.onclick = function(){ S.arquivos.splice(Number(b.dataset.rm), 1); renderArquivos(); recalcular(); };
  });
}

/* ---------- Passo 2: conciliação ---------- */
function filtrosAtuais(loja){
  return {
    loja: loja === undefined ? S.loja : loja, tipo: el('precTipo').value, classe: el('precClass').value,
    soEstoque: el('precEstoque').checked, minimo: el('precMin').value, busca: el('precBusca').value
  };
}

function recalcular(){
  var r = conciliar(S.arquivos, S.base);
  S.linhas = r.linhas;
  el('precWarn').hidden = !r.avisos.length;
  el('precWarn').innerHTML = r.avisos.join('<br>');
  var classes = Array.from(new Set(S.linhas.map(function(x){ return x.classificacao; }).filter(Boolean))).sort();
  var atual = el('precClass').value;
  var alvo = S.classeEscolhida ? atual : (classes.indexOf('PERFUMARIA') >= 0 ? 'PERFUMARIA' : atual);
  el('precClass').innerHTML = '<option value="">Todas</option>' + classes.map(function(c){
    return '<option' + (c === alvo ? ' selected' : '') + '>' + esc(c) + '</option>';
  }).join('');
  el('precResults').hidden = !S.linhas.length;
  el('precHow').hidden = !!S.linhas.length;
  if(S.linhas.length){ renderResumo(); renderTabela(); }
}

function renderResumo(){
  var lojas = Array.from(new Set(S.linhas.map(function(r){ return r.loja; }))).sort(function(a, b){ return a - b; });
  function card(l, titulo){
    var f = filtrosAtuais(l); f.tipo = 'all'; f.busca = '';
    var c = contar(filtrar(S.linhas, f));
    return '<button class="prec-store" type="button" data-loja="' + l + '" aria-pressed="' + (S.loja === l) + '"><div class="n">' + titulo + '</div>' +
      '<div class="prec-chips"><span class="prec-chip c-down">↓ ' + c.down + '</span><span class="prec-chip c-up">↑ ' + c.up + '</span><span class="prec-chip c-new">novo ' + c.new + '</span></div></button>';
  }
  el('precSummary').innerHTML = card('todas', 'Todas as lojas') + lojas.map(function(l){ return card(l, 'Loja ' + l); }).join('');
  el('precSummary').querySelectorAll('.prec-store').forEach(function(b){
    b.onclick = function(){ var v = b.dataset.loja; S.loja = v === 'todas' ? 'todas' : Number(v); renderResumo(); renderTabela(); };
  });
}

function renderTabela(){
  var linhas = filtrar(S.linhas, filtrosAtuais()), tb = el('precBody');
  if(!linhas.length){
    tb.innerHTML = '<tr><td colspan="9" class="empty">Nenhum produto com esses filtros.</td></tr>';
  } else {
    tb.innerHTML = linhas.slice(0, 3000).map(function(r){
      var k = chave(r.loja, r.codigo), pct = r.de ? (r.por - r.de) / r.de * 100 : null;
      return '<tr><td><input type="checkbox" data-k="' + esc(k) + '"' + (S.fora.has(k) ? '' : ' checked') + ' aria-label="Incluir na impressão"></td>' +
        '<td>' + r.loja + '</td><td class="code">' + esc(r.codigo) + '<br><small>' + esc(r.ean || '') + '</small></td>' +
        '<td class="desc">' + esc(r.descricao) + '</td><td class="num">' + brl(r.de) + '</td><td class="num"><b>' + brl(r.por) + '</b></td>' +
        '<td class="num ' + (r.tipo === 'down' ? 'c-down' : r.tipo === 'up' ? 'c-up' : '') + '">' + (pct == null ? '—' : (pct > 0 ? '+' : '') + pct.toFixed(1).replace('.', ',') + '%') + '</td>' +
        '<td class="num">' + r.estoque + '</td><td><span class="prec-pill ' + TIPOS[r.tipo][1] + '">' + TIPOS[r.tipo][0] + '</span></td></tr>';
    }).join('') + (linhas.length > 3000 ? '<tr><td colspan="9" class="empty">Mostrando 3.000 de ' + linhas.length.toLocaleString('pt-BR') + '. Use a busca ou escolha uma loja.</td></tr>' : '');
  }
  tb.querySelectorAll('input[type=checkbox]').forEach(function(c){
    c.onchange = function(){ if(c.checked) S.fora.delete(c.dataset.k); else S.fora.add(c.dataset.k); renderEtiquetas(); };
  });
  renderEtiquetas();
}

/* ---------- Passo 3: etiquetas ---------- */
function medidas(){
  var termica = el('precPapel').value === 'termica';
  var lw, lh;
  if(termica){ lw = 72; lh = 40; } else { var m = el('precSize').value.split('x').map(Number); lw = m[0]; lh = m[1]; }
  return { termica: termica, lw: lw, lh: lh, escala: Math.max(0.72, Math.min(lw / 66, 1.35)) };
}

function htmlEtiqueta(r, i, comBarras){
  var promo = r.tipo === 'down' && r.de != null;
  var partes = r.por.toFixed(2).split('.');
  var off = promo ? Math.round((1 - r.por / r.de) * 100) : 0;
  var barras = comBarras ? codigoBarras(r.ean) : '';
  return '<div class="lbl ' + (promo ? '' : 'plain') + '">' +
    '<div class="top"><img class="logo" src="' + LOGO_URL + '" alt="Rede Lucena"><div class="name">' + esc(nomeEtiqueta(r.descricao)) + '</div></div>' +
    '<div class="prices"><div>' + (promo ? '<div class="de">De <s>R$ ' + brl(r.de) + '</s></div>' : '') +
      '<div class="por"><span class="rs">' + (promo ? 'Por R$' : 'R$') + '</span><span class="val">' + Number(partes[0]).toLocaleString('pt-BR') + '</span><span class="cents">,' + partes[1] + '</span></div></div>' +
      (promo ? '<div class="tr"><span class="tag">Oferta</span>' + (off >= 1 ? '<div class="off">-' + off + '%</div>' : '') + '</div>' : '') + '</div>' +
    '<div class="foot"><div class="bcw">' + (barras ? '<svg data-code="' + esc(barras) + '"></svg>' : '') + '</div>' +
      '<div class="meta"><span class="cod">Cód. ' + esc(r.codigo) + '</span><br>' + esc(r.ean || '') + '</div></div></div>';
}

function renderEtiquetas(){
  var linhas = filtrar(S.linhas, filtrosAtuais()).filter(function(r){ return !S.fora.has(chave(r.loja, r.codigo)); });
  var md = medidas(), sheet = el('precSheet'), comBarras = el('precBarcode').checked;
  el('precWrapSize').hidden = md.termica;
  sheet.classList.toggle('termica', md.termica);
  sheet.style.setProperty('--lw', md.lw + 'mm');
  sheet.style.setProperty('--lh', md.lh + 'mm');
  sheet.style.setProperty('--s', md.escala);
  el('precLblCount').textContent = linhas.length.toLocaleString('pt-BR');
  var lista = linhas.slice(0, 1500).sort(function(a, b){ return a.loja - b.loja || a.descricao.localeCompare(b.descricao); });
  var grupos = [];
  lista.forEach(function(r, i){
    var g = grupos[grupos.length - 1];
    if(!g || g.loja !== r.loja){ g = { loja: r.loja, html: [] }; grupos.push(g); }
    g.html.push(htmlEtiqueta(r, i, comBarras));
  });
  sheet.innerHTML = grupos.length ? grupos.map(function(g){
    return '<section class="grp"><h3 class="grp-h">' + esc(nomeLoja(g.loja)) + '<span>' + g.html.length + ' etiqueta' + (g.html.length > 1 ? 's' : '') + '</span></h3>' +
      '<div class="grid" style="grid-template-columns:repeat(auto-fill,' + md.lw + 'mm)">' + g.html.join('') + '</div></section>';
  }).join('') : '<div class="empty">Nenhuma etiqueta selecionada.</div>';
  if(comBarras && window.JsBarcode){
    sheet.querySelectorAll('svg[data-code]').forEach(function(s){
      var c = s.dataset.code;
      try{ JsBarcode(s, c, { format: eanValido(c) ? (c.length === 13 ? 'EAN13' : 'EAN8') : 'CODE128', displayValue: false, margin: 0, height: 40, width: 1.4, background: 'transparent' }); }
      catch(e){ s.remove(); }
    });
  }
  el('btnPrecPrint').disabled = !grupos.length;
}

/* ---------- Impressão e arquivos ---------- */
function imprimir(){
  var md = medidas(), sheet = el('precSheet');
  var pagina = md.termica ? '@page{size:80mm 297mm;margin:4mm}' : '@page{size:A4;margin:6mm}';
  var absoluto = location.href.split('#')[0].replace(/[^/]*$/, '') + LOGO_URL;
  var html = sheet.outerHTML.split('src="' + LOGO_URL + '"').join('src="' + (logoDados || absoluto) + '"');
  var w = window.open('', '_blank');
  if(!w){ avisar('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.', true); return; }
  w.document.open();
  w.document.write('<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas ' + esc(S.dataHoje) + '</title>' +
    '<link rel="stylesheet" href="' + FONTES_URL + '"><style>' + LABEL_CSS + '\nbody{margin:0;background:#fff}\n' + pagina +
    '\n@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}.prec-sheet{padding:0;display:block}.prec-sheet.termica{width:auto}.grp + .grp{margin-top:5mm}}</style></head><body>' +
    html + '<script>Promise.all([document.fonts.ready].concat(Array.from(document.images).map(function(i){return i.complete?0:new Promise(function(r){i.onload=i.onerror=r;});}))).then(function(){setTimeout(function(){window.print();},150);});<\/script></body></html>');
  w.document.close();
}

function baixar(nome, texto){
  var blob = new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome;
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function exportarLista(){
  var linhas = filtrar(S.linhas, filtrosAtuais());
  var t = ['loja;codigo;ean;produto;classificacao;de;por;variacao_pct;estoque;situacao'].concat(linhas.map(function(r){
    return [r.loja, r.codigo, r.ean, semPontoVirgula(r.descricao), semPontoVirgula(r.classificacao), precoCsv(r.de), precoCsv(r.por),
      r.de ? ((r.por - r.de) / r.de * 100).toFixed(1).replace('.', ',') : '', r.estoque, TIPOS[r.tipo][0]].join(';');
  })).join('\n');
  baixar('DE_POR_' + (S.loja === 'todas' ? 'TODAS' : 'LOJA' + S.loja) + '_' + dataIso(S.dataHoje) + '.csv', t);
}

function baixarBase(){
  if(!S.arquivos.some(function(f){ return !f.erro && f.loja; })) return;
  var nova = atualizarBase(S.base, S.arquivos);
  baixar('BASE_PRECOS_' + dataIso(S.dataHoje) + '.csv', baseParaCsv(nova, S.dataHoje));
  S.base = nova; S.baseData = S.dataHoje;
  mostrarBase('(atualizada com as planilhas de hoje)');
  avisar('Base atualizada. Guarde o arquivo na pasta Bases.');
}

/* ---------- Eventos ---------- */
function ligarArrastar(zona, input, fn){
  zona.addEventListener('click', function(){ input.click(); });
  zona.addEventListener('keydown', function(e){ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); input.click(); } });
  input.addEventListener('change', function(){ fn(Array.from(input.files)); input.value = ''; });
  zona.addEventListener('dragover', function(e){ e.preventDefault(); zona.classList.add('drag'); });
  zona.addEventListener('dragleave', function(){ zona.classList.remove('drag'); });
  zona.addEventListener('drop', function(e){ e.preventDefault(); zona.classList.remove('drag'); fn(Array.from(e.dataTransfer.files)); });
}
ligarArrastar(el('precDropBase'), el('precFileBase'), aoReceberBase);
ligarArrastar(el('precDropNew'), el('precFileNew'), aoReceberPlanilhas);
el('precClass').addEventListener('change', function(){ S.classeEscolhida = true; });
['precTipo', 'precClass', 'precEstoque', 'precMin'].forEach(function(id){
  el(id).addEventListener('change', function(){ renderResumo(); renderTabela(); });
});
el('precBusca').addEventListener('input', renderTabela);
['precPapel', 'precSize', 'precBarcode'].forEach(function(id){ el(id).addEventListener('change', renderEtiquetas); });
el('precChkAll').addEventListener('change', function(e){
  filtrar(S.linhas, filtrosAtuais()).forEach(function(r){ var k = chave(r.loja, r.codigo); if(e.target.checked) S.fora.delete(k); else S.fora.add(k); });
  renderTabela();
});
el('btnPrecCsv').addEventListener('click', exportarLista);
el('btnPrecBase').addEventListener('click', baixarBase);
el('btnPrecPrint').addEventListener('click', imprimir);

window.__tool_destroy_precificacao = function(){
  estiloEtiqueta.remove();
  linkFontes.remove();
};

}; // end of window.__tool_init_precificacao
