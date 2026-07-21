const projectInput = document.getElementById('projectInput');
const scopePathLabel = document.getElementById('scopePathLabel');
const entitySearch = document.getElementById('entitySearch');
const entityTree = document.getElementById('entityTree');
const agentMatrix = document.getElementById('agentMatrix');
const domainFilters = document.getElementById('domainFilters');
const sourcePathText = document.getElementById('sourcePathText');
const installedPathText = document.getElementById('installedPathText');
const pluginFilesList = document.getElementById('pluginFilesList');
const floatingTooltip = document.getElementById('floatingTooltip');
const saveContentBtn = document.getElementById('saveContentBtn');
const saveScopeDialog = document.getElementById('saveScopeDialog');
const saveScopeForm = document.getElementById('saveScopeForm');
const cancelSaveScopeBtn = document.getElementById('cancelSaveScopeBtn');
const confirmSaveScopeBtn = document.getElementById('confirmSaveScopeBtn');
const saveTargetInputs = Array.from(document.querySelectorAll('.saveTargets input'));
const creationDialog = document.getElementById('creationDialog');
const creationForm = document.getElementById('creationForm');
const creationDialogEyebrow = document.getElementById('creationDialogEyebrow');
const creationDialogTitle = document.getElementById('creationDialogTitle');
const creationDialogHint = document.getElementById('creationDialogHint');
const creationNameLabel = document.getElementById('creationNameLabel');
const creationName = document.getElementById('creationName');
const creationTypeField = document.getElementById('creationTypeField');
const creationError = document.getElementById('creationError');
const cancelCreationBtn = document.getElementById('cancelCreationBtn');
const confirmCreationBtn = document.getElementById('confirmCreationBtn');

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
const entityRequiresEl = document.getElementById('entityRequires');
const entityRuntimeEl = document.getElementById('entityRuntime');
const entityEntrypointEl = document.getElementById('entityEntrypoint');
const settingsBtn = document.getElementById('settingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const mainView = document.getElementById('mainView');
const settingsView = document.getElementById('settingsView');
const agentsConfigEditor = document.getElementById('agentsConfigEditor');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const agentApiBtn = document.getElementById('agentApiBtn');
const agentApiDialog = document.getElementById('agentApiDialog');
const agentApiModalEndpoint = document.getElementById('agentApiModalEndpoint');
const copyAgentApiModalBtn = document.getElementById('copyAgentApiModalBtn');
const addPluginFileBtn = document.getElementById('addPluginFileBtn');
const deletePluginBtn = document.getElementById('deletePluginBtn');
const welcomeView = document.getElementById('welcomeView');
const entityBody = document.getElementById('entityBody');
const browsePluginsBtn = document.getElementById('browsePluginsBtn');
const welcomeSettingsBtn = document.getElementById('welcomeSettingsBtn');
const welcomePluginCount = document.getElementById('welcomePluginCount');
const welcomeAgentCount = document.getElementById('welcomeAgentCount');
const assetDialog = document.getElementById('assetDialog');
const assetForm = document.getElementById('assetForm');
const assetName = document.getElementById('assetName');
const assetError = document.getElementById('assetError');
const cancelAssetBtn = document.getElementById('cancelAssetBtn');
const removeConfirmDialog = document.getElementById('removeConfirmDialog');
const removeConfirmTitle = document.getElementById('removeConfirmTitle');
const removeConfirmText = document.getElementById('removeConfirmText');
const cancelRemoveBtn = document.getElementById('cancelRemoveBtn');
const confirmRemoveBtn = document.getElementById('confirmRemoveBtn');

let appState = {
  scope: 'source',
  entities: [],
  categories: [],
  categoryTree: [],
  domains: [],
  scopeChanges: { global: false, project: false },
  paths: { source: '', global: '', project: '' },
  activeDomains: new Set(['guidance', 'enforcement', 'automation']),
  agents: [],
  selectedAgents: new Set(),
  collapsedCategories: new Set(),
  collapseStateInitialized: false,
  selectedId: '',
  editingContentId: '',
  activeFileByEntity: new Map(),
  fileEdits: new Map(),
  contentDirty: false,
  query: '',
  creation: null,
  removal: null,
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
  return appState.entities.find((entity) => entity.id === appState.selectedId) || null;
}

function isInstalled(entity) {
  if (appState.scope === 'source') return true;
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

function parseList(value) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function markDirty() {
  const entity = currentEntity();
  appState.editingContentId = entity?.id || '';
  const editor = arguments[0]?.target;
  if (entity && editor?.dataset?.filePath) {
    appState.fileEdits.set(`${entity.id}:${editor.dataset.filePath}`, editor.value);
  }
  appState.contentDirty = true;
  saveContentBtn.disabled = false;
}

function editableFiles(entity) {
  if (!entity || !Array.isArray(entity.editableFiles)) return [];
  return entity.editableFiles;
}

function defaultEditableFile(entity) {
  const files = editableFiles(entity);
  return files.find((file) => file.role === 'instructions')
    || files.find((file) => file.role === 'script')
    || files.find((file) => file.role === 'legacy')
    || files[0]
    || null;
}

function activeEditableFile(entity) {
  const files = editableFiles(entity);
  const activePath = entity ? appState.activeFileByEntity.get(entity.id) : '';
  return files.find((file) => file.path === activePath) || defaultEditableFile(entity);
}

function editedFileContent(entity, file) {
  if (!entity || !file) return '';
  const key = `${entity.id}:${file.path}`;
  return appState.fileEdits.has(key) ? appState.fileEdits.get(key) : (file.content || '');
}

function selectedValues(select) {
  if (select.selectedOptions) {
    return Array.from(select.selectedOptions).map((option) => option.value);
  }
  return Array.from(select.querySelectorAll('input:checked')).map((input) => input.value);
}

function checkboxValues(container) {
  return Array.from(container.querySelectorAll('input:checked')).map((input) => input.value);
}

function renderCheckboxGroup(container, options, selected, prefix) {
  container.innerHTML = '';
  options.forEach(({ value, label }) => {
    const field = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = value;
    input.checked = selected.includes(value);
    input.id = `${prefix}-${value}`;
    input.onchange = markDirty;
    const text = document.createElement('span');
    text.textContent = label;
    field.append(input, text);
    container.appendChild(field);
  });
}

function renderPluginSelect(select, selected, entityId) {
  select.innerHTML = '';
  const details = document.createElement('details');
  details.className = 'pluginPickerMenu';
  const summary = document.createElement('summary');
  const count = selected.length;
  summary.textContent = count ? `${count} selected` : 'None';
  details.appendChild(summary);
  const panel = document.createElement('div');
  panel.className = 'pluginPickerPanel';
  appState.entities.filter((item) => item.id !== entityId).forEach((item) => {
    const field = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = item.id;
    input.checked = selected.includes(item.id);
    input.onchange = () => {
      const currentCount = selectedValues(select).length;
      summary.textContent = currentCount ? `${currentCount} selected` : 'None';
      markDirty();
    };
    const text = document.createElement('span');
    text.textContent = item.name || item.id;
    field.append(input, text);
    panel.appendChild(field);
  });
  details.appendChild(panel);
  select.appendChild(details);
}

function pluginDirectoryName(entity) {
  if (!entity || !entity.path) return entity?.id?.split('.').pop() || 'plugin';
  const parts = entity.path.split('/');
  return parts.length > 1 ? parts[parts.length - 2] : entity.id.split('.').pop();
}

function installedAssetPath(entity, file) {
  if (!entity || !file) return 'Not installed in current scope';
  if (appState.scope === 'source') return file.path || entity.path || '-';
  if (!isInstalled(entity)) return 'Not installed in current scope';
  const base = entity.installPaths?.[appState.scope] || '-';
  const root = entity.installRoots?.[appState.scope] || (appState.scope === 'project' ? '.orkestra' : '~/.config/orkestra');
  if (file.role === 'instructions' || file.role === 'legacy') return base;
  if (file.role === 'script') return appState.scope === 'project'
    ? `.orkestra/bin/${file.label.split('/').pop()}`
    : `${root}/bin/${file.label.split('/').pop()}`;
  if (file.role === 'config') {
    const name = pluginDirectoryName(entity);
    return appState.scope === 'project'
      ? `.orkestra/config/${name}/${file.label}`
      : `${root}/config/${name}/${file.label}`;
  }
  return base;
}

function scopeLabel(scope) {
  if (scope === 'source') return 'Source';
  if (scope === 'global') return 'User';
  return 'Project';
}

function scopePath(scope) {
  return appState.paths[scope] || '-';
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

function renderScopeControls() {
  document.querySelectorAll('.segment').forEach((button) => {
    button.classList.toggle('active', button.dataset.scope === appState.scope);
    const modified = button.dataset.scope !== 'source' && Boolean(appState.scopeChanges[button.dataset.scope]);
    button.classList.toggle('hasChanges', modified);
    const dot = button.querySelector('.scopeChangeDot');
    if (dot) dot.hidden = !modified;
    button.setAttribute('aria-label', modified
      ? `${button.textContent.trim()} scope has deployed changes`
      : `${button.textContent.trim()} scope`);
    button.onclick = () => {
      appState.scope = button.dataset.scope;
      render();
    };
  });
  scopePathLabel.textContent = scopeLabel(appState.scope);
  projectInput.value = scopePath(appState.scope);
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

async function applyEntityIndex(data) {
  appState.entities = data.entities || [];
  appState.categories = data.categories || [];
  appState.categoryTree = data.categoryTree || [];
  appState.domains = data.domains || [];
  appState.scopeChanges = data.scopeChanges || { global: false, project: false };
  appState.paths = {
    source: data.source?.path || appState.paths.source || '',
    global: data.scopes?.global?.root || appState.paths.global || '',
    project: data.scopes?.project?.root || data.project?.path || appState.paths.project || '',
  };
}

function openCreationDialog(mode, target, label) {
  appState.creation = { mode, target, label };
  creationForm.reset();
  creationError.hidden = true;
  creationError.textContent = '';
  const isCategory = mode === 'category';
  creationDialogEyebrow.textContent = isCategory ? 'New subcategory' : 'New plugin';
  creationDialogTitle.textContent = isCategory ? `Add to ${label}` : `Add plugin to ${label}`;
  creationDialogHint.textContent = isCategory
    ? `Create a second-level section under ${label}.`
    : `Create a plugin in ${label}. You can edit every file immediately after creation.`;
  creationNameLabel.textContent = isCategory ? 'Subcategory name' : 'Plugin name';
  creationName.placeholder = isCategory ? 'e.g. review tools' : 'e.g. API contract checker';
  creationTypeField.hidden = isCategory;
  confirmCreationBtn.textContent = isCategory ? 'Add section' : 'Create plugin';
  creationDialog.showModal();
  window.setTimeout(() => creationName.focus(), 0);
}

async function createCategory(main, label) {
  const data = await apiPost('/api/categories/create', { main, label });
  await applyEntityIndex(data.entities);
  appState.collapsedCategories.delete(data.category);
  render();
}

async function createPlugin(category, name, type) {
  const data = await apiPost('/api/entities/create', { category, name, type });
  await applyEntityIndex(data.entities);
  appState.selectedId = data.entity.id;
  appState.collapsedCategories.delete(category);
  render();
}

async function movePlugin(id, category) {
  try {
    const data = await apiPost('/api/entities/move', { id, category });
    await applyEntityIndex(data.entities);
    appState.selectedId = id;
    appState.collapsedCategories.delete(category);
    setStatus(`Moved ${id} to ${category}`, 'ok');
    render();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function createEntityRow(entity, selected) {
  const row = document.createElement('div');
  row.className = `entityRow ${entity.domain || 'guidance'}`;
  row.classList.toggle('active', selected && selected.id === entity.id);
  row.classList.toggle('installed', Boolean(entity.installed?.global || entity.installed?.project));
  row.classList.toggle('blocked', isBlocked(entity));
  row.draggable = true;
  row.addEventListener('dragstart', (event) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/orkestra-plugin', entity.id);
  });
  const indicator = document.createElement('span');
  indicator.className = 'domainIndicator';
  indicator.textContent = domainIndicator(entity.domain);

  const entityLabel = document.createElement('button');
  entityLabel.type = 'button';
  entityLabel.className = 'entityLabel';
  entityLabel.setAttribute('aria-label', `Preview plugin ${entity.id}`);
  entityLabel.onclick = () => selectEntity(entity.id);
  const name = document.createElement('strong');
  name.textContent = entity.name || entity.id;
  const meta = document.createElement('small');
  meta.textContent = entity.id;
  entityLabel.appendChild(name);
  entityLabel.appendChild(meta);

  const scopeToggles = document.createElement('div');
  scopeToggles.className = 'scopeToggles';
  [['global', 'U', 'User'], ['project', 'P', 'Project']].forEach(([scope, text, labelText]) => {
    const installed = Boolean(entity.installed?.[scope]);
    const modified = Boolean(entity.modified?.[scope]);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'scopeToggle tooltipTarget tooltipLeft';
    toggle.classList.toggle('active', installed);
    toggle.classList.toggle('modified', modified);
    toggle.setAttribute('aria-pressed', installed ? 'true' : 'false');
    toggle.setAttribute('aria-label', `${installed ? 'Remove' : 'Install'} ${entity.id} ${installed ? 'from' : 'in'} ${labelText} scope`);
    toggle.dataset.tooltip = installed
      ? `Remove from ${labelText} scope${modified ? ' (local changes detected)' : ''}`
      : `Install in ${labelText} scope`;
    toggle.textContent = text;
    toggle.onclick = () => toggleEntityScope(entity, scope);
    scopeToggles.appendChild(toggle);
  });

  row.appendChild(indicator);
  row.appendChild(entityLabel);
  row.appendChild(scopeToggles);
  return row;
}

function renderTree() {
  entityTree.innerHTML = '';
  const selected = currentEntity();
  const tree = appState.categoryTree
    .map((main) => ({
      ...main,
      entities: main.entities.filter((entity) => matchesQuery(entity) && matchesDomain(entity)),
      subcategories: main.subcategories
        .map((sub) => ({
          ...sub,
          entities: sub.entities.filter((entity) => matchesQuery(entity) && matchesDomain(entity)),
        })),
    }));

  tree.forEach((main) => {
    const mainSection = document.createElement('section');
    mainSection.className = 'category mainCategory';

    const mainHeader = document.createElement('div');
    mainHeader.setAttribute('role', 'button');
    mainHeader.tabIndex = 0;
    mainHeader.className = 'categoryHeader mainCategoryHeader';
    const mainCollapsed = appState.collapsedCategories.has(main.id) && !appState.query.trim();
    const total = main.entities.length + main.subcategories.reduce((count, sub) => count + sub.entities.length, 0);
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
    const addCategory = document.createElement('button');
    addCategory.type = 'button';
    addCategory.className = 'miniButton tooltipTarget categoryAdd';
    addCategory.role = 'button';
    addCategory.tabIndex = 0;
    addCategory.textContent = '+';
    addCategory.setAttribute('aria-label', `Add a plugin to ${main.label}`);
    addCategory.dataset.tooltip = `Add a plugin to ${main.label}`;
    addCategory.onclick = (event) => {
      event.stopPropagation();
      openCreationDialog('plugin', main.id, main.label);
    };
    mainHeader.appendChild(addCategory);
    mainHeader.onclick = () => {
      if (appState.collapsedCategories.has(main.id)) appState.collapsedCategories.delete(main.id);
      else appState.collapsedCategories.add(main.id);
      renderTree();
    };
    mainHeader.onkeydown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      mainHeader.click();
    };
    mainSection.appendChild(mainHeader);

    mainSection.addEventListener('dragover', (event) => {
      event.preventDefault();
      mainSection.classList.add('dropTarget');
    });
    mainSection.addEventListener('dragleave', (event) => {
      if (!mainSection.contains(event.relatedTarget)) mainSection.classList.remove('dropTarget');
    });
    mainSection.addEventListener('drop', async (event) => {
      if (event.target.closest('.subcategory')) return;
      event.preventDefault();
      mainSection.classList.remove('dropTarget');
      const id = event.dataTransfer.getData('text/orkestra-plugin');
      if (id) await movePlugin(id, main.id);
    });

    if (mainCollapsed) {
      entityTree.appendChild(mainSection);
      return;
    }

    main.entities.forEach((entity) => mainSection.appendChild(createEntityRow(entity, selected)));

    main.subcategories.forEach((category) => {
      const section = document.createElement('section');
      section.className = 'subcategory';

      const header = document.createElement('div');
      header.setAttribute('role', 'button');
      header.tabIndex = 0;
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
      const addPlugin = document.createElement('button');
      addPlugin.type = 'button';
      addPlugin.className = 'miniButton tooltipTarget categoryAdd';
      addPlugin.role = 'button';
      addPlugin.tabIndex = 0;
      addPlugin.textContent = '+';
      addPlugin.setAttribute('aria-label', `Add a plugin to ${category.label}`);
      addPlugin.dataset.tooltip = `Add a plugin to ${category.label}`;
      addPlugin.onclick = (event) => {
        event.stopPropagation();
        openCreationDialog('plugin', category.id, category.label);
      };
      header.appendChild(addPlugin);
      header.onclick = () => {
        if (appState.collapsedCategories.has(category.id)) appState.collapsedCategories.delete(category.id);
        else appState.collapsedCategories.add(category.id);
        renderTree();
      };
      header.onkeydown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        header.click();
      };
      section.appendChild(header);

      section.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.stopPropagation();
        section.classList.add('dropTarget');
      });
      section.addEventListener('dragleave', (event) => {
        event.stopPropagation();
        section.classList.remove('dropTarget');
      });
      section.addEventListener('drop', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        section.classList.remove('dropTarget');
        const id = event.dataTransfer.getData('text/orkestra-plugin');
        if (!id) return;
        await movePlugin(id, category.id);
      });

      if (collapsed) {
        mainSection.appendChild(section);
        return;
      }

      category.entities.forEach((entity) => {
        section.appendChild(createEntityRow(entity, selected));
      });

      mainSection.appendChild(section);
    });

    entityTree.appendChild(mainSection);
  });
}


