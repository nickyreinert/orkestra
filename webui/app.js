const projectInput = document.getElementById('projectInput');
const entitySearch = document.getElementById('entitySearch');
const entityTree = document.getElementById('entityTree');
const agentMatrix = document.getElementById('agentMatrix');
const statusText = document.getElementById('statusText');
const commandBtn = document.getElementById('commandBtn');
const settingsBtn = document.getElementById('settingsBtn');
const helpBtn = document.getElementById('helpBtn');
const topbarPopover = document.getElementById('topbarPopover');
const floatingTooltip = document.getElementById('floatingTooltip');

const entityIdEl = document.getElementById('entityId');
const entityNameEl = document.getElementById('entityName');
const entityDescriptionEl = document.getElementById('entityDescription');
const entityVersionEl = document.getElementById('entityVersion');
const entityAuthorEl = document.getElementById('entityAuthor');
const entityAgentsEl = document.getElementById('entityAgents');
const entityConflictsEl = document.getElementById('entityConflicts');
const entityTagsEl = document.getElementById('entityTags');
const entityPreview = document.getElementById('entityPreview');

let appState = {
  scope: 'global',
  entities: [],
  categories: [],
  agents: [],
  selectedAgents: new Set(),
  collapsedCategories: new Set(),
  selectedId: '',
  query: '',
  activePopover: '',
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

function selectedAgentList() {
  return Array.from(appState.selectedAgents);
}

function closePopover() {
  appState.activePopover = '';
  topbarPopover.hidden = true;
  topbarPopover.innerHTML = '';
}

function positionPopover(anchor) {
  const anchorRect = anchor.getBoundingClientRect();
  const popoverRect = topbarPopover.getBoundingClientRect();
  const gap = 8;
  const left = Math.min(
    window.innerWidth - popoverRect.width - gap,
    Math.max(gap, anchorRect.right - popoverRect.width),
  );
  topbarPopover.style.left = `${left}px`;
  topbarPopover.style.top = `${anchorRect.bottom + gap}px`;
}

function openPopover(kind, anchor) {
  if (appState.activePopover === kind && !topbarPopover.hidden) {
    closePopover();
    return;
  }

  appState.activePopover = kind;
  topbarPopover.hidden = false;
  topbarPopover.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'popoverTitle';
  title.textContent = kind === 'commands' ? 'Commands' : kind === 'settings' ? 'Settings' : 'Help';
  topbarPopover.appendChild(title);

  if (kind === 'commands') {
    [
      ['Focus search', () => entitySearch.focus()],
      ['Toggle scope', () => {
        appState.scope = appState.scope === 'global' ? 'project' : 'global';
        render();
      }],
      ['Select first entity', () => {
        if (appState.entities[0]) appState.selectedId = appState.entities[0].id;
        render();
      }],
    ].forEach(([label, action]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'popoverAction';
      button.textContent = label;
      button.onclick = () => {
        action();
        closePopover();
      };
      topbarPopover.appendChild(button);
    });
  } else if (kind === 'settings') {
    const rows = [
      ['Scope', appState.scope],
      ['Agents', selectedAgentList().join(', ') || 'none'],
      ['Project', projectInput.value || '-'],
    ];
    rows.forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'popoverMeta';
      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      const valueEl = document.createElement('strong');
      valueEl.textContent = value;
      row.appendChild(labelEl);
      row.appendChild(valueEl);
      topbarPopover.appendChild(row);
    });
  } else {
    [
      '+ installs an available entity into the current scope.',
      '- removes an installed entity from the current scope.',
      'Category headers collapse or expand their entity lists.',
      'Use Ctrl/Command K to focus search.',
    ].forEach((text) => {
      const item = document.createElement('div');
      item.className = 'popoverHelp';
      item.textContent = text;
      topbarPopover.appendChild(item);
    });
  }

  positionPopover(anchor);
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

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'categoryHeader';
    const collapsed = appState.collapsedCategories.has(category.id) && !appState.query.trim();
    header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    const chevron = document.createElement('span');
    chevron.textContent = collapsed ? '▸' : '▾';
    const label = document.createElement('strong');
    label.textContent = category.label;
    const count = document.createElement('em');
    count.textContent = String(category.entities.length);
    header.appendChild(chevron);
    header.appendChild(label);
    header.appendChild(count);
    header.onclick = () => {
      if (appState.collapsedCategories.has(category.id)) appState.collapsedCategories.delete(category.id);
      else appState.collapsedCategories.add(category.id);
      renderTree();
    };
    section.appendChild(header);

    if (collapsed) {
      entityTree.appendChild(section);
      return;
    }

    category.entities.forEach((entity) => {
      const installed = isInstalled(entity);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'entityRow';
      row.classList.toggle('active', selected && selected.id === entity.id);
      row.classList.toggle('installed', installed);
      row.classList.toggle('blocked', isBlocked(entity));
      row.setAttribute('aria-label', `Select ${entity.id}`);
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
      install.setAttribute('aria-label', `${installed ? 'Remove' : 'Install'} ${entity.id}`);
      install.dataset.tooltip = installed
        ? `Remove ${entity.id} from ${appState.scope} scope`
        : `Install ${entity.id} into ${appState.scope} scope`;
      install.textContent = installed ? '-' : '+';
      install.onclick = (event) => {
        event.stopPropagation();
        appState.selectedId = entity.id;
        if (installed) disableSelected();
        else installSelected();
      };
      install.onkeydown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        appState.selectedId = entity.id;
        if (installed) disableSelected();
        else installSelected();
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
  statusText.textContent = entity.path || '';
  statusText.className = 'statusText';
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

commandBtn.addEventListener('click', () => openPopover('commands', commandBtn));
settingsBtn.addEventListener('click', () => openPopover('settings', settingsBtn));
helpBtn.addEventListener('click', () => openPopover('help', helpBtn));

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    entitySearch.focus();
    closePopover();
  }
  if (event.key === 'Escape') closePopover();
});

