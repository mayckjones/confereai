/* =========================================================================
   ConfereAI — Shared Utilities
   Funções globais disponíveis para todas as ferramentas.
   ========================================================================= */

/* ---------- DARK MODE ---------- */
(function initTheme(){
  const saved = localStorage.getItem('confereai-theme');
  if(saved === 'dark'){
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();

function toggleTheme(){
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  if(isDark){
    html.removeAttribute('data-theme');
    localStorage.setItem('confereai-theme', 'light');
  } else {
    html.setAttribute('data-theme', 'dark');
    localStorage.setItem('confereai-theme', 'dark');
  }
}

/* ---------- TOAST ---------- */
function showToast(msg, isErr){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('err', !!isErr);
  t.classList.add('show');
  clearTimeout(showToast._tm);
  showToast._tm = setTimeout(()=> t.classList.remove('show'), 3600);
}

/* ---------- OVERLAY ---------- */
function showOverlay(msg){
  document.getElementById('overlayMsg').textContent = msg || 'Processando…';
  document.getElementById('overlay').classList.add('show');
}
function hideOverlay(){ document.getElementById('overlay').classList.remove('show'); }

/* ---------- FORMAT HELPERS ---------- */
function fmtBRL(v){
  const n = Number(v)||0;
  return n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}

function parseValorBR(raw){
  if(raw === null || raw === undefined) return NaN;
  if(typeof raw === 'number') return raw;
  let s = String(raw).trim();
  if(!s) return NaN;
  let neg = false;
  if(/^\(.*\)$/.test(s)){ neg = true; s = s.slice(1,-1); }
  if(/^-/.test(s)){ neg = true; }
  s = s.replace(/R\$/gi,'').replace(/\s/g,'').replace(/^-/, '');
  if(s.includes(',') && s.includes('.')){
    s = s.replace(/\./g,'').replace(',', '.');
  } else if(s.includes(',')){
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  if(isNaN(n)) return NaN;
  return neg ? -n : n;
}

function excelSerialToISO(serial){
  const utcDays = Math.floor(serial - 25569);
  const utcMs = utcDays * 86400 * 1000;
  const d = new Date(utcMs);
  return d.toISOString().slice(0,10);
}

function parseDateAny(raw){
  if(raw === null || raw === undefined || raw === '') return null;
  if(typeof raw === 'number'){
    try{ return excelSerialToISO(raw); }catch(e){ return null; }
  }
  const s = String(raw).trim();
  let m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if(m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if(m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{2})\/(\d{2})\/(\d{2})$/);
  if(m) return `20${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function parseTimeAny(raw){
  if(raw === null || raw === undefined || raw === '') return null;
  if(typeof raw === 'number' && raw < 1){
    const totalMin = Math.round(raw * 24 * 60);
    const hh = String(Math.floor(totalMin/60)).padStart(2,'0');
    const mm = String(totalMin%60).padStart(2,'0');
    return `${hh}:${mm}`;
  }
  const s = String(raw).trim();
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if(m) return `${m[1].padStart(2,'0')}:${m[2]}`;
  return null;
}

function formatDateBR(iso){
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