function renderDetails() {
  const entity = currentEntity();
  welcomeView.hidden = Boolean(entity);
  entityBody.hidden = !entity;
  welcomePluginCount.textContent = String(appState.entities.length);
  welcomeAgentCount.textContent = String(appState.agents.length);
  if (!entity) {
    entityIdEl.textContent = 'Select a plugin';
    entityNameEl.value = 'No plugin selected';
    entityDescriptionEl.value = 'Choose a plugin from the sidebar.';
    document.querySelectorAll('.entityInfo input, .entityInfo select, .entityInfo textarea').forEach((input) => { input.disabled = true; });
    pluginFilesList.innerHTML = '';
    saveContentBtn.disabled = true;
    addPluginFileBtn.disabled = true;
    deletePluginBtn.disabled = true;
    sourcePathText.textContent = '-';
    installedPathText.textContent = 'Not installed in current scope';
    installedPathText.className = 'pathValue';
    return;
  }

  appState.selectedId = entity.id;
  addPluginFileBtn.disabled = entity.pluginFormat !== 'directory';
  addPluginFileBtn.dataset.tooltip = entity.pluginFormat === 'directory'
    ? 'Add a shell, YAML, or Markdown file'
    : 'Additional files require a directory-format plugin';
  deletePluginBtn.disabled = false;
  const activeFile = defaultEditableFile(entity);
  entityIdEl.textContent = `${entity.id}${entity.version ? `  v${entity.version}` : ''}`;
  document.querySelectorAll('.entityInfo input, .entityInfo select, .entityInfo textarea').forEach((input) => { input.disabled = false; });
  saveContentBtn.disabled = !appState.contentDirty || appState.editingContentId !== entity.id;
  if (appState.editingContentId !== entity.id || !appState.contentDirty) {
    entityNameEl.value = entity.name || '';
    entityDescriptionEl.value = entity.description || '';
    entityVersionEl.value = entity.version || '';
    entityAuthorEl.value = entity.author || '';
    renderCheckboxGroup(entityAgentsEl, appState.agents.map((agent) => ({ value: agent, label: agent })), entity.agents || [], 'agent');
    entityDomainEl.value = entity.domain || 'guidance';
    entityTypeEl.value = entity.type || 'markdown';
    renderPluginSelect(entityConflictsEl, entity.conflictsWith || [], entity.id);
    entityTagsEl.value = formatList(entity.tags).replace('-', '');
    renderPluginSelect(entityRequiresEl, entity.requires || [], entity.id);
    entityRuntimeEl.value = entity.runtime || '';
    entityEntrypointEl.value = entity.entrypoint || '';
    appState.editingContentId = entity.id;
    appState.contentDirty = false;
    saveContentBtn.disabled = true;
  }
  renderPluginFiles(entity);
  sourcePathText.textContent = entity.path || `${editableFiles(entity).length} file${editableFiles(entity).length === 1 ? '' : 's'}`;
  if (appState.scope === 'source') {
    installedPathText.textContent = entity.path || 'Editing source files';
    installedPathText.className = 'pathValue ok';
  } else {
    installedPathText.textContent = isInstalled(entity)
      ? (entity.installPaths?.[appState.scope] || `Installed in ${scopeLabel(appState.scope)} scope`)
      : `Not installed in ${scopeLabel(appState.scope)} scope`;
    installedPathText.className = 'pathValue' + (isInstalled(entity) ? ' ok' : '');
  }
  document.querySelectorAll('.shellOnly').forEach((field) => {
    field.hidden = entityTypeEl.value !== 'shell';
  });
}

