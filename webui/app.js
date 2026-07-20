const projectInput = document.getElementById('projectInput');
const entitySearch = document.getElementById('entitySearch');
const entityTree = document.getElementById('entityTree');
const agentMatrix = document.getElementById('agentMatrix');
const domainFilters = document.getElementById('domainFilters');
const sourcePathText = document.getElementById('sourcePathText');
const installedPathText = document.getElementById('installedPathText');
const commandBtn = document.getElementById('commandBtn');
const settingsBtn = document.getElementById('settingsBtn');
const helpBtn = document.getElementById('helpBtn');
const topbarPopover = document.getElementById('topbarPopover');
const floatingTooltip = document.getElementById('floatingTooltip');
const saveContentBtn = document.getElementById('saveContentBtn');

const entityIdEl = document.getElementById('entityId');
const entityNameEl = document.getElementById('entityName');
const entityDescriptionEl = document.getElementById('entityDescription');
const entityVersionEl = document.getElementById('entityVersion');
const entityAuthorEl = document.getElementById('entityAuthor');
const entityAgentsEl = document.getElementById('entityAgents');
const entityDomainEl = document.getElementById('entityDomain');
const entityTypeEl = document.getElementById('entityType');
const entityConflictsEl = document.getElementById('entityConflicts');
const entityTagsEl = document.getElementById('entityTags');
const entityPreview = document.getElementById('entityPreview');

let appState = {
  scope: 'global',
  entities: [],
  categories: [],
  categoryTree: [],
  domains: [],
  activeDomains: new Set(['guidance', 'enforcement', 'automation']),
  agents: [],
  selectedAgents: new Set(),
  collapsedCategories: new Set(),
  selectedId: '',
  editingContentId: '',
  contentDirty: false,
  query: '',
  activePopover: '',
};

