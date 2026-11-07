// Leitores dos arquivos de exemplo para os testes em Node, sem dependências.
// No navegador a tela usa pdf.js e SheetJS; aqui a leitura entrega o mesmo formato:
//  - lerLinhasPdf: linhas de texto agrupadas por página e altura, como readPdfLines.
//  - lerMatrizXls: matriz da 1ª aba de um .xls (BIFF8), como sheet_to_json(header:1, defval:'').
//  - lerAbasXlsx: valores das abas de um .xlsx (usado só para ler o gabarito).
const fs = require('node:fs');
const zlib = require('node:zlib');

/* ------------------------------------------------------------------ PDF */
// Caracteres 0x80–0x9F do WinAnsiEncoding (os demais coincidem com o Latin-1).
const WIN_ANSI = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ' };
const winAnsi = bytes => Array.from(bytes, b => WIN_ANSI[b] || String.fromCharCode(b)).join('');

function pdfObjetos(buf){
  const texto = buf.toString('latin1'), objetos = new Map();
  const re = /(\d+)\s+0\s+obj\b/g;
  let m;
  while((m = re.exec(texto))){
    const inicio = m.index + m[0].length, fim = texto.indexOf('endobj', inicio);
    const corpo = texto.slice(inicio, fim);
    const s = corpo.match(/stream\r?\n/);
    let dados = null;
    if(s){
      const a = inicio + s.index + s[0].length, b = texto.indexOf('endstream', a);
      dados = buf.subarray(a, b);
      if(/\/FlateDecode/.test(corpo.slice(0, s.index))) dados = zlib.inflateSync(dados);
    }
    objetos.set(Number(m[1]), { dict: s ? corpo.slice(0, s.index) : corpo, dados });
  }
  return objetos;
}

function pdfPaginas(objetos){
  const catalogo = Array.from(objetos.values()).find(o => /\/Type\s*\/Catalog/.test(o.dict));
  const paginas = [];
  function percorrer(num){
    const o = objetos.get(num);
    if(/\/Type\s*\/Pages\b/.test(o.dict)){
      const kids = o.dict.match(/\/Kids\s*\[([^\]]*)\]/)[1];
      Array.from(kids.matchAll(/(\d+)\s+0\s+R/g), k => Number(k[1])).forEach(percorrer);
    } else paginas.push(o);
  }
  percorrer(Number(catalogo.dict.match(/\/Pages\s+(\d+)\s+0\s+R/)[1]));
  return paginas.map(p => {
    const lista = p.dict.match(/\/Contents\s*(\[[^\]]*\]|\d+\s+0\s+R)/)[1];
    return Buffer.concat(Array.from(lista.matchAll(/(\d+)\s+0\s+R/g), r => objetos.get(Number(r[1])).dados));
  });
}

function lerStringLiteral(s, i){
  const bytes = [];
  let nivel = 1;
  for(i++; i < s.length; i++){
    const c = s[i];
    if(c === '\\'){
      const n = s[++i];
      const esc = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
      if(n in esc) bytes.push(esc[n]);
      else if(/[0-7]/.test(n)){ let oct = n; while(oct.length < 3 && /[0-7]/.test(s[i + 1])) oct += s[++i]; bytes.push(parseInt(oct, 8)); }
      else if(n === '\r' || n === '\n'){ if(n === '\r' && s[i + 1] === '\n') i++; }
      else bytes.push(n.charCodeAt(0));
    } else if(c === '('){ nivel++; bytes.push(40); }
    else if(c === ')'){ if(--nivel === 0) break; bytes.push(41); }
    else bytes.push(c.charCodeAt(0));
  }
  return { valor: winAnsi(bytes), fim: i + 1 };
}