function renderPluginFiles(entity) {
  pluginFilesList.innerHTML = '';
  editableFiles(entity).forEach((file) => {
    const card = document.createElement('section');
    card.className = 'pluginFile';
    const head = document.createElement('div');
    head.className = 'pluginFileHead';
    const label = document.createElement('strong');
    label.textContent = file.label || file.path;
    const paths = document.createElement('code');
    paths.textContent = appState.scope === 'source'
      ? file.path
      : `${file.path}${isInstalled(entity) ? `  ->  ${installedAssetPath(entity, file)}` : ''}`;
    const title = document.createElement('div');
    title.append(label, paths);
    head.appendChild(title);
    if (['script', 'config', 'document'].includes(file.role)) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'miniButton dangerButton tooltipTarget';
      remove.textContent = '−';
      remove.dataset.tooltip = `Remove ${file.label}`;
      remove.setAttribute('aria-label', `Remove ${file.label}`);
      remove.onclick = () => removePluginFile(entity, file);
      head.appendChild(remove);
    }
    const editor = document.createElement('textarea');
    editor.className = 'markdownPreview pluginFileEditor';
    editor.dataset.filePath = file.path;
    editor.spellcheck = false;
    editor.value = editedFileContent(entity, file);
    editor.addEventListener('input', markDirty);
    card.append(head, editor);
    pluginFilesList.appendChild(card);
  });
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
  appState.scopeChanges = data.scopeChanges || { global: false, project: false };
  appState.paths = {
    source: data.source?.path || '',
    global: data.scopes?.global?.root || '',
    project: data.scopes?.project?.root || data.project?.path || '',
  };
  appState.agents = data.agents || [];
  if (appState.agents.length === 0) appState.agents = ['codex'];
  appState.agents.forEach((agent) => appState.selectedAgents.add(agent));

  if (!appState.collapseStateInitialized) {
    appState.categoryTree.forEach((main) => {
      appState.collapsedCategories.add(main.id);
      main.subcategories.forEach((subcategory) => appState.collapsedCategories.add(subcategory.id));
    });
    appState.collapseStateInitialized = true;
  }
  render();
}

