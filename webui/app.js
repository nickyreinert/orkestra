const projectPathEl = document.getElementById('projectPath');
const projectInput = document.getElementById('projectInput');
const entitySearch = document.getElementById('entitySearch');
const entityTree = document.getElementById('entityTree');
const agentMatrix = document.getElementById('agentMatrix');
const statusText = document.getElementById('statusText');

const entityIdEl = document.getElementById('entityId');
const entityNameEl = document.getElementById('entityName');
const entityDescriptionEl = document.getElementById('entityDescription');
const entityVersionEl = document.getElementById('entityVersion');
const entityAuthorEl = document.getElementById('entityAuthor');
const entityAgentsEl = document.getElementById('entityAgents');
const entityConflictsEl = document.getElementById('entityConflicts');
const entityTagsEl = document.getElementById('entityTags');
const entityPreview = document.getElementById('entityPreview');
const installBtn = document.getElementById('installBtn');
const disableBtn = document.getElementById('disableBtn');
const viewFileBtn = document.getElementById('viewFileBtn');

let appState = {
  scope: 'global',
  entities: [],
  categories: [],
  agents: [],
  selectedAgents: new Set(),
  selectedId: '',
  query: '',
};

function setStatus(message, kind = '') {
  statusText.textContent = message || '';
  statusText.className = 'statusText' + (kind ? ` ${kind}` : '');
}

async function apiGet(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

async function apiPost(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function currentEntity() {
  return appState.entities.find((entity) => entity.id === appState.selectedId) || appState.entities[0] || null;
}

function isInstalled(entity) {
  return Boolean(entity && entity.installed && entity.installed[appState.scope]);
}

function isBlocked(entity) {
  if (!entity || !Array.isArray(entity.conflictsWith)) return false;
  return entity.conflictsWith.some((id) => {
    const conflict = appState.entities.find((item) => item.id === id);
    return isInstalled(conflict);
  });
}

function matchesQuery(entity) {
  const query = appState.query.trim().toLowerCase();
  if (!query) return true;
  const haystack = [
    entity.id,
    entity.name,
    entity.description,
    ...(entity.tags || []),
  ].join(' ').toLowerCase();
  return haystack.includes(query);
}

function formatList(values) {
  if (!Array.isArray(values) || values.length === 0) return '-';
  return values.join(', ');
}

function renderScopeControls() {
  document.querySelectorAll('.segment').forEach((button) => {
    button.classList.toggle('active', button.dataset.scope === appState.scope);
    button.onclick = () => {
      appState.scope = button.dataset.scope;
      render();
    };
  });
}

function renderAgents() {
  agentMatrix.innerHTML = '';
  appState.agents.forEach((agent) => {
    if (!appState.selectedAgents.has(agent)) appState.selectedAgents.add(agent);
    const label = document.createElement('label');
    label.className = 'agentCheck';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = appState.selectedAgents.has(agent);
    input.onchange = () => {
      if (input.checked) appState.selectedAgents.add(agent);
      else appState.selectedAgents.delete(agent);
    };

    const span = document.createElement('span');
    span.textContent = agent;

    label.appendChild(input);
    label.appendChild(span);
    agentMatrix.appendChild(label);
  });
}

function renderTree() {
  entityTree.innerHTML = '';
  const selected = currentEntity();
  const groups = appState.categories
    .map((category) => ({
      ...category,
      entities: category.entities.filter(matchesQuery),
    }))
    .filter((category) => category.entities.length > 0);

  groups.forEach((category) => {
    const section = document.createElement('section');
    section.className = 'category';

    const header = document.createElement('div');
    header.className = 'categoryHeader';
    header.textContent = `${category.label} (${category.entities.length})`;
    section.appendChild(header);

    category.entities.forEach((entity) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'entityRow';
      row.classList.toggle('active', selected && selected.id === entity.id);
      row.classList.toggle('installed', isInstalled(entity));
      row.classList.toggle('blocked', isBlocked(entity));
      row.title = entity.description || entity.id;
      row.onclick = () => {
        appState.selectedId = entity.id;
        render();
      };

      const dot = document.createElement('span');
      dot.className = 'stateDot';

      const label = document.createElement('span');
      label.className = 'entityLabel';
      label.textContent = entity.id;

      const install = document.createElement('span');
      install.className = 'miniButton tooltipTarget tooltipLeft';
      install.role = 'button';
      install.tabIndex = 0;
      install.setAttribute('aria-label', `Install ${entity.id}`);
      install.dataset.tooltip = `Install ${entity.id} into selected scope`;
      install.textContent = '+';
      install.onclick = (event) => {
        event.stopPropagation();
        appState.selectedId = entity.id;
        installSelected();
      };
      install.onkeydown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        appState.selectedId = entity.id;
        installSelected();
      };

      const open = document.createElement('span');
      open.className = 'miniButton tooltipTarget tooltipLeft';
      open.role = 'button';
      open.tabIndex = 0;
      open.setAttribute('aria-label', `Show source path for ${entity.id}`);
      open.dataset.tooltip = `Show source path: ${entity.path}`;
      open.textContent = '↗';
      open.onclick = (event) => {
        event.stopPropagation();
        appState.selectedId = entity.id;
        render();
        setStatus(entity.path);
      };
      open.onkeydown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        appState.selectedId = entity.id;
        render();
        setStatus(entity.path);
      };

      row.appendChild(dot);
      row.appendChild(label);
      row.appendChild(install);
      row.appendChild(open);
      section.appendChild(row);
    });

    entityTree.appendChild(section);
  });
}

