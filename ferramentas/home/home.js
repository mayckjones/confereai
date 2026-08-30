/* =========================================================================
   ConfereAI — Home Page Logic
   Gera os cards de ferramentas a partir do TOOLS_REGISTRY.
   ========================================================================= */

window.__tool_init_home = function(){
  const grid = document.getElementById('toolsGrid');
  const emptyEl = document.getElementById('toolsEmpty');
  const searchInput = document.getElementById('toolSearch');
  if(!grid) return;

  function renderCards(filter){
    grid.innerHTML = '';
    const query = (filter || '').toLowerCase().trim();

    // Group by category
    const categories = {};
    TOOLS_REGISTRY.forEach(tool => {
      if(query && !tool.name.toLowerCase().includes(query) && !tool.description.toLowerCase().includes(query)){
        return;
      }
      const cat = tool.category || 'Geral';
      if(!categories[cat]) categories[cat] = [];
      categories[cat].push(tool);
    });

    const catKeys = Object.keys(categories);
    if(catKeys.length === 0){
      emptyEl.style.display = 'block';
      grid.style.display = 'none';
      return;
    }
    emptyEl.style.display = 'none';
    grid.style.display = '';

    // If only one category, skip the header
    const showCatHeaders = catKeys.length > 1;

    catKeys.forEach(cat => {
      if(showCatHeaders){
        const catHeader = document.createElement('div');
        catHeader.className = 'tools-category';
        catHeader.style.gridColumn = '1 / -1';
        catHeader.innerHTML = `<div class="tools-category-title">${cat}</div>`;
        grid.appendChild(catHeader);
      }

      categories[cat].forEach(tool => {
        const card = document.createElement('a');
        card.className = 'tool-card';
        card.href = `#/${tool.id}`;
        card.setAttribute('data-tool-id', tool.id);

        const bgColor = tool.color + '14'; // 8% opacity
        const badgeHtml = tool.badge
          ? `<span class="tool-card-badge ${tool.badge.toLowerCase() === 'beta' ? 'beta' : ''}">${tool.badge}</span>`
          : '';

        card.innerHTML = `
          ${badgeHtml}
          <div class="tool-card-icon" style="background:${bgColor}; color:${tool.color};">
            ${tool.icon}
          </div>
          <h3 class="tool-card-name">${tool.name}</h3>
          <p class="tool-card-desc">${tool.description}</p>
        `;

        grid.appendChild(card);
      });
    });
  }

  renderCards('');

  // Search filter
  if(searchInput){
    searchInput.addEventListener('input', () => renderCards(searchInput.value));
  }

  // Cleanup function registered globally for the router to call
  window.__tool_destroy_home = function(){
    // The router will remove the DOM nodes anyway, but this is here for the spec
  };
};