async function setEntityScope(entity, scope, enabled) {
  if (!entity) return;
  if (scope === 'source') {
    setStatus('Source is edited directly. Use Save to write source changes.', 'ok');
    return;
  }
  try {
    setStatus(`${enabled ? 'Installing' : 'Removing'} ${entity.id} ...`);
    const data = await apiPost(`/api/entities/${enabled ? 'enable' : 'disable'}`, {
      id: entity.id,
      scope,
      ...(enabled ? { agents: Array.from(appState.selectedAgents) } : {}),
    });
    await applyEntityIndex(data.entities);
    setStatus(`${enabled ? 'Installed' : 'Removed'} ${entity.id} in ${scopeLabel(scope)} scope`, 'ok');
    render();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function toggleEntityScope(entity, scope) {
  return setEntityScope(entity, scope, !Boolean(entity.installed?.[scope]));
}

function installSelected() {
  return setEntityScope(currentEntity(), appState.scope, true);
}

async function disableSelected() {
  return setEntityScope(currentEntity(), appState.scope, false);
}

function rememberedSaveTargets() {
  try {
    const stored = JSON.parse(window.localStorage.getItem('orkestra.saveTargets') || '');
    if (Array.isArray(stored) && stored.every((target) => ['source', 'user', 'project'].includes(target))) return stored;
  } catch (_) {
    // Use the canonical source as the safe default when storage is unavailable.
  }
  return ['source'];
}

function selectedSaveTargets() {
  return saveTargetInputs.filter((input) => input.checked).map((input) => input.value);
}

function updateSaveTargetSubmit() {
  confirmSaveScopeBtn.disabled = selectedSaveTargets().length === 0;
}

function openSaveScopeDialog() {
  const targets = rememberedSaveTargets();
  saveTargetInputs.forEach((input) => { input.checked = targets.includes(input.value); });
  updateSaveTargetSubmit();
  saveScopeDialog.showModal();
  confirmSaveScopeBtn.focus();
}

async function saveSelectedContent(targets) {
  const entity = currentEntity();
  if (!entity) return;
  const files = editableFiles(entity);
  const fileContents = {};
  files.forEach((file) => {
    const key = `${entity.id}:${file.path}`;
    if (appState.fileEdits.has(key)) fileContents[file.path] = appState.fileEdits.get(key);
  });
  const instructionFile = files.find((file) => file.role === 'instructions')
    || files.find((file) => file.role === 'legacy')
    || activeEditableFile(entity);
  const instructionContent = instructionFile ? editedFileContent(entity, instructionFile) : '';
  try {
    saveContentBtn.disabled = true;
    setStatus(`Saving ${entity.id} content ...`);
    const data = await apiPost('/api/entities/update', {
      id: entity.id,
      name: entityNameEl.value,
      description: entityDescriptionEl.value,
      content: instructionContent,
      fileContents,
      version: entityVersionEl.value,
      author: entityAuthorEl.value,
      agents: checkboxValues(entityAgentsEl),
      scopes: entity.scopes || ['global', 'project'],
      domain: entityDomainEl.value,
      type: entityTypeEl.value,
      tags: parseList(entityTagsEl.value),
      conflictsWith: selectedValues(entityConflictsEl),
      requires: selectedValues(entityRequiresEl),
      requiresTools: entity.requiresTools || [],
      runtime: entityRuntimeEl.value,
      entrypoint: entityEntrypointEl.value,
      targets,
    });
    await applyEntityIndex(data.entities);
    files.forEach((file) => appState.fileEdits.delete(`${entity.id}:${file.path}`));
    appState.contentDirty = false;
    appState.editingContentId = entity.id;
    setStatus(`Saved ${entity.id} to ${targets.join(', ')}`, 'ok');
    render();
  } catch (error) {
    setStatus(error.message, 'error');
    saveContentBtn.disabled = false;
  }
}

async function createPluginFile() {
  const entity = currentEntity();
  const name = assetName.value.trim();
  const type = assetForm.querySelector('input[name="assetType"]:checked')?.value || 'shell';
  if (!entity || !name) return;
  const data = await apiPost('/api/entities/assets/create', { id: entity.id, name, type });
  await applyEntityIndex(data.entities);
  appState.fileEdits.clear();
  appState.contentDirty = false;
  render();
}

function confirmRemoval(title, text) {
  return new Promise((resolve) => {
    appState.removal = resolve;
    removeConfirmTitle.textContent = title;
    removeConfirmText.textContent = text;
    removeConfirmDialog.showModal();
    confirmRemoveBtn.focus();
  });
}

async function removePluginFile(entity, file) {
  if (!await confirmRemoval(`Remove ${file.label}?`, 'This file will be removed from the plugin source.')) return;
  try {
    const data = await apiPost('/api/entities/assets/remove', { id: entity.id, path: file.path });
    await applyEntityIndex(data.entities);
    appState.fileEdits.delete(`${entity.id}:${file.path}`);
    render();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function removePlugin() {
  const entity = currentEntity();
  if (!entity || !await confirmRemoval(`Remove ${entity.name}?`, 'This removes the plugin source and disables deployed copies. This cannot be undone.')) return;
  try {
    const data = await apiPost('/api/entities/remove', { id: entity.id });
    await applyEntityIndex(data.entities);
    appState.selectedId = '';
    appState.fileEdits.clear();
    appState.contentDirty = false;
    render();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function openSettings() {
  try {
    const data = await apiGet('/api/settings');
    agentsConfigEditor.value = data.content || '';
    mainView.hidden = true;
    settingsView.hidden = false;
    agentsConfigEditor.focus();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function saveSettings() {
  try {
    saveSettingsBtn.disabled = true;
    await apiPost('/api/settings/save', { content: agentsConfigEditor.value });
    setStatus('Saved deployment settings', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    saveSettingsBtn.disabled = false;
  }
}

entitySearch.addEventListener('input', () => {
  appState.query = entitySearch.value;
  renderTree();
});

document.querySelectorAll('.entityInfo input, .entityInfo select, .entityInfo textarea').forEach((field) => {
  field.addEventListener('input', markDirty);
  field.addEventListener('change', () => {
    if (field === entityTypeEl) {
      document.querySelectorAll('.shellOnly').forEach((item) => { item.hidden = entityTypeEl.value !== 'shell'; });
    }
    markDirty();
  });
});

saveContentBtn.addEventListener('click', openSaveScopeDialog);
settingsBtn.addEventListener('click', openSettings);
welcomeSettingsBtn.addEventListener('click', openSettings);
browsePluginsBtn.addEventListener('click', () => {
  entitySearch.focus();
  entitySearch.select();
});
closeSettingsBtn.addEventListener('click', () => { settingsView.hidden = true; mainView.hidden = false; });
saveSettingsBtn.addEventListener('click', saveSettings);
agentApiBtn.addEventListener('click', () => {
  agentApiModalEndpoint.value = `${window.location.origin}/api/agent-context`;
  agentApiDialog.showModal();
});
copyAgentApiModalBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(agentApiModalEndpoint.value);
  copyAgentApiModalBtn.textContent = 'Copied';
  window.setTimeout(() => { copyAgentApiModalBtn.textContent = 'Copy endpoint'; }, 1200);
});
addPluginFileBtn.addEventListener('click', () => {
  const entity = currentEntity();
  if (!entity) return;
  assetForm.reset();
  assetError.hidden = true;
  assetDialog.showModal();
  window.setTimeout(() => assetName.focus(), 0);
});
deletePluginBtn.addEventListener('click', removePlugin);
cancelAssetBtn.addEventListener('click', () => assetDialog.close());
cancelRemoveBtn.addEventListener('click', () => removeConfirmDialog.close());
confirmRemoveBtn.addEventListener('click', () => {
  const resolve = appState.removal;
  appState.removal = null;
  removeConfirmDialog.close();
  if (resolve) resolve(true);
});
removeConfirmDialog.addEventListener('close', () => {
  const resolve = appState.removal;
  appState.removal = null;
  if (resolve) resolve(false);
});
assetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  assetError.hidden = true;
  try {
    await createPluginFile();
    assetDialog.close();
  } catch (error) {
    assetError.textContent = error.message || 'Could not add plugin file';
    assetError.hidden = false;
  }
});
saveTargetInputs.forEach((input) => input.addEventListener('change', updateSaveTargetSubmit));
cancelSaveScopeBtn.addEventListener('click', () => saveScopeDialog.close());
saveScopeDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  saveScopeDialog.close();
});
saveScopeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const targets = selectedSaveTargets();
  if (targets.length === 0) return;
  window.localStorage.setItem('orkestra.saveTargets', JSON.stringify(targets));
  saveScopeDialog.close();
  await saveSelectedContent(targets);
});
cancelCreationBtn.addEventListener('click', () => creationDialog.close());
creationDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  creationDialog.close();
});
creationDialog.addEventListener('close', () => {
  appState.creation = null;
  creationError.hidden = true;
});
creationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const request = appState.creation;
  const name = creationName.value.trim();
  if (!request || !name) return;
  creationError.hidden = true;
  confirmCreationBtn.disabled = true;
  try {
    if (request.mode === 'category') {
      await createCategory(request.target, name);
    } else {
      const selectedType = creationForm.querySelector('input[name="pluginType"]:checked');
      await createPlugin(request.target, name, selectedType?.value || 'markdown');
    }
    creationDialog.close();
  } catch (error) {
    creationError.textContent = error.message || 'Could not create item';
    creationError.hidden = false;
  } finally {
    confirmCreationBtn.disabled = false;
  }
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    entitySearch.focus();
  }
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