function setStatus(message, kind = '') {
  installedPathText.textContent = message || 'Not installed in current scope';
  installedPathText.className = 'pathValue' + (kind ? ` ${kind}` : '');
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

function matchesDomain(entity) {
  return appState.activeDomains.has(entity.domain || 'guidance');
}

function formatList(values) {
  if (!Array.isArray(values) || values.length === 0) return '-';
  return values.join(', ');
}

function domainIndicator(domain) {
  if (domain === 'enforcement') return '◈';
  if (domain === 'automation') return '▶';
  return '◇';
}

function domainLabel(entity) {
  const domain = entity?.domain || 'guidance';
  return `${domainIndicator(domain)} ${domain}`;
}

function selectedAgentList() {
  return Array.from(appState.selectedAgents);
}

function selectEntity(id) {
  if (id === appState.selectedId) return;
  if (appState.contentDirty && !window.confirm('Discard unsaved plugin edits?')) return;
  appState.contentDirty = false;
  appState.editingContentId = '';
  appState.selectedId = id;
  render();
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
      ['Select first plugin', () => {
        if (appState.entities[0]) selectEntity(appState.entities[0].id);
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
      '+ installs an available plugin into the current scope.',
      '- removes an installed plugin from the current scope.',
      'Category and subcategory headers collapse or expand their plugin lists.',
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

function renderDomainFilters() {
  domainFilters.innerHTML = '';
  appState.domains.forEach((domain) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `domainChip ${domain.id}`;
    button.classList.toggle('active', appState.activeDomains.has(domain.id));
    button.setAttribute('aria-pressed', appState.activeDomains.has(domain.id) ? 'true' : 'false');
    button.textContent = `${domain.indicator} ${domain.label}: ${domain.count}`;
    button.onclick = () => {
      if (appState.activeDomains.has(domain.id)) appState.activeDomains.delete(domain.id);
      else appState.activeDomains.add(domain.id);
      if (appState.activeDomains.size === 0) appState.activeDomains.add(domain.id);
      render();
    };
    domainFilters.appendChild(button);
  });
}

function renderTree() {
  entityTree.innerHTML = '';
  const selected = currentEntity();
  const tree = appState.categoryTree
    .map((main) => ({
      ...main,
      subcategories: main.subcategories
        .map((sub) => ({
          ...sub,
          entities: sub.entities.filter((entity) => matchesQuery(entity) && matchesDomain(entity)),
        }))
        .filter((sub) => sub.entities.length > 0),
    }))
    .filter((main) => main.subcategories.length > 0);

  tree.forEach((main) => {
    const mainSection = document.createElement('section');
    mainSection.className = 'category mainCategory';

    const mainHeader = document.createElement('button');
    mainHeader.type = 'button';
    mainHeader.className = 'categoryHeader mainCategoryHeader';
    const mainCollapsed = appState.collapsedCategories.has(main.id) && !appState.query.trim();
    const total = main.subcategories.reduce((count, sub) => count + sub.entities.length, 0);
    mainHeader.setAttribute('aria-expanded', mainCollapsed ? 'false' : 'true');
    const mainChevron = document.createElement('span');
    mainChevron.textContent = mainCollapsed ? '▸' : '▾';
    const mainLabel = document.createElement('strong');
    mainLabel.textContent = main.label;
    const mainCount = document.createElement('em');
    mainCount.textContent = String(total);
    mainHeader.appendChild(mainChevron);
    mainHeader.appendChild(mainLabel);
    mainHeader.appendChild(mainCount);
    mainHeader.onclick = () => {
      if (appState.collapsedCategories.has(main.id)) appState.collapsedCategories.delete(main.id);
      else appState.collapsedCategories.add(main.id);
      renderTree();
    };
    mainSection.appendChild(mainHeader);

    if (mainCollapsed) {
      entityTree.appendChild(mainSection);
      return;
    }

    main.subcategories.forEach((category) => {
      const section = document.createElement('section');
      section.className = 'subcategory';

      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'categoryHeader subcategoryHeader';
      const collapsed = appState.collapsedCategories.has(category.id) && !appState.query.trim();
      header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      const chevron = document.createElement('span');
      chevron.textContent = collapsed ? '▸' : '▾';
      const subLabel = document.createElement('strong');
      subLabel.textContent = category.label;
      const subId = document.createElement('span');
      subId.className = 'subcategoryId';
      subId.textContent = category.id;
      const count = document.createElement('em');
      count.textContent = String(category.entities.length);
      header.appendChild(chevron);
      header.appendChild(subLabel);
      header.appendChild(subId);
      header.appendChild(count);
      header.onclick = () => {
        if (appState.collapsedCategories.has(category.id)) appState.collapsedCategories.delete(category.id);
        else appState.collapsedCategories.add(category.id);
        renderTree();
      };
      section.appendChild(header);

      if (collapsed) {
        mainSection.appendChild(section);
        return;
      }

      category.entities.forEach((entity) => {
        const installed = isInstalled(entity);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `entityRow ${entity.domain || 'guidance'}`;
        row.classList.toggle('active', selected && selected.id === entity.id);
        row.classList.toggle('installed', installed);
        row.classList.toggle('blocked', isBlocked(entity));
        row.setAttribute('aria-label', `Select plugin ${entity.id}`);
        row.onclick = () => selectEntity(entity.id);

        const indicator = document.createElement('span');
        indicator.className = 'domainIndicator';
        indicator.textContent = domainIndicator(entity.domain);

        const label = document.createElement('span');
        label.className = 'entityLabel';
        const name = document.createElement('strong');
        name.textContent = entity.name || entity.id;
        const meta = document.createElement('small');
        meta.textContent = entity.id;
        label.appendChild(name);
        label.appendChild(meta);

        const install = document.createElement('span');
        install.className = 'miniButton tooltipTarget tooltipLeft';
        install.role = 'button';
        install.tabIndex = 0;
        install.setAttribute('aria-label', `${installed ? 'Remove' : 'Install'} plugin ${entity.id}`);
        install.dataset.tooltip = installed
          ? `Remove plugin ${entity.id} from ${appState.scope} scope`
          : `Install plugin ${entity.id} into ${appState.scope} scope`;
        install.textContent = installed ? '-' : '+';
        install.onclick = (event) => {
          event.stopPropagation();
          selectEntity(entity.id);
          if (appState.selectedId !== entity.id) return;
          if (installed) disableSelected();
          else installSelected();
        };
        install.onkeydown = (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          selectEntity(entity.id);
          if (appState.selectedId !== entity.id) return;
          if (installed) disableSelected();
          else installSelected();
        };

        const open = document.createElement('span');
        open.className = 'miniButton tooltipTarget tooltipLeft';
        open.role = 'button';
        open.tabIndex = 0;
        open.setAttribute('aria-label', `Show source path for plugin ${entity.id}`);
        open.dataset.tooltip = `Show source path: ${entity.path}`;
        open.textContent = '↗';
        open.onclick = (event) => {
          event.stopPropagation();
          selectEntity(entity.id);
          if (appState.selectedId !== entity.id) return;
          render();
          setStatus(entity.path);
        };
        open.onkeydown = (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          selectEntity(entity.id);
          if (appState.selectedId !== entity.id) return;
          render();
          setStatus(entity.path);
        };

        row.appendChild(indicator);
        row.appendChild(label);
        row.appendChild(install);
        row.appendChild(open);
        section.appendChild(row);
      });

      mainSection.appendChild(section);
    });

    entityTree.appendChild(mainSection);
  });
}


function renderDetails() {
  const entity = currentEntity();
  if (!entity) {
    entityIdEl.textContent = 'Select a plugin';
    entityNameEl.textContent = 'No plugin selected';
    entityDescriptionEl.value = 'Choose a plugin from the sidebar.';
    entityDescriptionEl.disabled = true;
    entityPreview.value = '# Content';
    entityPreview.disabled = true;
    saveContentBtn.disabled = true;
    sourcePathText.textContent = '-';
    installedPathText.textContent = 'Not installed in current scope';
    installedPathText.className = 'pathValue';
    return;
  }

  appState.selectedId = entity.id;
  entityIdEl.textContent = `${entity.id}${entity.version ? `  v${entity.version}` : ''}`;
  entityNameEl.textContent = entity.name;
  entityDescriptionEl.disabled = false;
  entityVersionEl.textContent = entity.version || '-';
  entityAuthorEl.textContent = entity.author || '-';
  entityAgentsEl.textContent = formatList(entity.agents);
  entityDomainEl.textContent = domainLabel(entity);
  entityTypeEl.textContent = entity.entrypoint
    ? `${entity.type} · ${entity.runtime || '-'} · ${entity.entrypoint}`
    : entity.type || '-';
  entityConflictsEl.textContent = formatList(entity.conflictsWith);
  entityTagsEl.textContent = formatList(entity.tags);
  entityPreview.disabled = false;
  saveContentBtn.disabled = !appState.contentDirty || appState.editingContentId !== entity.id;
  if (appState.editingContentId !== entity.id || !appState.contentDirty) {
    entityDescriptionEl.value = entity.description || '';
    entityPreview.value = entity.content || '';
    appState.editingContentId = entity.id;
    appState.contentDirty = false;
    saveContentBtn.disabled = true;
  }
  sourcePathText.textContent = entity.path || '-';
  installedPathText.textContent = isInstalled(entity)
    ? entity.installPaths?.[appState.scope] || '-'
    : 'Not installed in current scope';
  installedPathText.className = 'pathValue' + (isInstalled(entity) ? ' ok' : '');
}

function render() {
  renderScopeControls();
  renderAgents();
  renderDomainFilters();
  renderTree();
  renderDetails();
}

async function refresh() {
  const data = await apiGet('/api/entities');
  appState.entities = data.entities || [];
  appState.categories = data.categories || [];
  appState.categoryTree = data.categoryTree || [];
  appState.domains = data.domains || [];
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
    appState.categoryTree = data.entities.categoryTree || [];
    appState.domains = data.entities.domains || [];
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
    appState.categoryTree = data.entities.categoryTree || [];
    appState.domains = data.entities.domains || [];
    setStatus(`Disabled ${entity.id}`, 'ok');
    render();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function saveSelectedContent() {
  const entity = currentEntity();
  if (!entity) return;
  try {
    saveContentBtn.disabled = true;
    setStatus(`Saving ${entity.id} content ...`);
    const data = await apiPost('/api/entities/save-content', {
      id: entity.id,
      description: entityDescriptionEl.value,
      content: entityPreview.value,
    });
    appState.entities = data.entities.entities || [];
    appState.categories = data.entities.categories || [];
    appState.categoryTree = data.entities.categoryTree || [];
    appState.domains = data.entities.domains || [];
    appState.contentDirty = false;
    appState.editingContentId = entity.id;
    setStatus(`Saved source content for ${entity.id}`, 'ok');
    render();
  } catch (error) {
    setStatus(error.message, 'error');
    saveContentBtn.disabled = false;
  }
}

entitySearch.addEventListener('input', () => {
  appState.query = entitySearch.value;
  renderTree();
});

entityPreview.addEventListener('input', () => {
  const entity = currentEntity();
  appState.editingContentId = entity?.id || '';
  appState.contentDirty = true;
  saveContentBtn.disabled = false;
});

entityDescriptionEl.addEventListener('input', () => {
  const entity = currentEntity();
  appState.editingContentId = entity?.id || '';
  appState.contentDirty = true;
  saveContentBtn.disabled = false;
});

saveContentBtn.addEventListener('click', saveSelectedContent);

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