// Interpreta os operadores de texto mais comuns (BT/ET, Td, TD, Tm, T*, TL, Tj, TJ, ', ").
function textosDaPagina(conteudo){
  const s = conteudo.toString('latin1'), itens = [], pilha = [];
  let tm = [1, 0, 0, 1, 0, 0], tlm = [1, 0, 0, 1, 0, 0], lead = 0;
  const moverLinha = (tx, ty) => { tlm = [tlm[0], tlm[1], tlm[2], tlm[3], tlm[4] + tx * tlm[0] + ty * tlm[2], tlm[5] + tx * tlm[1] + ty * tlm[3]]; tm = tlm.slice(); };
  const mostrar = texto => { if(texto.trim()) itens.push({ x: tm[4], y: tm[5], str: texto }); };
  let i = 0;
  while(i < s.length){
    const c = s[i];
    if(/\s/.test(c)){ i++; continue; }
    if(c === '%'){ while(i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if(c === '('){ const r = lerStringLiteral(s, i); pilha.push(r.valor); i = r.fim; continue; }
    if(c === '<' && s[i + 1] !== '<'){
      const fim = s.indexOf('>', i), hex = s.slice(i + 1, fim).replace(/\s/g, '');
      pilha.push(winAnsi(Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex'))); i = fim + 1; continue;
    }
    if(c === '['){ pilha.push('['); i++; continue; }
    if(c === ']'){
      const partes = [];
      while(pilha.length && pilha[pilha.length - 1] !== '[') partes.unshift(pilha.pop());
      pilha.pop();
      pilha.push({ array: partes }); i++; continue;
    }
    const tok = s.slice(i).match(/^[^\s()<>\[\]\/%]+|^\/[^\s()<>\[\]\/%]*|^<<|^>>/)[0];
    i += tok.length;
    if(/^[-+]?(\d+\.?\d*|\.\d+)$/.test(tok) || tok[0] === '/' || tok === '<<' || tok === '>>'){ pilha.push(tok[0] === '/' || tok.length === 2 && /[<>]/.test(tok) ? tok : Number(tok)); continue; }
    const n = k => Number(pilha[pilha.length - k]);
    switch(tok){
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); break;
      case 'Td': moverLinha(n(2), n(1)); break;
      case 'TD': lead = -n(1); moverLinha(n(2), n(1)); break;
      case 'TL': lead = n(1); break;
      case 'Tm': tm = [n(6), n(5), n(4), n(3), n(2), n(1)]; tlm = tm.slice(); break;
      case 'T*': moverLinha(0, -lead); break;
      case 'Tj': mostrar(String(pilha[pilha.length - 1])); break;
      case "'": moverLinha(0, -lead); mostrar(String(pilha[pilha.length - 1])); break;
      case '"': moverLinha(0, -lead); mostrar(String(pilha[pilha.length - 1])); break;
      case 'TJ': { const a = pilha[pilha.length - 1]; mostrar(a && a.array ? a.array.filter(p => typeof p === 'string').join('') : ''); break; }
      default: break;
    }
    pilha.length = 0;
  }
  return itens;
}

function lerLinhasPdf(caminho){
  const linhas = [];
  pdfPaginas(pdfObjetos(fs.readFileSync(caminho))).forEach(conteudo => {
    const porAltura = new Map();
    textosDaPagina(conteudo).forEach(item => {
      const y = Math.round(item.y);
      if(!porAltura.has(y)) porAltura.set(y, []);
      porAltura.get(y).push(item);
    });
    Array.from(porAltura.keys()).sort((a, b) => b - a).forEach(y => {
      const linha = porAltura.get(y).sort((a, b) => a.x - b.x).map(item => item.str).join(' ').replace(/\s+/g, ' ').trim();
      if(linha) linhas.push(linha);
    });
  });
  return linhas;
}

/* ------------------------------------------------------------------ XLS (BIFF8) */
function streamOle(buf, nomes){
  const tamSetor = 1 << buf.readUInt16LE(30), qtdFat = buf.readUInt32LE(44), inicioDir = buf.readInt32LE(48);
  const limiteMini = buf.readUInt32LE(56), inicioMiniFat = buf.readInt32LE(60), inicioDifat = buf.readInt32LE(68);
  const setor = i => buf.subarray(512 + i * tamSetor, 512 + (i + 1) * tamSetor);
  const setoresFat = [];
  for(let i = 0; i < 109 && setoresFat.length < qtdFat; i++) setoresFat.push(buf.readInt32LE(76 + i * 4));
  for(let d = inicioDifat; setoresFat.length < qtdFat && d >= 0;){
    const s = setor(d);
    for(let i = 0; i < tamSetor / 4 - 1 && setoresFat.length < qtdFat; i++) setoresFat.push(s.readInt32LE(i * 4));
    d = s.readInt32LE(tamSetor - 4);
  }
  const fat = [];
  setoresFat.forEach(f => { const s = setor(f); for(let i = 0; i < tamSetor / 4; i++) fat.push(s.readInt32LE(i * 4)); });
  const cadeia = (inicio, tabela) => { const out = []; for(let c = inicio; c >= 0 && out.length < 1e6; c = tabela[c]) out.push(c); return out; };
  const dir = Buffer.concat(cadeia(inicioDir, fat).map(setor));
  const entradas = [];
  for(let o = 0; o + 128 <= dir.length; o += 128){
    const tamNome = dir.readUInt16LE(o + 64);
    entradas.push({ nome: dir.subarray(o, o + Math.max(0, tamNome - 2)).toString('utf16le'), tipo: dir[o + 66], inicio: dir.readInt32LE(o + 116), tamanho: dir.readUInt32LE(o + 120) });
  }
  const entrada = entradas.find(e => nomes.includes(e.nome));
  if(!entrada) throw new Error('O arquivo não tem a planilha (Workbook) esperada.');
  if(entrada.tamanho >= limiteMini) return Buffer.concat(cadeia(entrada.inicio, fat).map(setor)).subarray(0, entrada.tamanho);
  // Stream pequena: fica no mini stream da entrada raiz.
  const raiz = entradas[0], mini = Buffer.concat(cadeia(raiz.inicio, fat).map(setor));
  const miniFat = [];
  cadeia(inicioMiniFat, fat).forEach(f => { const s = setor(f); for(let i = 0; i < tamSetor / 4; i++) miniFat.push(s.readInt32LE(i * 4)); });
  return Buffer.concat(cadeia(entrada.inicio, miniFat).map(i => mini.subarray(i * 64, (i + 1) * 64))).subarray(0, entrada.tamanho);
}

function valorRk(rk){
  let n;
  if(rk & 2) n = rk >> 2;
  else { const b = Buffer.alloc(8); b.writeInt32LE(rk & ~3, 4); n = b.readDoubleLE(0); }
  return rk & 1 ? n / 100 : n;
}

// SST com CONTINUE: o texto pode ser cortado entre registros (e o byte de opções se repete).
function lerSst(partes){
  const textos = [], total = partes[0].readUInt32LE(4);
  let p = 0, off = 8, buf = partes[0];
  const proxima = () => { p++; buf = partes[p]; off = 0; };
  for(let k = 0; k < total; k++){
    if(off >= buf.length) proxima();
    let cch = buf.readUInt16LE(off); off += 2;
    let opcoes = buf[off++];
    let runs = 0, ext = 0;
    if(opcoes & 8){ runs = buf.readUInt16LE(off); off += 2; }
    if(opcoes & 4){ ext = buf.readInt32LE(off); off += 4; }
    let texto = '';
    while(cch > 0){
      if(off >= buf.length){ proxima(); opcoes = buf[off++]; }
      const largo = opcoes & 1, cabe = largo ? Math.floor((buf.length - off) / 2) : buf.length - off, n = Math.min(cch, cabe);
      texto += largo ? buf.subarray(off, off + n * 2).toString('utf16le') : buf.subarray(off, off + n).toString('latin1');
      off += n * (largo ? 2 : 1); cch -= n;
    }
    for(let pular = runs * 4 + ext; pular > 0;){
      if(off >= buf.length) proxima();
      const n = Math.min(pular, buf.length - off); off += n; pular -= n;
    }
    textos.push(texto);
  }
  return textos;
}

// Matriz da primeira aba, a partir da primeira linha da dimensão da planilha (como o !ref do SheetJS).
// Aceita o caminho do arquivo ou o conteúdo (Buffer).
function lerMatrizXls(caminho){
  const wb = streamOle(Buffer.isBuffer(caminho) ? caminho : fs.readFileSync(caminho), ['Workbook', 'Book']);
  const registros = [];
  for(let p = 0; p + 4 <= wb.length;){ const tipo = wb.readUInt16LE(p), tam = wb.readUInt16LE(p + 2); registros.push([tipo, wb.subarray(p + 4, p + 4 + tam)]); p += 4 + tam; }
  let sst = [], aba = -1, dim = null;
  const celulas = new Map();
  const gravar = (r, c, v) => { if(!celulas.has(r)) celulas.set(r, new Map()); celulas.get(r).set(c, v); };
  for(let i = 0; i < registros.length; i++){
    const [tipo, d] = registros[i];
    if(tipo === 0x0809 && d.readUInt16LE(2) === 0x10){ aba++; continue; }
    if(tipo === 0x00FC){ const partes = [d]; for(let j = i + 1; j < registros.length && registros[j][0] === 0x003C; j++) partes.push(registros[j][1]); sst = lerSst(partes); continue; }
    if(aba !== 0) continue;
    if(tipo === 0x0200) dim = { r0: d.readUInt32LE(0), r1: d.readUInt32LE(4), c0: d.readUInt16LE(8), c1: d.readUInt16LE(10) };
    else if(tipo === 0x00FD) gravar(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)]);
    else if(tipo === 0x0203) gravar(d.readUInt16LE(0), d.readUInt16LE(2), d.readDoubleLE(6));
    else if(tipo === 0x027E) gravar(d.readUInt16LE(0), d.readUInt16LE(2), valorRk(d.readInt32LE(6)));
    else if(tipo === 0x00BD){ const r = d.readUInt16LE(0); let c = d.readUInt16LE(2); for(let o = 4; o + 6 <= d.length - 2; o += 6, c++) gravar(r, c, valorRk(d.readInt32LE(o + 2))); }
    else if(tipo === 0x0204){ const n = d.readUInt16LE(6), largo = d[8] & 1; gravar(d.readUInt16LE(0), d.readUInt16LE(2), largo ? d.subarray(9, 9 + n * 2).toString('utf16le') : d.subarray(9, 9 + n).toString('latin1')); }
    else if(tipo === 0x0006 && d.readUInt16LE(12) !== 0xFFFF) gravar(d.readUInt16LE(0), d.readUInt16LE(2), d.readDoubleLE(6));
  }
  const linhas = Array.from(celulas.keys()), colunas = [].concat(...Array.from(celulas.values(), m => Array.from(m.keys())));
  const r0 = dim ? dim.r0 : Math.min(...linhas), r1 = dim ? dim.r1 - 1 : Math.max(...linhas);
  const c0 = dim ? dim.c0 : Math.min(...colunas), c1 = dim ? dim.c1 - 1 : Math.max(...colunas);
  const matriz = [];
  for(let r = r0; r <= r1; r++){
    const linha = [];
    for(let c = c0; c <= c1; c++){ const v = celulas.has(r) ? celulas.get(r).get(c) : undefined; linha.push(v === undefined ? '' : v); }
    matriz.push(linha);
  }
  return { matriz, primeiraLinha: r0 + 1 };
}

/* ------------------------------------------------------------------ XLSX (gabarito) */
function lerZip(buf){
  const fimDir = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const qtd = buf.readUInt16LE(fimDir + 10), arquivos = {};
  for(let p = buf.readUInt32LE(fimDir + 16), i = 0; i < qtd; i++){
    const metodo = buf.readUInt16LE(p + 10), tamComp = buf.readUInt32LE(p + 20), tamNome = buf.readUInt16LE(p + 28), tamExtra = buf.readUInt16LE(p + 30), tamComent = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + tamNome).toString('utf8');
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const dados = buf.subarray(ini, ini + tamComp);
    arquivos[nome] = metodo === 8 ? zlib.inflateRawSync(dados) : dados;
    p += 46 + tamNome + tamExtra + tamComent;
  }
  return arquivos;
}

