/* =========================================================================
   ConfereAI — Ferramenta: Precificação (etiquetas de preço 80 mm)
   Lê a planilha de produtos, permite revisar e gera o PDF no modelo oficial
   ("Etiqueta OFICIAL.pdf"): folha de 80 × 297 mm com até 6 etiquetas.
   Registrada como window.__tool_init_precificacao — chamada pelo router.
   ========================================================================= */

window.__tool_init_precificacao = function(){

/* =========================================================================
   MODELO OFICIAL
   Medidas tiradas do PDF oficial, em mm. Nos textos, "y" é a distância do
   topo da caixa até a linha de base. O PDF usa pontos (1 mm = 72/25,4 pt)
   com origem no canto inferior esquerdo.
   ========================================================================= */
var MM = 72 / 25.4;
var LAYOUT = {
  larguraFolha: 80, alturaFolha: 297, porFolha: 6,
  margem: 6,            // acima da primeira e abaixo da última etiqueta
  passo: 49,            // do topo de uma etiqueta ao topo da seguinte
  caixa: { x: 5, largura: 70, altura: 40, cinza: 0.733333, espessura: 0.5 },
  textoX: 9,
  larguraUtil: 62,      // da margem do texto até 4 mm antes da borda direita
  larguraAteLogo: 40.5, // linhas que ficam à esquerda do logo
  larguraPreco: 48,     // preço grande: para antes da ponta do coração (só R$ 1.000+ diminui)
  nome: { y: 5.5, tamanho: 7.5, minimo: 5.5 },
  codigo: { y: 9.5, tamanho: 7, minimo: 5.5 },
  barras: { y: 13, tamanho: 7, minimo: 5.5 },
  de: { y: 19, tamanho: 9, precoTamanho: 11, precoMinimo: 8, risco: 0.335, folga: 0.5, espessura: 0.9 },
  por: { y: 24, tamanho: 9 },
  preco: { y: 35, tamanho: 28, minimo: 14 },
  logo: { x: 50.5, topo: 9.8743, largura: 21 },
  corte: { y: 44.5, x1: 2, x2: 78, cinza: 0.6, traco: 2, espessura: 0.5 }
};

var TEMPLATE_HEADERS = ['DESCRIÇÃO', 'CÓDIGO', 'CÓDIGO DE BARRAS', 'PREÇO DE', 'PREÇO POR', 'QUANTIDADE'];
var TEMPLATE_EXAMPLES = [
  ['FRALDA INFANTIL G C/30', '42118', '7896100542037', 59.9, 47.9, 1],
  ['CREME DENTAL 90G C/3 UN', '37264', '7891509315770', 15.99, 11.99, 1],
  ['DIPIRONA 500MG C/10 COMP', '10432', '7891058112349', 8.99, 5.99, 1],
  ['PROTETOR SOLAR FPS50 120ML', '31877', '7896053208110', 69.9, 54.9, 1],
  ['SHAMPOO SOS CACHOS KIDS 300ML', '28540', '7896224022156', 24.99, 19.99, 1],
  ['VITAMINA C 1G C/10 EFERV', '15209', '7896367100421', 19.9, 14.9, 1]
];
var TEMPLATE_INSTRUCTIONS = [
  'COMO PREENCHER A PLANILHA DE ETIQUETAS',
  '',
  'Use a aba "Etiquetas". Uma linha por produto. Não mude os nomes das colunas.',
  '',
  'DESCRIÇÃO: nome do produto como deve sair na etiqueta. Sai em letras maiúsculas. Obrigatório.',
  'CÓDIGO: código interno do produto no sistema.',
  'CÓDIGO DE BARRAS: EAN do produto (normalmente 13 dígitos).',
  'PREÇO DE: preço antes da promoção. Deixe vazio se não houver promoção: a etiqueta sai só com o preço.',
  'PREÇO POR: preço que o cliente paga. Obrigatório.',
  'QUANTIDADE: quantas etiquetas imprimir desse produto. Vazio = 1. Zero = não imprime.',
  '',
  'Cada folha tem 6 etiquetas (80 × 297 mm). A última folha sai só com as etiquetas necessárias.',
  'Apague as linhas de exemplo antes de preencher os seus produtos.'
];

/* ---------- Larguras da Helvetica (AFM, 1/1000 do tamanho), ASCII 32–126 ---------- */
var HELVETICA = {
  normal: [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584],
  negrito: [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584]
};
var EXTRA_WIDTHS = { ' ': [278, 278], 'ª': [370, 370], 'º': [365, 365], '°': [400, 400], '´': [333, 333], '×': [584, 584], '–': [556, 556], '—': [1000, 1000], '•': [350, 350], '…': [1000, 1000], '€': [556, 556] };
// Caracteres que a WinAnsiEncoding coloca entre 0x80 e 0x9F.
var WIN_ANSI_EXTRA = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };

