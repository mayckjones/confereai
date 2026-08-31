/* =========================================================================
   ConfereAI — SPA Router
   Navegação por hash entre ferramentas carregando arquivos externos dinamicamente.
   ========================================================================= */

const Router = (function(){
  const contentEl = () => document.getElementById('app-content');
  let currentTool = null;
  let currentCSS = null;
  let currentJS = null;

  function getRoute(){
    const hash = location.hash.replace(/^#\/?/, '') || 'home';
    return hash;
  }

  async function loadTool(toolId){
    const container = contentEl();
    if(!container) return;

    // Se estiver rodando via file:// exibe aviso
    if(window.location.protocol === 'file:'){
      container.innerHTML = `
        <div class="empty-state" style="padding:80px 20px;">
          <div class="es-icon" style="background:var(--red-bg);color:var(--red);">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </div>
          <h4>Servidor Local Necessário</h4>
          <p>Para carregar as ferramentas externas, você precisa rodar este projeto em um servidor local (ex: Live Server no VSCode), pois navegadores bloqueiam o uso de <code>fetch()</code> no protocolo <code>file://</code>.</p>
        </div>
      `;
      return;
    }

    try {
      showOverlay('Carregando ferramenta…');

      // Cleanup
      if(currentCSS){ currentCSS.remove(); currentCSS = null; }
      if(currentJS){ currentJS.remove(); currentJS = null; }
      if(currentTool && window['__tool_destroy_' + currentTool]){
        try{ window['__tool_destroy_' + currentTool](); }catch(e){}
        delete window['__tool_destroy_' + currentTool];
      }
      if(currentTool && window['__tool_init_' + currentTool]){
        delete window['__tool_init_' + currentTool];
      }

      currentTool = toolId;
      container.innerHTML = ''; // Limpa a tela antiga imediatamente

      // Paths
      const basePath = `ferramentas/${toolId}/${toolId}`;
      const htmlPath = `${basePath}.html`;
      const cssPath = `${basePath}.css`;
      const jsPath = `${basePath}.js`;

      // 1. Fetch HTML
      const response = await fetch(htmlPath);
      if(!response.ok) throw new Error('Ferramenta não encontrada');
      const html = await response.text();
      container.innerHTML = html;

      // Trigger fade-in animation
      container.style.animation = 'none';
      container.offsetHeight; // reflow
      container.style.animation = '';

      // 2. Load CSS
      currentCSS = document.createElement('link');
      currentCSS.rel = 'stylesheet';
      currentCSS.href = cssPath;
      document.head.appendChild(currentCSS);

      // 3. Load JS
      currentJS = document.createElement('script');
      currentJS.src = jsPath;
      currentJS.onload = () => {
        // Se a ferramenta exportar uma função de init, executamos
        if(window['__tool_init_' + toolId]){
          window['__tool_init_' + toolId]();
        }
      };
      document.body.appendChild(currentJS);

      updateNavActive(toolId);
    } catch (err) {
      console.error('Erro ao carregar rota:', err);
      container.innerHTML = `
        <div class="empty-state" style="padding:80px 20px;">
          <div class="es-icon" style="background:var(--red-bg);color:var(--red);">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </div>
          <h4>Ferramenta não encontrada</h4>
          <p>A ferramenta "${toolId}" não existe ou ocorreu um erro no carregamento.</p>
          <br>
          <a href="#/home" class="btn btn-primary" style="display:inline-flex;">Voltar para o início</a>
        </div>
      `;
    } finally {
      hideOverlay();
    }
  }

  function updateNavActive(toolId){
    document.querySelectorAll('.topbar-nav-btn').forEach(btn => {
      const route = (btn.getAttribute('href') || '').replace('#/', '');
      btn.classList.toggle('active', route === toolId);
    });
  }

  function init(){
    window.addEventListener('hashchange', () => loadTool(getRoute()));
    loadTool(getRoute());
  }

  return { init, getRoute };
})();

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', () => Router.init());
} else {
  Router.init();
}