const xmlTexto = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const colunaIndice = letras => letras.split('').reduce((n, l) => n * 26 + l.charCodeAt(0) - 64, 0) - 1;

// { 'Nome da aba': [[valores da linha 1], [linha 2], ...] } com números como número.
function lerAbasXlsx(caminho){
  const zip = lerZip(fs.readFileSync(caminho));
  const compartilhados = Array.from(zip['xl/sharedStrings.xml'].toString().matchAll(/<si>([\s\S]*?)<\/si>/g), m => xmlTexto(Array.from(m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g), t => t[1]).join('')));
  const rels = Object.fromEntries(Array.from(zip['xl/_rels/workbook.xml.rels'].toString().matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g), m => [m[1], m[2]]));
  const abas = {};
  for(const m of zip['xl/workbook.xml'].toString().matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)){
    const xml = zip['xl/' + rels[m[2]].replace(/^\/?xl\//, '')].toString(), linhas = [];
    for(const r of xml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)){
      const linha = [];
      for(const c of r[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
        const tipo = (c[2].match(/t="(\w+)"/) || [])[1], v = ((c[3] || '').match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let valor = '';
        if(tipo === 's') valor = compartilhados[Number(v)];
        else if(tipo === 'inlineStr') valor = xmlTexto(((c[3] || '').match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '');
        else if(tipo === 'str' || tipo === 'e') valor = v === undefined ? '' : xmlTexto(v);
        else if(v !== undefined) valor = Number(v);
        linha[colunaIndice(c[1])] = valor;
      }
      linhas[Number(r[1]) - 1] = Array.from(linha, x => x === undefined ? '' : x);
    }
    abas[xmlTexto(m[1])] = Array.from(linhas, x => x || []);
  }
  return abas;
}

module.exports = { lerLinhasPdf, lerMatrizXls, lerAbasXlsx };