/* =========================================================================
   TEXTO, VALORES E PLANILHA
   ========================================================================= */
function cleanText(value){
  return String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function encodeChar(ch){
  var code = ch.charCodeAt(0);
  if(code >= 32 && code <= 126) return code;
  if(code >= 0xa0 && code <= 0xff) return code;
  return WIN_ANSI_EXTRA[ch] || null;
}

function hasUnsupported(text){
  return Array.from(String(text || '')).some(function(ch){ return encodeChar(ch) === null; });
}

function charWidth(ch, bold){
  var table = HELVETICA[bold ? 'negrito' : 'normal'], code = ch.charCodeAt(0);
  if(code >= 32 && code <= 126) return table[code - 32];
  if(EXTRA_WIDTHS[ch]) return EXTRA_WIDTHS[ch][bold ? 1 : 0];
  var base = ch.normalize('NFD').charAt(0), baseCode = base.charCodeAt(0);
  if(base !== ch && baseCode >= 32 && baseCode <= 126) return table[baseCode - 32];
  return 556;
}

// Largura em pontos, como o leitor de PDF vai desenhar.
function textWidth(text, bold, size){
  return Array.from(String(text)).reduce(function(sum, ch){ return sum + charWidth(ch, bold); }, 0) * size / 1000;
}

// Reduz a letra até o mínimo; se ainda não couber, corta com reticências.
function fitText(text, bold, size, minSize, maxWidth){
  var s = size;
  while(s > minSize && textWidth(text, bold, s) > maxWidth) s = Math.max(minSize, Math.round((s - 0.25) * 100) / 100);
  if(textWidth(text, bold, s) <= maxWidth) return { texto: text, tamanho: s, reduzido: s < size, cortado: false };
  var chars = Array.from(text);
  while(chars.length && textWidth(chars.join('').trim() + '…', bold, s) > maxWidth) chars.pop();
  return { texto: chars.join('').trim() + '…', tamanho: s, reduzido: true, cortado: true };
}

function parsePrice(raw){
  if(raw === null || raw === undefined || raw === '') return null;
  if(typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw * 100) / 100 : null;
  var s = String(raw).replace(/R\$/gi, '').replace(/\s/g, '');
  if(!s) return null;
  if(/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');   // 1.299,90
  else if(/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');      // 1.299
  else s = s.replace(/,/g, '');                                         // 47.90 ou 1,299.90
  if(!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s) * 100) / 100;
}

function formatPrice(value){
  var cents = Math.abs(Math.round(value * 100));
  var inteiro = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return 'R$' + inteiro + ',' + String(cents % 100).padStart(2, '0');
}

function formatDecimal(value){ return formatPrice(value).slice(2); }

// Dígito verificador de EAN-8, UPC-12, EAN-13 e GTIN-14.
function gtinValido(code){
  if(!/^\d+$/.test(code) || [8, 12, 13, 14].indexOf(code.length) < 0) return false;
  var digits = code.split('').map(Number), check = digits.pop(), sum = 0;
  digits.reverse().forEach(function(d, i){ sum += d * (i % 2 === 0 ? 3 : 1); });
  return (10 - sum % 10) % 10 === check;
}

function normalizeHeader(value){
  return String(value == null ? '' : value).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/\(R\$\)|R\$/g, ' ').replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function columnKind(header){
  var h = normalizeHeader(header);
  if(!h) return null;
  if(/\bBARRAS?\b|\bEAN\b|\bGTIN\b|^C ?BAR$/.test(h)) return 'ean';
  if(/^(QUANTIDADE|QTD|QTDE|QUANT)\b|\bETIQUETAS\b|\bCOPIAS\b/.test(h)) return 'qtd';
  if(/^(PRECO )?DE$|PRECO (ANTIGO|NORMAL|ANTERIOR|CHEIO)/.test(h)) return 'de';
  if(/^(PRECO )?POR$|^PRECO$|PRECO (PROMO|PROMOCIONAL|ATUAL|FINAL|DE VENDA|VENDA)|^VALOR$/.test(h)) return 'por';
  if(/^COD(IGO)?\b|^REFERENCIA$/.test(h)) return 'codigo';
  if(/DESCRI|^PRODUTO$|^NOME\b/.test(h)) return 'descricao';
  return null;
}

function mapColumns(row){
  var map = {};
  (row || []).forEach(function(cell, index){
    var kind = columnKind(cell);
    if(kind && map[kind] === undefined) map[kind] = index;
  });
  return map;
}

function cellText(value){
  if(typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  return cleanText(value);
}

function cellPrice(value){
  var text = cellText(value);
  if(!text) return '';
  var price = parsePrice(value);
  return price === null ? text : formatDecimal(price);
}

// Converte a matriz da planilha (linhas × colunas) nas linhas editáveis da ferramenta.
function parseSheetMatrix(matrix){
  var headerIndex = -1, map = null;
  for(var i = 0; i < Math.min(matrix.length, 30); i++){
    var candidate = mapColumns(matrix[i]);
    if(candidate.descricao !== undefined && candidate.por !== undefined){ headerIndex = i; map = candidate; break; }
  }
  if(headerIndex < 0) throw new Error('Não encontrei as colunas DESCRIÇÃO e PREÇO POR. Use a planilha modelo.');
  var rows = [];
  for(var r = headerIndex + 1; r < matrix.length; r++){
    var line = matrix[r] || [];
    function get(kind){ return map[kind] === undefined ? '' : line[map[kind]]; }
    var row = {
      descricao: cellText(get('descricao')),
      codigo: cellText(get('codigo')),
      ean: cellText(get('ean')).replace(/\s+/g, ''),
      de: cellPrice(get('de')),
      por: cellPrice(get('por')),
      qtd: cellText(get('qtd'))
    };
    if(row.descricao || row.codigo || row.ean || row.de || row.por) rows.push(row);
  }
  return { rows: rows, headerRow: headerIndex + 1, colunas: Object.keys(map) };
}

/* =========================================================================
   REGRAS DA ETIQUETA
   ========================================================================= */
function analyzeRow(row){
  var descricao = cleanText(row.descricao).toLocaleUpperCase('pt-BR');
  var codigo = cleanText(row.codigo), ean = cleanText(row.ean).replace(/\s+/g, '');
  var deTexto = cleanText(row.de), porTexto = cleanText(row.por), qtdTexto = cleanText(row.qtd);
  var de = parsePrice(deTexto), por = parsePrice(porTexto), qtd = 1;
  var erros = [], avisos = [];
  if(qtdTexto !== ''){
    var q = Number(qtdTexto.replace(',', '.'));
    if(Number.isInteger(q) && q >= 0) qtd = q;
    else avisos.push('Quantidade inválida: sai 1 etiqueta');
  }
  if(!descricao) erros.push('Falta a descrição');
  if(por === null || por <= 0) erros.push(porTexto ? 'Preço Por inválido' : 'Falta o preço Por');
  if(deTexto && (de === null || de <= 0)) erros.push('Preço De inválido');
  if(de !== null && de > 0 && por !== null && por > 0 && de <= por) avisos.push('Preço De não é maior que o Por');
  if(ean && !gtinValido(ean)) avisos.push('Código de barras inválido');
  if(qtd > 50) avisos.push('Quantidade alta: confira');
  if(descricao){
    var nome = fitText(descricao, true, LAYOUT.nome.tamanho, LAYOUT.nome.minimo, LAYOUT.larguraUtil * MM);
    if(nome.cortado) avisos.push('Descrição longa: será cortada');
    else if(nome.reduzido) avisos.push('Descrição longa: letra menor');
  }
  if(hasUnsupported(descricao + codigo + ean)) avisos.push('Caractere especial sairá como ?');
  return {
    descricao: descricao, codigo: codigo, ean: ean,
    de: de !== null && de > 0 ? de : null, por: por, qtd: qtd,
    erros: erros, avisos: avisos, imprime: !erros.length && qtd > 0
  };
}

function expandLabels(rows){
  var labels = [];
  rows.forEach(function(row){
    var info = analyzeRow(row);
    if(!info.imprime) return;
    for(var i = 0; i < info.qtd; i++) labels.push(info);
  });
  return labels;
}

function paginate(labels){
  var pages = [];
  for(var i = 0; i < labels.length; i += LAYOUT.porFolha) pages.push(labels.slice(i, i + LAYOUT.porFolha));
  return pages;
}

// Altura da folha para k etiquetas: 6 + 40 + (k − 1) × 49 + 6 mm (6 etiquetas = 297 mm).
function pageHeightMm(count){
  return LAYOUT.margem * 2 + LAYOUT.caixa.altura + LAYOUT.passo * (count - 1);
}

function summarize(rows){
  var analyzed = rows.map(analyzeRow), labels = 0, produtos = 0, comErro = 0, semQuantidade = 0;
  analyzed.forEach(function(info){
    if(info.erros.length) comErro++;
    else if(info.qtd === 0) semQuantidade++;
    else { produtos++; labels += info.qtd; }
  });
  var folhas = Math.ceil(labels / LAYOUT.porFolha), ultima = labels ? labels - (folhas - 1) * LAYOUT.porFolha : 0;
  return { linhas: rows.length, produtos: produtos, etiquetas: labels, folhas: folhas, ultima: ultima, alturaUltima: ultima ? pageHeightMm(ultima) : 0, comErro: comErro, semQuantidade: semQuantidade };
}

/* =========================================================================
   PDF
   Gerador próprio: só fontes padrão (Helvetica), linhas, retângulos e o
   logo. O texto fica como texto (selecionável e editável em editores de PDF).
   ========================================================================= */
function num(value){
  var rounded = Math.round(value * 10000) / 10000;
  return String(rounded === 0 ? 0 : rounded);
}

function pdfString(text){
  var out = '(';
  Array.from(String(text)).forEach(function(ch){
    var code = encodeChar(ch);
    if(code === null) code = 63; // ?
    if(code === 40 || code === 41 || code === 92) out += '\\' + String.fromCharCode(code);
    else if(code < 32 || code > 126) out += '\\' + code.toString(8).padStart(3, '0');
    else out += String.fromCharCode(code);
  });
  return out + ')';
}

function drawLabel(label, top, logo){
  var L = LAYOUT, x = L.textoX * MM, ops = [];
  function text(font, size, tx, ty, value){
    ops.push('BT /' + font + ' ' + num(size) + ' Tf 1 0 0 1 ' + num(tx) + ' ' + num(ty) + ' Tm ' + pdfString(value) + ' Tj ET');
  }
  var g = num(L.caixa.cinza);
  ops.push(g + ' ' + g + ' ' + g + ' RG ' + num(L.caixa.espessura) + ' w');
  ops.push(num(L.caixa.x * MM) + ' ' + num(top - L.caixa.altura * MM) + ' ' + num(L.caixa.largura * MM) + ' ' + num(L.caixa.altura * MM) + ' re S');
  ops.push('0 0 0 rg');

  var nome = fitText(label.descricao, true, L.nome.tamanho, L.nome.minimo, L.larguraUtil * MM);
  text('F2', nome.tamanho, x, top - L.nome.y * MM, nome.texto);
  if(label.codigo){
    var codigo = fitText('Código ' + label.codigo, true, L.codigo.tamanho, L.codigo.minimo, L.larguraAteLogo * MM);
    text('F2', codigo.tamanho, x, top - L.codigo.y * MM, codigo.texto);
  }
  if(label.ean){
    var barras = fitText('C Bar ' + label.ean, false, L.barras.tamanho, L.barras.minimo, L.larguraAteLogo * MM);
    text('F1', barras.tamanho, x, top - L.barras.y * MM, barras.texto);
  }
  if(label.de !== null){
    var yDe = top - L.de.y * MM, deX = x + textWidth('De ', false, L.de.tamanho);
    text('F1', L.de.tamanho, x, yDe, 'De');
    var antigo = fitText(formatPrice(label.de), true, L.de.precoTamanho, L.de.precoMinimo, L.larguraAteLogo * MM - (deX - x));
    text('F2', antigo.tamanho, deX, yDe, antigo.texto);
    var largura = textWidth(antigo.texto, true, antigo.tamanho), yRisco = yDe + L.de.risco * antigo.tamanho;
    ops.push('0 0 0 RG ' + num(L.de.espessura) + ' w ' + num(deX - L.de.folga * MM) + ' ' + num(yRisco) + ' m ' + num(deX + largura + L.de.folga * MM) + ' ' + num(yRisco) + ' l S');
    text('F2', L.por.tamanho, x, top - L.por.y * MM, 'Por');
  }
  var preco = fitText(formatPrice(label.por), true, L.preco.tamanho, L.preco.minimo, L.larguraPreco * MM);
  text('F2', preco.tamanho, x, top - L.preco.y * MM, preco.texto);

  if(logo){
    var lw = L.logo.largura * MM, lh = lw * logo.altura / logo.largura;
    ops.push('q ' + num(lw) + ' 0 0 ' + num(lh) + ' ' + num(L.logo.x * MM) + ' ' + num(top - L.logo.topo * MM - lh) + ' cm /Logo Do Q');
  }
  return ops.join('\n');
}

function drawPage(labels, logo){
  var L = LAYOUT, height = pageHeightMm(labels.length) * MM, ops = [];
  labels.forEach(function(label, i){
    var top = height - (L.margem + L.passo * i) * MM;
    ops.push(drawLabel(label, top, logo));
    if(i < labels.length - 1){
      var y = num(top - L.corte.y * MM), g = num(L.corte.cinza);
      ops.push('[' + num(L.corte.traco) + ' ' + num(L.corte.traco) + '] 0 d ' + g + ' ' + g + ' ' + g + ' RG ' + num(L.corte.espessura) + ' w ' + num(L.corte.x1 * MM) + ' ' + y + ' m ' + num(L.corte.x2 * MM) + ' ' + y + ' l S [] 0 d');
    }
  });
  return { altura: height, conteudo: ops.join('\n') + '\n' };
}

function asciiBytes(str){
  var out = new Uint8Array(str.length);
  for(var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 255;
  return out;
}

function pdfDate(date){
  function two(n){ return String(n).padStart(2, '0'); }
  return 'D:' + date.getFullYear() + two(date.getMonth() + 1) + two(date.getDate()) + two(date.getHours()) + two(date.getMinutes()) + two(date.getSeconds());
}

// labels: saída de expandLabels; logo: { largura, altura, rgb, alfa } com streams Flate.
function buildPdf(labels, logo, options){
  options = options || {};
  var pages = paginate(labels).map(function(page){ return drawPage(page, logo); });
  var parts = [], length = 0, offsets = [];
  function push(bytes){ parts.push(bytes); length += bytes.length; }
  function write(str){ push(asciiBytes(str)); }
  function object(id, dict, stream){
    offsets[id] = length;
    write(id + ' 0 obj\n' + dict.replace('%LEN%', stream ? stream.length : 0));
    if(stream){ write('\nstream\n'); push(stream); write('\nendstream'); }
    write('\nendobj\n');
  }
  var firstPage = logo ? 8 : 6, ids = pages.map(function(_, i){ return { page: firstPage + i * 2, content: firstPage + i * 2 + 1 }; });
  write('%PDF-1.4\n%âãÏÓ\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [' + ids.map(function(o){ return o.page + ' 0 R'; }).join(' ') + '] /Count ' + pages.length + ' >>');
  object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  object(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  object(5, '<< /Producer ' + pdfString('ConfereAI') + ' /Creator ' + pdfString('ConfereAI - Precificação') + ' /Title ' + pdfString('Etiquetas de preço') + ' /CreationDate ' + pdfString(pdfDate(options.data || new Date())) + ' >>');
  if(logo){
    object(6, '<< /Type /XObject /Subtype /Image /Width ' + logo.largura + ' /Height ' + logo.altura + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask 7 0 R /Length %LEN% >>', logo.rgb);
    object(7, '<< /Type /XObject /Subtype /Image /Width ' + logo.largura + ' /Height ' + logo.altura + ' /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length %LEN% >>', logo.alfa);
  }
  var resources = '<< /Font << /F1 3 0 R /F2 4 0 R >>' + (logo ? ' /XObject << /Logo 6 0 R >>' : '') + ' /ProcSet [/PDF /Text /ImageB /ImageC /ImageI] >>';
  pages.forEach(function(page, i){
    object(ids[i].page, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + num(LAYOUT.larguraFolha * MM) + ' ' + num(page.altura) + '] /Resources ' + resources + ' /Contents ' + ids[i].content + ' 0 R >>');
    object(ids[i].content, '<< /Length %LEN% >>', asciiBytes(page.conteudo));
  });
  var total = firstPage + pages.length * 2, xref = length;
  var table = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
  for(var id = 1; id < total; id++) table += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
  write(table + 'trailer\n<< /Size ' + total + ' /Root 1 0 R /Info 5 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  var out = new Uint8Array(length), pos = 0;
  parts.forEach(function(p){ out.set(p, pos); pos += p.length; });
  return out;
}

/* ======================== INTERFACE ======================== */
var STORAGE_MODELO = 'confereai-precificacao-modelo';
var FIELD_LABELS = { descricao: 'Descrição', codigo: 'Código', ean: 'Código de barras', de: 'Preço De', por: 'Preço Por', qtd: 'Quantidade' };
var state = { rows: [], nextId: 1, fileName: '', modelo: 'cor', logos: null, logosErro: false, url: null, timer: null };
try{ var salvo = localStorage.getItem(STORAGE_MODELO); if(salvo === 'cor' || salvo === 'pb') state.modelo = salvo; }catch(e){}

function el(id){ return document.getElementById(id); }
function escapeHtml(value){ return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function plural(n, um, varios){ return n + ' ' + (n === 1 ? um : varios); }

function base64ToBytes(b64){
  var bin = atob(b64), out = new Uint8Array(bin.length);
  for(var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function carregarLogos(){
  try{
    var resp = await fetch('ferramentas/precificacao/logo_etiqueta.json', { cache: 'no-cache' });
    if(!resp.ok) throw new Error('HTTP ' + resp.status);
    var data = await resp.json();
    function decode(m){ return { largura: data.largura, altura: data.altura, rgb: base64ToBytes(m.rgb), alfa: base64ToBytes(m.alfa) }; }
    state.logos = { cor: decode(data.cor), pb: decode(data.pb) };
  }catch(err){
    console.error('Logo das etiquetas:', err);
    state.logosErro = true;
    showToast('Não foi possível carregar o logo das etiquetas. Recarregue a página.', true);
  }
  agendarPrevia(0);
}

/* ---------- Importação ---------- */
var dropzone = el('precDropzone'), fileInput = el('precFileInput');
dropzone.addEventListener('click', function(){ fileInput.click(); });
dropzone.addEventListener('keydown', function(e){ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); fileInput.click(); } });
['dragenter', 'dragover'].forEach(function(ev){ dropzone.addEventListener(ev, function(e){ e.preventDefault(); dropzone.classList.add('drag'); }); });
['dragleave', 'drop'].forEach(function(ev){ dropzone.addEventListener(ev, function(e){ e.preventDefault(); dropzone.classList.remove('drag'); }); });
dropzone.addEventListener('drop', function(e){ var f = (e.dataTransfer.files || [])[0]; if(f) importarArquivo(f); });
fileInput.addEventListener('change', function(){ var f = fileInput.files[0]; fileInput.value = ''; if(f) importarArquivo(f); });

async function importarArquivo(file){
  var ext = file.name.split('.').pop().toLowerCase();
  if(['xlsx', 'xls', 'csv'].indexOf(ext) < 0){ showToast('Formato não suportado: envie .xlsx, .xls ou .csv.', true); return; }
  showOverlay('Lendo planilha…');
  try{
    var wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    var resultado = null, ultimoErro = null;
    for(var i = 0; i < wb.SheetNames.length && !resultado; i++){
      var matrix = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[i]], { header: 1, raw: true, defval: '' });
      try{ resultado = parseSheetMatrix(matrix); }catch(err){ ultimoErro = err; }
    }
    if(!resultado) throw ultimoErro || new Error('Planilha vazia.');
    if(!resultado.rows.length) throw new Error('Não há produtos preenchidos abaixo do cabeçalho.');
    state.rows = resultado.rows.map(function(row){ return Object.assign({ id: state.nextId++ }, row); });
    state.fileName = file.name;
    mostrarTrabalho();
    showToast(plural(resultado.rows.length, 'produto importado', 'produtos importados') + '.');
  }catch(err){
    console.error(err);
    showToast('Erro ao ler a planilha: ' + err.message, true);
  }finally{
    hideOverlay();
  }
}

el('btnPrecModelo').addEventListener('click', function(){
  var aoa = [TEMPLATE_HEADERS].concat(TEMPLATE_EXAMPLES);
  var ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 40 }, { wch: 11 }, { wch: 18 }, { wch: 11 }, { wch: 11 }, { wch: 13 }];
  for(var r = 2; r <= aoa.length; r++) ['D', 'E'].forEach(function(col){ if(ws[col + r]) ws[col + r].z = '0.00'; });
  var info = XLSX.utils.aoa_to_sheet(TEMPLATE_INSTRUCTIONS.map(function(line){ return [line]; }));
  info['!cols'] = [{ wch: 110 }];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Etiquetas');
  XLSX.utils.book_append_sheet(wb, info, 'Como preencher');
  XLSX.writeFile(wb, 'modelo_etiquetas_preco.xlsx');
});

el('btnPrecManual').addEventListener('click', function(){
  if(!state.rows.length){ state.rows = [novaLinha()]; state.fileName = ''; }
  mostrarTrabalho();
  focarLinha(state.rows[state.rows.length - 1].id);
});

function novaLinha(){ return { id: state.nextId++, descricao: '', codigo: '', ean: '', de: '', por: '', qtd: '' }; }

function focarLinha(id){
  var input = document.querySelector('#precBody tr[data-id="' + id + '"] input[data-field="descricao"]');
  if(input){ input.focus(); input.scrollIntoView({ block: 'nearest' }); }
}

function mostrarTrabalho(){
  el('precWork').hidden = false;
  var card = el('precFile');
  card.hidden = !state.fileName;
  el('precFileName').textContent = state.fileName;
  renderTabela();
  atualizarResumo();
  agendarPrevia(0);
}

function limparTudo(){
  state.rows = []; state.fileName = '';
  el('precWork').hidden = true; el('precFile').hidden = true;
  agendarPrevia(0);
}
el('btnPrecLimpar').addEventListener('click', limparTudo);
el('btnPrecRemoverArquivo').addEventListener('click', limparTudo);
el('btnPrecAdd').addEventListener('click', function(){
  var row = novaLinha();
  state.rows.push(row);
  renderTabela(); atualizarResumo();
  focarLinha(row.id);
});

/* ---------- Tabela editável ---------- */
var body = el('precBody');

function inputCell(row, field, cls, placeholder, mode){
  return '<td><input class="prec-in ' + cls + '" data-field="' + field + '" value="' + escapeHtml(row[field]) + '" placeholder="' + placeholder + '"' + (mode ? ' inputmode="' + mode + '"' : '') + ' aria-label="' + FIELD_LABELS[field] + '" autocomplete="off"></td>';
}

function renderTabela(){
  body.innerHTML = state.rows.map(function(row, index){
    return '<tr data-id="' + row.id + '"><td class="prec-idx">' + (index + 1) + '</td>' +
      inputCell(row, 'descricao', 'prec-in-desc', 'Ex.: DIPIRONA 500MG C/10 COMP') +
      inputCell(row, 'codigo', 'prec-in-code', 'Código', 'numeric') +
      inputCell(row, 'ean', 'prec-in-ean', '13 dígitos', 'numeric') +
      inputCell(row, 'de', 'prec-in-money', 'Opcional', 'decimal') +
      inputCell(row, 'por', 'prec-in-money', '0,00', 'decimal') +
      inputCell(row, 'qtd', 'prec-in-qtd', '1', 'numeric') +
      '<td class="prec-status"></td><td class="prec-actions-cell"><button class="prec-remove" type="button" data-remove="' + row.id + '" title="Remover produto" aria-label="Remover produto ' + (index + 1) + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button></td></tr>';
  }).join('');
  Array.from(body.rows).forEach(function(tr){ atualizarLinha(tr, encontrarLinha(tr.dataset.id)); });
}

function encontrarLinha(id){ return state.rows.find(function(row){ return String(row.id) === String(id); }); }

function atualizarLinha(tr, row){
  var info = analyzeRow(row), status = tr.querySelector('.prec-status'), html;
  if(info.erros.length) html = '<span class="badge b-red" title="' + escapeHtml(info.erros.concat(info.avisos).join(' · ')) + '">' + escapeHtml(info.erros[0]) + '</span>';
  else if(info.qtd === 0) html = '<span class="badge b-gray">Não imprime</span>';
  else if(info.avisos.length) html = '<span class="badge b-amber" title="' + escapeHtml(info.avisos.join(' · ')) + '">' + escapeHtml(info.avisos[0]) + '</span>';
  else html = '<span class="badge b-green">' + plural(info.qtd, 'etiqueta', 'etiquetas') + '</span>';
  status.innerHTML = html;
  tr.classList.toggle('prec-row-error', info.erros.length > 0);
  tr.classList.toggle('prec-row-off', !info.erros.length && info.qtd === 0);
  tr.querySelector('[data-field="descricao"]').classList.toggle('prec-invalid', !info.descricao);
  tr.querySelector('[data-field="por"]').classList.toggle('prec-invalid', info.por === null || info.por <= 0);
}

body.addEventListener('input', function(e){
  var input = e.target.closest('input[data-field]');
  if(!input) return;
  var tr = input.closest('tr'), row = encontrarLinha(tr.dataset.id);
  row[input.dataset.field] = input.value;
  atualizarLinha(tr, row); atualizarResumo(); agendarPrevia();
});
body.addEventListener('change', function(e){
  var input = e.target.closest('input[data-field="de"], input[data-field="por"]');
  if(!input) return;
  var price = parsePrice(input.value);
  if(price !== null && price > 0){ input.value = formatDecimal(price); encontrarLinha(input.closest('tr').dataset.id)[input.dataset.field] = input.value; }
});
body.addEventListener('click', function(e){
  var button = e.target.closest('[data-remove]');
  if(!button) return;
  state.rows = state.rows.filter(function(row){ return String(row.id) !== button.dataset.remove; });
  renderTabela(); atualizarResumo(); agendarPrevia(0);
});

function atualizarResumo(){
  var s = summarize(state.rows);
  el('precCount').textContent = plural(s.linhas, 'produto', 'produtos');
  el('precSummary').textContent = s.etiquetas ? plural(s.etiquetas, 'etiqueta', 'etiquetas') + ' · ' + plural(s.folhas, 'folha', 'folhas') : 'Nenhuma etiqueta pronta';
  var linhas = [
    ['Etiquetas', String(s.etiquetas)],
    ['Folhas', s.folhas ? String(s.folhas) : '—'],
    ['Última folha', !s.etiquetas ? '—' : s.ultima === LAYOUT.porFolha ? 'Completa · 297 mm' : plural(s.ultima, 'etiqueta', 'etiquetas') + ' · ' + s.alturaUltima + ' mm']
  ];
  if(s.comErro) linhas.push(['Fora da impressão', plural(s.comErro, 'linha com erro', 'linhas com erro')]);
  if(s.semQuantidade) linhas.push(['Quantidade zero', plural(s.semQuantidade, 'produto', 'produtos')]);
  el('precSheets').innerHTML = linhas.map(function(l){ return '<div><dt>' + l[0] + '</dt><dd>' + escapeHtml(l[1]) + '</dd></div>'; }).join('');
  el('precSheets').classList.toggle('has-errors', s.comErro > 0);
}

/* ---------- Modelo, prévia e saída ---------- */
document.querySelectorAll('input[name="precModelo"]').forEach(function(radio){
  radio.checked = radio.value === state.modelo;
  radio.addEventListener('change', function(){
    if(!radio.checked) return;
    state.modelo = radio.value;
    try{ localStorage.setItem(STORAGE_MODELO, state.modelo); }catch(e){}
    agendarPrevia(0);
  });
});

function agendarPrevia(delay){
  clearTimeout(state.timer);
  state.timer = setTimeout(gerarPrevia, delay === undefined ? 400 : delay);
}

function gerarPrevia(){
  clearTimeout(state.timer);
  var labels = expandLabels(state.rows), pronto = labels.length > 0 && !!state.logos;
  if(state.url){ URL.revokeObjectURL(state.url); state.url = null; }
  el('btnPrecBaixar').disabled = !pronto;
  el('btnPrecImprimir').disabled = !pronto;
  var frame = el('precPreview'), vazio = el('precPreviewEmpty');
  if(!pronto){
    frame.hidden = true; frame.removeAttribute('src');
    vazio.hidden = false;
    el('precPreviewMsg').textContent = state.logosErro ? 'O logo não carregou. Recarregue a página para gerar as etiquetas.' : !state.logos && labels.length ? 'Carregando o logo das etiquetas…' : 'Preencha a descrição e o preço Por de pelo menos um produto.';
    return false;
  }
  var bytes = buildPdf(labels, state.logos[state.modelo]);
  state.url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  frame.src = state.url + '#toolbar=1&navpanes=0&view=FitH';
  frame.hidden = false; vazio.hidden = true;
  return true;
}

function nomeArquivo(){
  var d = new Date();
  return 'etiquetas_' + (state.modelo === 'pb' ? 'pb_' : '') + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '.pdf';
}

el('btnPrecBaixar').addEventListener('click', function(){
  if(!gerarPrevia()) return;
  var a = document.createElement('a');
  a.href = state.url; a.download = nomeArquivo();
  document.body.appendChild(a); a.click(); a.remove();
});
el('btnPrecImprimir').addEventListener('click', function(){
  if(!gerarPrevia()) return;
  var win = window.open(state.url, '_blank');
  if(!win) showToast('O navegador bloqueou a nova aba. Use "Baixar PDF" e imprima pelo arquivo.', true);
});

window.__tool_destroy_precificacao = function(){
  clearTimeout(state.timer);
  if(state.url) URL.revokeObjectURL(state.url);
};

atualizarResumo();
carregarLogos();

}; // end of window.__tool_init_precificacao