function renderDetails() {
  const entity = currentEntity();
  if (!entity) {
    entityIdEl.textContent = 'Select an entity';
    entityNameEl.textContent = 'No entity selected';
    entityDescriptionEl.textContent = 'Choose an entity from the sidebar.';
    entityPreview.textContent = '# Preview';
    installBtn.disabled = true;
    disableBtn.disabled = true;
    viewFileBtn.disabled = true;
    return;
  }

  appState.selectedId = entity.id;
  entityIdEl.textContent = `${entity.id}${entity.version ? `  v${entity.version}` : ''}`;
  entityNameEl.textContent = entity.name;
  entityDescriptionEl.textContent = entity.description || 'No description.';
  entityVersionEl.textContent = entity.version || '-';
  entityAuthorEl.textContent = entity.author || '-';
  entityAgentsEl.textContent = formatList(entity.agents);
  entityConflictsEl.textContent = formatList(entity.conflictsWith);
  entityTagsEl.textContent = formatList(entity.tags);
  entityPreview.textContent = entity.content || '# Empty entity';

  const installed = isInstalled(entity);
  installBtn.disabled = installed || isBlocked(entity);
  installBtn.textContent = installed ? 'Installed' : 'Install into scope';
  disableBtn.disabled = !installed;
  viewFileBtn.disabled = false;
  viewFileBtn.setAttribute('aria-label', `Show source path for ${entity.id}`);
  viewFileBtn.dataset.tooltip = `Show source path: ${entity.path}`;
}

function render() {
  renderScopeControls();
  renderAgents();
  renderTree();
  renderDetails();
}

async function refresh() {
  const data = await apiGet('/api/entities');
  appState.entities = data.entities || [];
  appState.categories = data.categories || [];
  appState.agents = data.agents || [];
  if (appState.agents.length === 0) appState.agents = ['codex'];
  appState.agents.forEach((agent) => appState.selectedAgents.add(agent));

  const projectPath = data.project?.path || '';
  projectPathEl.textContent = projectPath;
  projectInput.value = projectPath;
  if (!appState.selectedId && appState.entities.length) {
    appState.selectedId = appState.entities[0].id;
  }
  render();
}

async function installSelected() {
  const entity = currentEntity();
  if (!entity) return;
  try {
    setStatus(`Installing ${entity.id} ...`);
    const data = await apiPost('/api/entities/enable', {
      id: entity.id,
      scope: appState.scope,
      agents: Array.from(appState.selectedAgents),
    });
    appState.entities = data.entities.entities || [];
    appState.categories = data.entities.categories || [];
    setStatus(`Installed ${entity.id}`, 'ok');
    render();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function disableSelected() {
  const entity = currentEntity();
  if (!entity) return;
  try {
    setStatus(`Disabling ${entity.id} ...`);
    const data = await apiPost('/api/entities/disable', {
      id: entity.id,
      scope: appState.scope,
    });
    appState.entities = data.entities.entities || [];
    appState.categories = data.entities.categories || [];
    setStatus(`Disabled ${entity.id}`, 'ok');
    render();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

entitySearch.addEventListener('input', () => {
  appState.query = entitySearch.value;
  renderTree();
});

installBtn.addEventListener('click', installSelected);
disableBtn.addEventListener('click', disableSelected);
viewFileBtn.addEventListener('click', () => {
  const entity = currentEntity();
  if (entity) setStatus(entity.path);
});

refresh().catch((error) => {
  setStatus(error.message, 'error');
});