document.addEventListener('click', (event) => {
  if (
    topbarPopover.hidden ||
    topbarPopover.contains(event.target) ||
    commandBtn.contains(event.target) ||
    settingsBtn.contains(event.target) ||
    helpBtn.contains(event.target)
  ) {
    return;
  }
  closePopover();
});

function showTooltip(target) {
  const text = target.dataset.tooltip;
  if (!text) return;
  floatingTooltip.textContent = text;
  floatingTooltip.hidden = false;

  const gap = 8;
  const targetRect = target.getBoundingClientRect();
  const tipRect = floatingTooltip.getBoundingClientRect();
  const left = Math.min(
    window.innerWidth - tipRect.width - gap,
    Math.max(gap, targetRect.left + targetRect.width / 2 - tipRect.width / 2),
  );
  const below = targetRect.bottom + gap;
  const top = below + tipRect.height + gap > window.innerHeight
    ? Math.max(gap, targetRect.top - tipRect.height - gap)
    : below;

  floatingTooltip.style.left = `${left}px`;
  floatingTooltip.style.top = `${top}px`;
}

function hideTooltip() {
  floatingTooltip.hidden = true;
}

document.addEventListener('pointerover', (event) => {
  const target = event.target.closest('.tooltipTarget');
  if (target) showTooltip(target);
});
document.addEventListener('pointerout', (event) => {
  if (event.target.closest('.tooltipTarget')) hideTooltip();
});
document.addEventListener('focusin', (event) => {
  const target = event.target.closest('.tooltipTarget');
  if (target) showTooltip(target);
});
document.addEventListener('focusout', (event) => {
  if (event.target.closest('.tooltipTarget')) hideTooltip();
});

refresh().catch((error) => {
  setStatus(error.message, 'error');
});
