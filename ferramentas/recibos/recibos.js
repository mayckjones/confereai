/* =========================================================================
   ConfereAI — Ferramenta: Gerador de Recibos de Pagamento
   Lógica: Leitura de Excel, Tratamento rigoroso de datas (DD/MM/AAAA),
   conversão por extenso, edição individual, recibo mestre e exportação DOCX.
   ========================================================================= */

window.__tool_init_recibos = function() {
  'use strict';

  // --- DADOS DE EXEMPLO BASEADOS NA PLANILHA FORNECIDA ---
  const SAMPLE_ITEMS = [
    { vendedor: 'BRUNA PAULINO', cpf: '095.262.254-81', valor: 100.00, data: '06/09/2026', loja: '4', cnpj: '24.920.850.0001-76' },
    { vendedor: 'BRUNO RAFAEL LOPES DA SILVA', cpf: '100.143.244-40', valor: 100.00, data: '06/09/2026', loja: '2', cnpj: '13.286.582/0001-66' },
    { vendedor: 'CELIO JOSE DOS SANTOS', cpf: '033.313.484-22', valor: 100.00, data: '06/09/2026', loja: '4', cnpj: '24.920.850.0001-76' },
    { vendedor: 'DARLENE DOS SANTOS', cpf: '047.685.504-79', valor: 100.00, data: '06/09/2026', loja: '1', cnpj: '11.719.336/0001-25' },
    { vendedor: 'DARLENE DOS SANTOS', cpf: '047.685.504-79', valor: 100.00, data: '07/09/2026', loja: '2', cnpj: '13.286.582/0001-66' },
    { vendedor: 'ELLEN CRISTINA ARAUJO DA SILVA', cpf: '079.625.134-70', valor: 90.00, data: '05/09/2026', loja: '3', cnpj: '15.045.542/0001-58' },
    { vendedor: 'ELLEN CRISTINA ARAUJO DA SILVA', cpf: '079.625.134-70', valor: 100.00, data: '07/09/2026', loja: '3', cnpj: '15.045.542/0001-58' },
    { vendedor: 'IRAMAI LAMBERT', cpf: '072.865.194-76', valor: 100.00, data: '06/09/2026', loja: '3', cnpj: '15.045.542/0001-58' },
    { vendedor: 'IRAMAI LAMBERT', cpf: '072.865.194-76', valor: 100.00, data: '07/09/2026', loja: '1', cnpj: '11.719.336/0001-25' },
    { vendedor: 'MANOEL CARLOS GOMES FILHO', cpf: '023.533.984-99', valor: 100.00, data: '06/09/2026', loja: '5', cnpj: '24.920.850/0002-57' },
    { vendedor: 'MARCONI ALVES DA SILVA', cpf: '090.454.294-70', valor: 100.00, data: '06/09/2026', loja: '3', cnpj: '15.045.542/0001-58' },
    { vendedor: 'THAYSE VALDEVINO', cpf: '108.617.924-24', valor: 100.00, data: '07/09/2026', loja: '2', cnpj: '13.286.582/0001-66' },
    { vendedor: 'WILLIAN RONI DE SOUZA OLIVEIRA', cpf: '128.789.864-58', valor: 100.00, data: '06/09/2026', loja: '1', cnpj: '11.719.336/0001-25' },
    { vendedor: 'WILLIAN RONI DE SOUZA OLIVEIRA', cpf: '128.789.864-58', valor: 100.00, data: '07/09/2026', loja: '2', cnpj: '13.286.582/0001-66' },
    { vendedor: 'YURI MEIRELES DA SILVA', cpf: '117.263.714-84', valor: 100.00, data: '07/09/2026', loja: '5', cnpj: '24.920.850/0002-57' }
  ];

  // Função para obter cidade e data atual por extenso automaticamente
  function obterDataAtualPorExtenso(cidade = 'Maceió') {
    const meses = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    const hoje = new Date();
    const dia = String(hoje.getDate()).padStart(2, '0');
    const mes = meses[hoje.getMonth()];
    const ano = hoje.getFullYear();
    return `${cidade}, ${dia} de ${mes} de ${ano}.`;
  }

  // ESTADO DA APLICAÇÃO
  let recibosList = [];
  let currentIndex = 0;
  let mestreConfig = {
    empresa: 'FARMACIA DO TRABALHADOR DE ALAGOAS',
    referente: 'Referente a dobra e alimentação no fim de semana',
    emissao: obterDataAtualPorExtenso('Maceió'),
    loja: '',
    logoUrl: 'ferramentas/recibos/farmacia_logo.jpg'
  };

  // ELEMENTOS DO DOM
  const dropzone = document.getElementById('reciboDropzone');
  const fileInput = document.getElementById('reciboFileInput');
  const fileCard = document.getElementById('reciboFileCard');
  const fileName = document.getElementById('reciboFileName');
  const fileMeta = document.getElementById('reciboFileMeta');
  const demoBanner = document.getElementById('demoBanner');
  const btnLoadSampleData = document.getElementById('btnLoadSampleData');
  const btnRemoverArquivo = document.getElementById('btnRemoverArquivo');
  const btnCarregarExemplo = document.getElementById('btnCarregarExemplo');

  const workspace = document.getElementById('recibosWorkspace');
  const totalRecibosBadge = document.getElementById('totalRecibosBadge');
  const totalValorBadge = document.getElementById('totalValorBadge');

  // Mestre
  const btnToggleMestre = document.getElementById('btnToggleMestre');
  const mestrePanel = document.getElementById('mestrePanel');
  const btnCloseMestre = document.getElementById('btnCloseMestre');
  const btnCancelMestre = document.getElementById('btnCancelMestre');
  const btnApplyMestre = document.getElementById('btnApplyMestre');
  const mestreEmpresa = document.getElementById('mestreEmpresa');
  const mestreCNPJ = document.getElementById('mestreCNPJ');
  const mestreReferente = document.getElementById('mestreReferente');
  const mestreEmissao = document.getElementById('mestreEmissao');
  const mestreLoja = document.getElementById('mestreLoja');
  const mestreLogoInput = document.getElementById('mestreLogoInput');

  // Abas e Navegação
  const tabBtnEditar = document.getElementById('tabBtnEditar');
  const tabBtnTabela = document.getElementById('tabBtnTabela');
  const tabContentEditar = document.getElementById('tabContentEditar');
  const tabContentTabela = document.getElementById('tabContentTabela');
  const tabCount = document.getElementById('tabCount');

  const btnPrevReceipt = document.getElementById('btnPrevReceipt');
  const btnNextReceipt = document.getElementById('btnNextReceipt');
  const currentReceiptNum = document.getElementById('currentReceiptNum');
  const totalReceiptsNum = document.getElementById('totalReceiptsNum');
  const selectReceiptDropdown = document.getElementById('selectReceiptDropdown');

  // Formulário Individual
  const editVendedor = document.getElementById('editVendedor');
  const editLoja = document.getElementById('editLoja');
  const editCPF = document.getElementById('editCPF');
  const editValor = document.getElementById('editValor');
  const editExtenso = document.getElementById('editExtenso');
  const editData = document.getElementById('editData');
  const editCNPJ = document.getElementById('editCNPJ');
  const editEmpresa = document.getElementById('editEmpresa');
  const editReferente = document.getElementById('editReferente');
  const editEmissao = document.getElementById('editEmissao');
  const btnDeleteCurrentReceipt = document.getElementById('btnDeleteCurrentReceipt');
  const btnAddNewReceipt = document.getElementById('btnAddNewReceipt');

  // Tabela
  const recibosTableBody = document.getElementById('recibosTableBody');

  // Preview Word
  const viewLoja = document.getElementById('viewLoja');
  const viewValor = document.getElementById('viewValor');
  const viewVendedor = document.getElementById('viewVendedor');
  const viewCPF = document.getElementById('viewCPF');
  const viewEmpresa = document.getElementById('viewEmpresa');
  const viewCNPJ = document.getElementById('viewCNPJ');
  const viewValorInline = document.getElementById('viewValorInline');
  const viewExtenso = document.getElementById('viewExtenso');
  const viewReferente = document.getElementById('viewReferente');
  const viewData = document.getElementById('viewData');
  const viewSigVendedor = document.getElementById('viewSigVendedor');
  const viewSigCPF = document.getElementById('viewSigCPF');
  const viewEmissao = document.getElementById('viewEmissao');

  // Ações de Download
  const btnDownloadIndividual = document.getElementById('btnDownloadIndividual');
  const btnDownloadAllDocx = document.getElementById('btnDownloadAllDocx');
  const btnDownloadAllPdf = document.getElementById('btnDownloadAllPdf');
  const btnPrintPreview = document.getElementById('btnPrintPreview');


  // =========================================================================
  // FUNÇÃO: NÚMERO POR EXTENSO EM REAIS (ROBUSTA PARA VALORES MONETÁRIOS)
  // =========================================================================
  function numeroParaExtenso(v) {
    const valor = Number(v) || 0;
    if (valor <= 0) return 'zero real';

    const unidades = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
      'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
    const dezenas = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
    const centenas = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

    function converterCentena(n) {
      if (n === 100) return 'cem';
      let r = '';
      const c = Math.floor(n / 100);
      const d = Math.floor((n % 100) / 10);
      const u = n % 10;

      if (c > 0) r += centenas[c];
      const resto = n % 100;
      if (resto > 0) {
        if (r) r += ' e ';
        if (resto < 20) {
          r += unidades[resto];
        } else {
          r += dezenas[d];
          if (u > 0) r += ' e ' + unidades[u];
        }
      }
      return r;
    }

    const inteiro = Math.floor(valor);
    const centavos = Math.round((valor - inteiro) * 100);

    let partes = [];

    if (inteiro > 0) {
      if (inteiro < 1000) {
        const txt = converterCentena(inteiro);
        partes.push(txt + (inteiro === 1 ? ' real' : ' reais'));
      } else {
        const milhar = Math.floor(inteiro / 1000);
        const restoMil = inteiro % 1000;
        let txtMil = '';
        if (milhar === 1) txtMil = 'mil';
        else txtMil = converterCentena(milhar) + ' mil';

        if (restoMil > 0) {
          const juncao = (restoMil < 100 || restoMil % 100 === 0) ? ' e ' : ' ';
          txtMil += juncao + converterCentena(restoMil);
        }
        partes.push(txtMil + ' reais');
      }
    }

    if (centavos > 0) {
      const txtCent = converterCentena(centavos);
      partes.push(txtCent + (centavos === 1 ? ' centavo' : ' centavos'));
    }

    return partes.join(' e ') || 'zero real';
  }


  // =========================================================================
  // TRATAMENTO RIGOROSO DE DATAS (GARANTIR FORMATO DIA/MÊS/ANO)
  // =========================================================================
  function formatarDataEstrita(raw) {
    if (raw === null || raw === undefined || raw === '') return '';

    // Se veio como número do Excel (ex: 46271)
    if (typeof raw === 'number' && raw > 1000) {
      const utcDays = Math.floor(raw - 25569);
      const utcMs = utcDays * 86400 * 1000;
      const d = new Date(utcMs);
      const dia = String(d.getUTCDate()).padStart(2, '0');
      const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
      const ano = d.getUTCFullYear();
      return `${dia}/${mes}/${ano}`;
    }

    const s = String(raw).trim();

    // Se já estiver no padrão DD/MM/AAAA
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const d = m[1].padStart(2, '0');
      const mo = m[2].padStart(2, '0');
      const y = m[3];
      return `${d}/${mo}/${y}`;
    }

    // Se veio no formato ISO AAAA-MM-DD
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      const y = m[1];
      const mo = m[2].padStart(2, '0');
      const d = m[3].padStart(2, '0');
      return `${d}/${mo}/${y}`;
    }

    return s;
  }

  // Formatador de moeda BRL
  function formatarMoeda(val) {
    const n = Number(val) || 0;
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }


  // =========================================================================
  // CARREGAMENTO DE DADOS (IMPORTAÇÃO E AMOSTRA)
  // =========================================================================
  function carregarRecibos(lista, nomeFonte) {
    if (!lista || lista.length === 0) {
      showToast('Nenhum registro encontrado na planilha.', true);
      return;
    }

    // Garante que todo recibo tenha o número da loja (herda da primeira linha ou fallback se vier em branco)
    const lojaPadrao = (mestreConfig.loja && mestreConfig.loja.trim()) || 
                       (lista.find(item => item.loja && String(item.loja).trim())?.loja) || '4';

    recibosList = lista.map(item => {
      const val = typeof item.valor === 'number' ? item.valor : (parseValorBR(item.valor) || 100.00);
      const dataFormatada = formatarDataEstrita(item.data);
      const extensoAuto = item.extenso || numeroParaExtenso(val);
      const lojaItem = (item.loja && String(item.loja).trim()) ? String(item.loja).trim() : String(lojaPadrao).trim();

      return {
        vendedor: String(item.vendedor || item.nome || '').trim().toUpperCase(),
        cpf: String(item.cpf || '').trim(),
        valor: val,
        extenso: extensoAuto,
        data: dataFormatada,
        loja: lojaItem,
        cnpj: String(item.cnpj || '').trim(),
        empresa: item.empresa || mestreConfig.empresa,
        referente: item.referente || mestreConfig.referente,
        emissao: item.emissao || mestreConfig.emissao
      };
    });

    currentIndex = 0;

    // Atualiza status do arquivo
    dropzone.style.display = 'none';
    demoBanner.style.display = 'none';
    fileCard.style.display = 'flex';
    fileName.textContent = nomeFonte || 'Planilha_de_Pagamentos.xlsx';
    fileMeta.textContent = `${recibosList.length} recibos processados • Todas as datas no padrão DD/MM/AAAA`;

    workspace.style.display = 'block';

    atualizarResumoHeader();
    popularDropdown();
    preencherFormularioEPreview();
    renderizarTabela();
    atualizarContainerImpressaoGeral();

    showToast(`${recibosList.length} recibos gerados com sucesso!`);
  }

  function atualizarResumoHeader() {
    const total = recibosList.length;
    const soma = recibosList.reduce((acc, r) => acc + (Number(r.valor) || 0), 0);
    totalRecibosBadge.textContent = `${total} ${total === 1 ? 'Recibo Gerado' : 'Recibos Gerados'}`;
    totalValorBadge.textContent = `Total: R$ ${formatarMoeda(soma)} • Formato estrito Dia/Mês/Ano`;
    tabCount.textContent = total;
  }

  function popularDropdown() {
    selectReceiptDropdown.innerHTML = '';
    recibosList.forEach((r, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `${idx + 1}. ${r.vendedor || 'Sem Nome'} (R$ ${formatarMoeda(r.valor)})`;
      selectReceiptDropdown.appendChild(opt);
    });
  }

  // Preenche formulário individual e sincroniza a folha de preview Word
  function preencherFormularioEPreview() {
    if (recibosList.length === 0) return;

    if (currentIndex < 0) currentIndex = 0;
    if (currentIndex >= recibosList.length) currentIndex = recibosList.length - 1;

    const r = recibosList[currentIndex];

    // Atualiza controles de navegação
    currentReceiptNum.textContent = currentIndex + 1;
    totalReceiptsNum.textContent = recibosList.length;
    selectReceiptDropdown.value = currentIndex;
    btnPrevReceipt.disabled = (currentIndex === 0);
    btnNextReceipt.disabled = (currentIndex === recibosList.length - 1);

    // Formulário
    editVendedor.value = r.vendedor || '';
    editLoja.value = r.loja || '';
    editCPF.value = r.cpf || '';
    editValor.value = formatarMoeda(r.valor);
    editExtenso.value = r.extenso || numeroParaExtenso(r.valor);
    editData.value = r.data || '';
    editCNPJ.value = r.cnpj || '';
    editEmpresa.value = r.empresa || mestreConfig.empresa;
    editReferente.value = r.referente || mestreConfig.referente;
    editEmissao.value = r.emissao || mestreConfig.emissao;

    // PREVIEW WORD EM TEMPO REAL
    viewLoja.textContent = r.loja || '—';
    viewValor.textContent = formatarMoeda(r.valor);
    viewVendedor.textContent = r.vendedor || 'NOME DO VENDEDOR';
    viewCPF.textContent = r.cpf || '000.000.000-00';
    viewEmpresa.textContent = r.empresa || mestreConfig.empresa;
    viewCNPJ.textContent = r.cnpj || '00.000.000/0000-00';
    viewValorInline.textContent = formatarMoeda(r.valor);
    viewExtenso.textContent = r.extenso || numeroParaExtenso(r.valor);
    viewReferente.textContent = r.referente || mestreConfig.referente;
    viewData.textContent = r.data || 'DD/MM/AAAA';
    viewSigVendedor.textContent = r.vendedor || 'NOME DO VENDEDOR';
    viewSigCPF.textContent = r.cpf || '000.000.000-00';
    viewEmissao.textContent = r.emissao || mestreConfig.emissao;

    destacarLinhaTabela();
  }

  // Sincroniza campos do formulário para o array de recibos conforme o usuário digita
  function salvarCamposFormulario() {
    if (recibosList.length === 0) return;
    const r = recibosList[currentIndex];

    r.vendedor = editVendedor.value.trim().toUpperCase();
    r.loja = editLoja.value.trim();
    r.cpf = editCPF.value.trim();
    r.valor = parseValorBR(editValor.value) || 0;
    r.extenso = editExtenso.value.trim() || numeroParaExtenso(r.valor);
    r.data = formatarDataEstrita(editData.value.trim());
    r.cnpj = editCNPJ.value.trim();
    r.empresa = editEmpresa.value.trim();
    r.referente = editReferente.value.trim();
    r.emissao = editEmissao.value.trim();

    // Atualiza preview imediatamente
    viewLoja.textContent = r.loja || '—';
    viewValor.textContent = formatarMoeda(r.valor);
    viewVendedor.textContent = r.vendedor;
    viewCPF.textContent = r.cpf;
    viewEmpresa.textContent = r.empresa;
    viewCNPJ.textContent = r.cnpj;
    viewValorInline.textContent = formatarMoeda(r.valor);
    viewExtenso.textContent = r.extenso;
    viewReferente.textContent = r.referente;
    viewData.textContent = r.data;
    viewSigVendedor.textContent = r.vendedor;
    viewSigCPF.textContent = r.cpf;
    viewEmissao.textContent = r.emissao;

    // Atualiza texto no dropdown
    const opt = selectReceiptDropdown.options[currentIndex];
    if (opt) {
      opt.textContent = `${currentIndex + 1}. ${r.vendedor || 'Sem Nome'} (R$ ${formatarMoeda(r.valor)})`;
    }

    atualizarResumoHeader();
    atualizarContainerImpressaoGeral();
  }

  // Escuta inputs no formulário individual
  [editVendedor, editLoja, editCPF, editCNPJ, editEmpresa, editReferente, editEmissao].forEach(input => {
    input.addEventListener('input', salvarCamposFormulario);
  });

  editValor.addEventListener('input', () => {
    const val = parseValorBR(editValor.value);
    if (!isNaN(val)) {
      editExtenso.value = numeroParaExtenso(val);
    }
    salvarCamposFormulario();
  });

  editExtenso.addEventListener('input', salvarCamposFormulario);
  editData.addEventListener('blur', () => {
    editData.value = formatarDataEstrita(editData.value);
    salvarCamposFormulario();
  });


  // =========================================================================
  // TABELA GERAL DE RECIBOS
  // =========================================================================
  function renderizarTabela() {
    recibosTableBody.innerHTML = '';
    recibosList.forEach((r, idx) => {
      const tr = document.createElement('tr');
      tr.id = `row-receipt-${idx}`;
      if (idx === currentIndex) tr.classList.add('active-row');

      tr.innerHTML = `
        <td><strong>${idx + 1}</strong></td>
        <td>${r.vendedor || '—'}</td>
        <td class="font-mono">${r.cpf || '—'}</td>
        <td class="font-mono">R$ ${formatarMoeda(r.valor)}</td>
        <td class="font-mono">${r.data || '—'}</td>
        <td>${r.loja || '—'}</td>
        <td class="font-mono">${r.cnpj || '—'}</td>
        <td>
          <button class="btn-row-action" data-index="${idx}">Selecionar</button>
        </td>
      `;

      tr.querySelector('.btn-row-action').addEventListener('click', () => {
        currentIndex = idx;
        preencherFormularioEPreview();
        tabBtnEditar.click();
      });

      recibosTableBody.appendChild(tr);
    });
  }

  function destacarLinhaTabela() {
    recibosTableBody.querySelectorAll('tr').forEach((tr, i) => {
      tr.classList.toggle('active-row', i === currentIndex);
    });
  }


  // =========================================================================
  // EVENTOS DE NAVEGAÇÃO ENTRE RECIBOS
  // =========================================================================
  btnPrevReceipt.addEventListener('click', () => {
    if (currentIndex > 0) {
      currentIndex--;
      preencherFormularioEPreview();
    }
  });

  btnNextReceipt.addEventListener('click', () => {
    if (currentIndex < recibosList.length - 1) {
      currentIndex++;
      preencherFormularioEPreview();
    }
  });

  selectReceiptDropdown.addEventListener('change', () => {
    currentIndex = parseInt(selectReceiptDropdown.value, 10);
    preencherFormularioEPreview();
  });

  btnAddNewReceipt.addEventListener('click', () => {
    const novo = {
      vendedor: 'NOVO VENDEDOR',
      cpf: '000.000.000-00',
      valor: 100.00,
      extenso: 'cem reais',
      data: '06/09/2026',
      loja: '1',
      cnpj: '24.920.850.0001-76',
      empresa: mestreConfig.empresa,
      referente: mestreConfig.referente,
      emissao: mestreConfig.emissao
    };
    recibosList.push(novo);
    currentIndex = recibosList.length - 1;
    popularDropdown();
    preencherFormularioEPreview();
    renderizarTabela();
    showToast('Novo recibo adicionado.');
  });

  btnDeleteCurrentReceipt.addEventListener('click', () => {
    if (recibosList.length <= 1) {
      showToast('A lista precisa conter pelo menos um recibo.', true);
      return;
    }
    const nome = recibosList[currentIndex].vendedor;
    if (confirm(`Deseja realmente remover o recibo de "${nome}"?`)) {
      recibosList.splice(currentIndex, 1);
      if (currentIndex >= recibosList.length) {
        currentIndex = recibosList.length - 1;
      }
      popularDropdown();
      preencherFormularioEPreview();
      renderizarTabela();
      showToast('Recibo removido.');
    }
  });


  // =========================================================================
  // RECIBO MESTRE (CONFIGURAÇÃO E EDIÇÃO EM MASSA)
  // =========================================================================
  btnToggleMestre.addEventListener('click', () => {
    const isVisible = mestrePanel.style.display !== 'none';
    if (!isVisible) {
      mestreEmpresa.value = mestreConfig.empresa;
      mestreReferente.value = mestreConfig.referente;
      mestreEmissao.value = mestreConfig.emissao;
      if (mestreLoja) mestreLoja.value = mestreConfig.loja || '';
    }
    mestrePanel.style.display = isVisible ? 'none' : 'block';
  });

  btnCloseMestre.addEventListener('click', () => { mestrePanel.style.display = 'none'; });
  btnCancelMestre.addEventListener('click', () => { mestrePanel.style.display = 'none'; });

  btnApplyMestre.addEventListener('click', () => {
    const novaEmpresa = mestreEmpresa.value.trim();
    const novoReferente = mestreReferente.value.trim();
    const novaEmissao = mestreEmissao.value.trim();
    const novoCNPJ = mestreCNPJ.value.trim();
    const novaLoja = mestreLoja ? mestreLoja.value.trim() : '';

    mestreConfig.empresa = novaEmpresa;
    mestreConfig.referente = novoReferente;
    mestreConfig.emissao = novaEmissao;
    if (novaLoja) mestreConfig.loja = novaLoja;

    recibosList.forEach(r => {
      r.empresa = novaEmpresa;
      r.referente = novoReferente;
      r.emissao = novaEmissao;
      if (novoCNPJ) {
        r.cnpj = novoCNPJ;
      }
      if (novaLoja) {
        r.loja = novaLoja;
      }
    });

    preencherFormularioEPreview();
    renderizarTabela();
    atualizarContainerImpressaoGeral();
    mestrePanel.style.display = 'none';
    showToast(`Alterações do Mestre aplicadas a todos os ${recibosList.length} recibos!`);
  });

  // Atualização de Logotipo via Upload na UI
  if (mestreLogoInput) {
    mestreLogoInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        mestreConfig.logoUrl = ev.target.result;
        atualizarLogoVisualizacao();
        atualizarContainerImpressaoGeral();
        showToast('Novo logotipo aplicado com sucesso!');
      };
      reader.readAsDataURL(file);
    });
  }

  function atualizarLogoVisualizacao() {
    const previewImg = document.querySelector('#viewLogo img');
    if (previewImg && mestreConfig.logoUrl) {
      previewImg.src = mestreConfig.logoUrl;
    }
  }


  // =========================================================================
  // ABAS (EDITAR vs TABELA)
  // =========================================================================
  tabBtnEditar.addEventListener('click', () => {
    tabBtnEditar.classList.add('active');
    tabBtnTabela.classList.remove('active');
    tabContentEditar.style.display = 'block';
    tabContentTabela.style.display = 'none';
  });

  tabBtnTabela.addEventListener('click', () => {
    tabBtnTabela.classList.add('active');
    tabBtnEditar.classList.remove('active');
    tabContentTabela.style.display = 'block';
    tabContentEditar.style.display = 'none';
    renderizarTabela();
  });


  // =========================================================================
  // IMPORTAÇÃO DE ARQUIVOS VIA XLSX
  // =========================================================================
  function processarArquivoPlanilha(file) {
    if (!file) return;
    showOverlay('Lendo e processando planilha de pagamentos…');

    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: false });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawJson = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: true });

        if (!rawJson || rawJson.length === 0) {
          hideOverlay();
          showToast('A planilha enviada está vazia.', true);
          return;
        }

        // Mapeador inteligente de colunas com propagação de loja para células mescladas/em branco
        let lastSeenLoja = '';
        const items = rawJson.map(row => {
          let vendedor = '', cpf = '', valor = 0, dataVal = '', loja = '', cnpj = '';

          for (const key of Object.keys(row)) {
            const cleanKey = key.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

            if (cleanKey.includes('VENDEDOR') || cleanKey.includes('NOME') || cleanKey.includes('FUNCIONARIO')) {
              vendedor = row[key];
            } else if (cleanKey.includes('CPF')) {
              cpf = row[key];
            } else if (cleanKey.includes('VALOR') || cleanKey.includes('VL') || cleanKey.includes('TOTAL')) {
              valor = row[key];
            } else if (cleanKey.includes('DATA') || cleanKey.includes('DT')) {
              dataVal = row[key];
            } else if (cleanKey.includes('LOJA') || cleanKey.includes('FILIAL')) {
              loja = row[key];
            } else if (cleanKey.includes('CNPJ')) {
              cnpj = row[key];
            }
          }

          if (loja && String(loja).trim()) {
            lastSeenLoja = String(loja).trim();
          } else if (lastSeenLoja) {
            loja = lastSeenLoja;
          }

          return {
            vendedor: vendedor,
            cpf: cpf,
            valor: valor,
            data: dataVal,
            loja: loja,
            cnpj: cnpj
          };
        }).filter(item => item.vendedor || item.cpf || item.valor);

        hideOverlay();
        carregarRecibos(items, file.name);

      } catch (err) {
        hideOverlay();
        console.error(err);
        showToast('Erro ao processar planilha. Verifique o formato do arquivo.', true);
      }
    };

    reader.onerror = function() {
      hideOverlay();
      showToast('Falha ao ler o arquivo.', true);
    };

    reader.readAsArrayBuffer(file);
  }

  // Eventos de Upload e Drag & Drop
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      processarArquivoPlanilha(e.target.files[0]);
    }
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag');
  });

  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processarArquivoPlanilha(e.dataTransfer.files[0]);
    }
  });

  btnLoadSampleData.addEventListener('click', () => {
    carregarRecibos(SAMPLE_ITEMS, 'Planilha_Exemplo_Farmacia.xlsx');
  });

  btnCarregarExemplo.addEventListener('click', () => {
    carregarRecibos(SAMPLE_ITEMS, 'Planilha_Exemplo_Farmacia.xlsx');
  });

  btnRemoverArquivo.addEventListener('click', () => {
    recibosList = [];
    workspace.style.display = 'none';
    fileCard.style.display = 'none';
    dropzone.style.display = 'block';
    demoBanner.style.display = 'flex';
    fileInput.value = '';
    showToast('Planilha removida.');
  });


  // =========================================================================
  // EXPORTAÇÃO EM WORD (.DOCX) - FORMATADO E FIEL AO MODELO
  // =========================================================================
  
  // Função auxiliar para gerar os parágrafos de um recibo no padrão docx
  function gerarParagrafosReciboDocx(docxLib, r) {
    const { Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } = docxLib;

    const valorFmt = formatarMoeda(r.valor);
    const extensoTexto = r.extenso || numeroParaExtenso(r.valor);
    const dataFmt = r.data || '';

    // Converte Base64 para Uint8Array para uso no ImageRun do docx
    let logoUint8 = null;
    if (window.FARMACIA_LOGO_BASE64) {
      try {
        const bin = atob(window.FARMACIA_LOGO_BASE64);
        const len = bin.length;
        logoUint8 = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          logoUint8[i] = bin.charCodeAt(i);
        }
      } catch(e) {
        console.warn('Erro ao decodificar imagem do logo', e);
      }
    }

    // Elementos internos do card do recibo
    const cardElements = [];

    // Logotipo Real da Farmácia (se disponível)
    if (logoUint8) {
      cardElements.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [
            new ImageRun({
              data: logoUint8,
              transformation: { width: 52, height: 52 }
            })
          ],
          spacing: { before: 0, after: 120 }
        })
      );
    } else {
      cardElements.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [
            new TextRun({
              text: "FARMÁCIA DO TRABALHADOR DE ALAGOAS",
              bold: true,
              size: 18,
              color: "D82B27",
              font: "Calibri"
            })
          ],
          spacing: { before: 40, after: 140 }
        })
      );
    }

    // TÍTULO RECIBO
    cardElements.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: "RECIBO",
            bold: true,
            size: 42, // 21pt
            color: "111111",
            font: "Calibri"
          })
        ],
        spacing: { before: 120, after: 320 }
      })
    );

    // VALOR EM DESTAQUE À DIREITA
    cardElements.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            text: `R$ ${valorFmt}`,
            bold: true,
            size: 28, // 14pt
            color: "111111",
            font: "Calibri"
          })
        ],
        spacing: { before: 0, after: 340 }
      })
    );

    // CORPO DO TEXTO
    cardElements.push(
      new Paragraph({
        alignment: AlignmentType.BOTH,
        children: [
          new TextRun({ text: "Eu, ", size: 22, font: "Calibri" }),
          new TextRun({ text: r.vendedor, bold: true, size: 22, font: "Calibri" }),
          new TextRun({ text: ", inscrito no CPF de número: ", size: 22, font: "Calibri" }),
          new TextRun({ text: r.cpf, bold: true, size: 22, font: "Calibri" }),
          new TextRun({ text: ". Recebi da ", size: 22, font: "Calibri" }),
          new TextRun({ text: r.empresa, size: 22, font: "Calibri" }),
          new TextRun({ text: ", inscrita no CNPJ: ", size: 22, font: "Calibri" }),
          new TextRun({ text: r.cnpj, size: 22, font: "Calibri" }),
          new TextRun({ text: ` A importância de R$ ${valorFmt} (${extensoTexto}). `, size: 22, font: "Calibri" }),
          new TextRun({ text: `${r.referente} nesta data `, size: 22, font: "Calibri" }),
          new TextRun({ text: dataFmt, bold: true, size: 22, font: "Calibri" }),
          new TextRun({ text: ".", size: 22, font: "Calibri" })
        ],
        spacing: { line: 360, before: 60, after: 600 }
      })
    );

    // LINHA DE ASSINATURA E IDENTIFICAÇÃO
    cardElements.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: "_____________________________________",
            size: 22,
            font: "Calibri",
            color: "222222"
          })
        ],
        spacing: { before: 300, after: 60 }
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: r.vendedor,
            bold: true,
            size: 22,
            font: "Calibri",
            color: "111111"
          })
        ],
        spacing: { before: 0, after: 30 }
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: r.cpf,
            bold: true,
            size: 22,
            font: "Calibri",
            color: "111111"
          })
        ],
        spacing: { before: 0, after: 440 }
      }),
      // CIDADE E DATA DE EMISSÃO
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: r.emissao,
            size: 21,
            font: "Calibri",
            color: "222222"
          })
        ],
        spacing: { before: 100, after: 100 }
      })
    );

    // Moldura elegante do recibo com margens generosas
    const cardTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 12, color: "222222" },
        bottom: { style: BorderStyle.SINGLE, size: 12, color: "222222" },
        left: { style: BorderStyle.SINGLE, size: 12, color: "222222" },
        right: { style: BorderStyle.SINGLE, size: 12, color: "222222" }
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: cardElements,
              margins: { top: 380, bottom: 500, left: 550, right: 550 }
            })
          ]
        })
      ]
    });

    return [
      // Número da Loja no topo à direita
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            text: r.loja || "",
            bold: true,
            size: 24,
            font: "Calibri"
          })
        ],
        spacing: { before: 0, after: 120 }
      }),
      cardTable
    ];
  }

  // Garante que a biblioteca docx esteja carregada
  async function assegurarDocx() {
    if (window.docx && window.saveAs) return true;

    // Se docx ainda não estiver no window, tenta carregar sob demanda
    if (!window.docx) {
      await new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'js/vendor/docx.umd.js';
        s.onload = resolve;
        s.onerror = () => {
          // Fallback para CDN
          const cdn = document.createElement('script');
          cdn.src = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js';
          cdn.onload = resolve;
          cdn.onerror = resolve;
          document.head.appendChild(cdn);
        };
        document.head.appendChild(s);
      });
    }

    if (!window.saveAs) {
      await new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js';
        s.onload = resolve;
        s.onerror = resolve;
        document.head.appendChild(s);
      });
    }

    return (typeof window.docx !== 'undefined');
  }

  // Baixar TODOS em um só Word (.docx)
  async function baixarTodosEmWord() {
    if (recibosList.length === 0) {
      showToast('Nenhum recibo para exportar.', true);
      return;
    }

    showOverlay('Preparando biblioteca e gerando Word…');
    const pronta = await assegurarDocx();

    if (!pronta || typeof window.docx === 'undefined') {
      hideOverlay();
      showToast('Biblioteca DOCX não carregada. Verifique sua conexão.', true);
      return;
    }

    const docxLib = window.docx;

    try {
      const { Document, Packer, PageBreak, Paragraph } = docxLib;

      const allChildren = [];

      recibosList.forEach((r, idx) => {
        const paragrafos = gerarParagrafosReciboDocx(docxLib, r);
        allChildren.push(...paragrafos);

        // Se não for o último recibo, insere quebra de página oficial do Word
        if (idx < recibosList.length - 1) {
          allChildren.push(new Paragraph({
            children: [new PageBreak()]
          }));
        }
      });

      const doc = new Document({
        sections: [{
          properties: {
            page: {
              margin: { top: 1100, bottom: 1100, left: 1100, right: 1100 }
            }
          },
          children: allChildren
        }]
      });

      const blob = await Packer.toBlob(doc);
      saveAs(blob, `Recibos_Consolidados_Todos_${recibosList.length}.docx`);
      hideOverlay();
      showToast('Documento Word baixado com sucesso!');

    } catch (err) {
      hideOverlay();
      console.error(err);
      showToast('Erro ao gerar arquivo Word.', true);
    }
  }

  // =========================================================================
  // EXPORTAÇÃO EM PDF (INDIVIDUAL E CONSOLIDADO)
  // =========================================================================

  // Função auxiliar para gerar o HTML do recibo para PDF e Impressão
  function gerarHtmlReciboParaPdf(r) {
    const valorFmt = formatarMoeda(r.valor);
    const extensoFmt = r.extenso || numeroParaExtenso(r.valor);
    const lojaTexto = (r.loja && String(r.loja).trim()) || (mestreConfig.loja && String(mestreConfig.loja).trim()) || '';

    return `
      <!-- Cabeçalho idêntico à imagem de referência: Discreto no topo direito da folha A4 -->
      <div class="print-discreet-header" style="position:absolute; top:11mm; right:18mm; font-size:11px; font-weight:500; color:#555555; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; letter-spacing:0.2px;">
        <span>${lojaTexto}</span>
      </div>

      <!-- Moldura do Recibo Centralizada na Folha e Levemente Elevada -->
      <div style="width:100%; border:2px solid #222222; border-radius:60px; padding:44px 38px 48px; position:relative; background:#ffffff; box-sizing:border-box;">
        <div style="position:absolute; top:24px; left:26px;">
          <img src="${mestreConfig.logoUrl || 'ferramentas/recibos/farmacia_logo.jpg'}" alt="Logo" style="width:55px; height:55px; object-fit:contain; border-radius:3px; display:block;">
        </div>
        <h1 style="font-size:27px; font-weight:800; text-align:center; color:#111111; margin:28px 0 32px; letter-spacing:1px;">RECIBO</h1>
        <div style="text-align:right; font-size:19px; font-weight:800; color:#111111; margin-bottom:26px; padding-right:4px;">
          R$ ${valorFmt}
        </div>
        <div style="font-size:14.5px; line-height:1.75; color:#111111; text-align:justify; margin-bottom:44px; word-break:break-word;">
          Eu, <strong>${r.vendedor}</strong>, inscrito no CPF de número: <strong>${r.cpf}</strong>. 
          Recebi da ${r.empresa}, inscrita no CNPJ: ${r.cnpj} A importância de R$ ${valorFmt} 
          (${extensoFmt}). ${r.referente} nesta data <strong>${r.data}</strong>.
        </div>
        <div style="text-align:center; margin:45px auto 30px; max-width:480px;">
          <div style="font-size:14px; color:#222222; margin-bottom:10px; letter-spacing:-0.5px; white-space:nowrap;">_______________________________________________________</div>
          <div style="font-size:14px; font-weight:800; color:#111111; text-transform:uppercase; margin-bottom:4px;">${r.vendedor}</div>
          <div style="font-size:13.5px; font-weight:700; color:#111111;">${r.cpf}</div>
        </div>
        <div style="text-align:center; font-size:13.5px; color:#222222; margin-top:28px; font-weight:500;">
          ${r.emissao}
        </div>
      </div>
    `;
  }

  // Sincroniza o container de impressão com todos os recibos
  function atualizarContainerImpressaoGeral() {
    const printContainer = document.getElementById('printAllContainer');
    if (!printContainer) return;
    printContainer.innerHTML = '';

    recibosList.forEach((r) => {
      const pageDiv = document.createElement('div');
      pageDiv.className = 'print-page';
      pageDiv.innerHTML = gerarHtmlReciboParaPdf(r);
      printContainer.appendChild(pageDiv);
    });
  }

  // Baixar Recibo Atual em PDF
  async function baixarReciboIndividualPdf() {
    if (recibosList.length === 0) {
      showToast('Nenhum recibo selecionado.', true);
      return;
    }

    if (typeof html2pdf === 'undefined') {
      showToast('Biblioteca PDF não carregada. Recarregue a página.', true);
      return;
    }

    const r = recibosList[currentIndex];
    showOverlay(`Gerando PDF de ${r.vendedor}…`);

    try {
      // Cria elemento no fluxo da página com opacidade e z-index para o html2canvas capturar com precisão
      const printWrap = document.createElement('div');
      printWrap.style.position = 'fixed';
      printWrap.style.left = '0';
      printWrap.style.top = '0';
      printWrap.style.width = '794px';
      printWrap.style.padding = '40px 38px';
      printWrap.style.boxSizing = 'border-box';
      printWrap.style.background = '#ffffff';
      printWrap.style.zIndex = '-99999';
      printWrap.style.pointerEvents = 'none';

      printWrap.innerHTML = gerarHtmlReciboParaPdf(r);
      document.body.appendChild(printWrap);

      // Aguarda renderização de imagem e layout
      await new Promise(res => setTimeout(res, 200));

      const safeName = (r.vendedor || 'Recibo').replace(/[^a-zA-Z0-9]/g, '_');
      const safeData = (r.data || '').replace(/\//g, '-');

      const opt = {
        margin: [4, 4, 4, 4],
        filename: `Recibo_${safeName}_${safeData || currentIndex + 1}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false, scrollY: 0, scrollX: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      await html2pdf().set(opt).from(printWrap).save();

      printWrap.remove();
      hideOverlay();
      showToast('Recibo PDF baixado com sucesso!');

    } catch (err) {
      hideOverlay();
      console.error(err);
      showToast('Erro ao gerar arquivo PDF.', true);
    }
  }

  // Baixar TODOS em um só PDF
  async function baixarTodosEmPdf() {
    if (recibosList.length === 0) {
      showToast('Nenhum recibo para exportar.', true);
      return;
    }

    if (typeof html2pdf === 'undefined') {
      showToast('Biblioteca PDF não carregada. Recarregue a página.', true);
      return;
    }

    showOverlay(`Gerando PDF com todos os ${recibosList.length} recibos…`);

    try {
      const printWrap = document.createElement('div');
      printWrap.style.position = 'fixed';
      printWrap.style.left = '0';
      printWrap.style.top = '0';
      printWrap.style.width = '794px';
      printWrap.style.background = '#ffffff';
      printWrap.style.zIndex = '-99999';
      printWrap.style.pointerEvents = 'none';

      recibosList.forEach((r, idx) => {
        const pageDiv = document.createElement('div');
        pageDiv.style.width = '794px';
        pageDiv.style.minHeight = '1120px';
        pageDiv.style.padding = '45px 38px';
        pageDiv.style.boxSizing = 'border-box';
        pageDiv.style.background = '#ffffff';
        pageDiv.style.pageBreakAfter = (idx < recibosList.length - 1) ? 'always' : 'auto';

        pageDiv.innerHTML = gerarHtmlReciboParaPdf(r);
        printWrap.appendChild(pageDiv);
      });

      document.body.appendChild(printWrap);

      // Aguarda renderização de layout e fontes
      await new Promise(res => setTimeout(res, 300));

      const opt = {
        margin: [4, 4, 4, 4],
        filename: `Recibos_Consolidados_Todos_${recibosList.length}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false, scrollY: 0, scrollX: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] }
      };

      await html2pdf().set(opt).from(printWrap).save();

      printWrap.remove();
      hideOverlay();
      showToast('Todos os recibos foram baixados em PDF com sucesso!');

    } catch (err) {
      hideOverlay();
      console.error(err);
      showToast('Erro ao gerar arquivo PDF consolidado.', true);
    }
  }

  // Garante sincronia antes de qualquer impressão e suprime o título padrão "confereai"
  let originalDocumentTitle = document.title;
  const handleBeforePrint = () => {
    atualizarContainerImpressaoGeral();
    originalDocumentTitle = document.title;
    document.title = ' '; // Evita que o navegador imprima "confereai" no topo
  };

  const handleAfterPrint = () => {
    document.title = originalDocumentTitle || 'ConfereAI';
  };

  window.addEventListener('beforeprint', handleBeforePrint);
  window.addEventListener('afterprint', handleAfterPrint);

  // Bindings dos botões de download e impressão
  if (btnDownloadAllPdf) btnDownloadAllPdf.addEventListener('click', baixarTodosEmPdf);
  if (btnDownloadIndividual) btnDownloadIndividual.addEventListener('click', baixarReciboIndividualPdf);
  if (btnPrintPreview) {
    btnPrintPreview.addEventListener('click', () => {
      atualizarContainerImpressaoGeral();
      const prevTitle = document.title;
      document.title = ' ';
      window.print();
      setTimeout(() => {
        document.title = prevTitle || 'ConfereAI';
      }, 1000);
    });
  }

  // Limpeza de recursos caso a rota mude
  window.__tool_destroy_recibos = function() {
    window.removeEventListener('beforeprint', handleBeforePrint);
    window.removeEventListener('afterprint', handleAfterPrint);
    recibosList = [];
  };
};
