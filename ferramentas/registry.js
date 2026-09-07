/* =========================================================================
   ConfereAI — Registro Central de Ferramentas
   Cada ferramenta que exista no sistema deve ser registrada aqui.
   O card na página inicial é gerado automaticamente a partir deste array.
   ========================================================================= */

const TOOLS_REGISTRY = [
  {
    id: 'conciliacao',
    name: 'Conciliação Bancária',
    description: 'Compare relatorios de caixa com extratos para identificar divergências automaticamente.',
    icon: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
      <rect x="9" y="3" width="6" height="4" rx="2"/>
      <path d="M9 14l2 2 4-4"/>
    </svg>`,
    category: 'Financeiro',
    badge: null,
    color: '#0056FF'
  },
  {
    id: 'recibos',
    name: 'Gerador de Recibos',
    description: 'Crie recibos automáticos em PDF a partir de planilhas com revisão individual e em massa.',
    icon: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>`,
    category: 'Financeiro',
    badge: 'Novo',
    color: '#0284c7'
  }
  // ───────────────────────────────────────────────
  // Para adicionar uma nova ferramenta, copie o modelo abaixo:
  // ───────────────────────────────────────────────
  // ,{
  //   id: 'nome-da-ferramenta',         // slug usado na URL: #/nome-da-ferramenta
  //   name: 'Nome da Ferramenta',       // título exibido no card
  //   description: 'Breve descrição do que faz.',
  //   icon: `<svg ...></svg>`,           // ícone SVG inline (24x24)
  //   category: 'Categoria',
  //   badge: null,                       // ou 'Nova', 'Beta', etc.
  //   color: '#16a34a'                   // cor de destaque do ícone
  // }
];
