const projectInput = document.getElementById('projectInput');
const entitySearch = document.getElementById('entitySearch');
const entityTree = document.getElementById('entityTree');
const agentMatrix = document.getElementById('agentMatrix');
const domainFilters = document.getElementById('domainFilters');
const sourcePathText = document.getElementById('sourcePathText');
const installedPathText = document.getElementById('installedPathText');
const pluginFileTabs = document.getElementById('pluginFileTabs');
const floatingTooltip = document.getElementById('floatingTooltip');
const saveContentBtn = document.getElementById('saveContentBtn');
const copyAgentApiBtn = document.getElementById('copyAgentApiBtn');
const agentApiEndpoint = document.getElementById('agentApiEndpoint');
const saveScopeDialog = document.getElementById('saveScopeDialog');
const saveScopeForm = document.getElementById('saveScopeForm');
const cancelSaveScopeBtn = document.getElementById('cancelSaveScopeBtn');
const confirmSaveScopeBtn = document.getElementById('confirmSaveScopeBtn');
const saveTargetInputs = Array.from(document.querySelectorAll('.saveTargets input'));

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
const entityScopesEl = document.getElementById('entityScopes');
const entityRequiresEl = document.getElementById('entityRequires');
const entityRequiresToolsEl = document.getElementById('entityRequiresTools');
const entityRuntimeEl = document.getElementById('entityRuntime');
const entityEntrypointEl = document.getElementById('entityEntrypoint');

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
  activeFileByEntity: new Map(),
  fileEdits: new Map(),
  contentDirty: false,
  query: '',
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

function parseList(value) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function markDirty() {
  const entity = currentEntity();
  appState.editingContentId = entity?.id || '';
  const activeFile = activeEditableFile(entity);
  if (entity && activeFile) {
    appState.fileEdits.set(`${entity.id}:${activeFile.path}`, entityPreview.value);
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

function rememberActiveEditorValue(entity) {
  if (!entity || appState.editingContentId !== entity.id) return;
  const file = activeEditableFile(entity);
  if (!file) return;
  appState.fileEdits.set(`${entity.id}:${file.path}`, entityPreview.value);
}

function pluginDirectoryName(entity) {
  if (!entity || !entity.path) return entity?.id?.split('.').pop() || 'plugin';
  const parts = entity.path.split('/');
  return parts.length > 1 ? parts[parts.length - 2] : entity.id.split('.').pop();
}

function installedAssetPath(entity, file) {
  if (!entity || !file || !isInstalled(entity)) return 'Not installed in current scope';
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

async function applyEntityIndex(data) {
  appState.entities = data.entities || [];
  appState.categories = data.categories || [];
  appState.categoryTree = data.categoryTree || [];
  appState.domains = data.domains || [];
}

async function createCategory(main) {
  const label = window.prompt(`New subcategory for ${main.toUpperCase()}`);
  if (!label?.trim()) return;
  try {
    const data = await apiPost('/api/categories/create', { main, label: label.trim() });
    await applyEntityIndex(data.entities);
    appState.collapsedCategories.delete(data.category);
    render();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function createPlugin(category) {
  const name = window.prompt(`Plugin name for ${category}`);
  if (!name?.trim()) return;
  const type = window.prompt('Plugin type: markdown, yaml, or shell', 'markdown');
  if (!type) return;
  try {
    const data = await apiPost('/api/entities/create', { category, name: name.trim(), type: type.trim().toLowerCase() });
    await applyEntityIndex(data.entities);
    appState.selectedId = data.entity.id;
    appState.collapsedCategories.delete(category);
    render();
  } catch (error) {
    setStatus(error.message, 'error');
  }
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
        })),
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
    const addCategory = document.createElement('span');
    addCategory.className = 'miniButton tooltipTarget categoryAdd';
    addCategory.role = 'button';
    addCategory.tabIndex = 0;
    addCategory.textContent = '+';
    addCategory.setAttribute('aria-label', `Add a subcategory to ${main.label}`);
    addCategory.dataset.tooltip = `Add a subcategory to ${main.label}`;
    addCategory.onclick = (event) => {
      event.stopPropagation();
      createCategory(main.id);
    };
    mainHeader.appendChild(addCategory);
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
      const addPlugin = document.createElement('span');
      addPlugin.className = 'miniButton tooltipTarget categoryAdd';
      addPlugin.role = 'button';
      addPlugin.tabIndex = 0;
      addPlugin.textContent = '+';
      addPlugin.setAttribute('aria-label', `Add a plugin to ${category.label}`);
      addPlugin.dataset.tooltip = `Add a plugin to ${category.label}`;
      addPlugin.onclick = (event) => {
        event.stopPropagation();
        createPlugin(category.id);
      };
      header.appendChild(addPlugin);
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

      section.addEventListener('dragover', (event) => {
        event.preventDefault();
        section.classList.add('dropTarget');
      });
      section.addEventListener('dragleave', () => section.classList.remove('dropTarget'));
      section.addEventListener('drop', async (event) => {
        event.preventDefault();
        section.classList.remove('dropTarget');
        const id = event.dataTransfer.getData('text/orkestra-plugin');
        if (!id || id === category.entities.find((item) => item.id === id)?.id) return;
        await movePlugin(id, category.id);
      });

      category.entities.forEach((entity) => {
        const installed = isInstalled(entity);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `entityRow ${entity.domain || 'guidance'}`;
        row.classList.toggle('active', selected && selected.id === entity.id);
        row.classList.toggle('installed', installed);
        row.classList.toggle('blocked', isBlocked(entity));
        row.setAttribute('aria-label', `Select plugin ${entity.id}`);
        row.draggable = true;
        row.addEventListener('dragstart', (event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/orkestra-plugin', entity.id);
        });
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
    entityNameEl.value = 'No plugin selected';
    entityDescriptionEl.value = 'Choose a plugin from the sidebar.';
    document.querySelectorAll('.entityInfo input, .entityInfo select, .entityInfo textarea').forEach((input) => { input.disabled = true; });
    entityPreview.value = '# Content';
    entityPreview.disabled = true;
    pluginFileTabs.innerHTML = '';
    saveContentBtn.disabled = true;
    sourcePathText.textContent = '-';
    installedPathText.textContent = 'Not installed in current scope';
    installedPathText.className = 'pathValue';
    return;
  }

  appState.selectedId = entity.id;
  const activeFile = activeEditableFile(entity);
  if (activeFile) appState.activeFileByEntity.set(entity.id, activeFile.path);
  entityIdEl.textContent = `${entity.id}${entity.version ? `  v${entity.version}` : ''}`;
  document.querySelectorAll('.entityInfo input, .entityInfo select, .entityInfo textarea').forEach((input) => { input.disabled = false; });
  entityPreview.disabled = false;
  saveContentBtn.disabled = !appState.contentDirty || appState.editingContentId !== entity.id;
  if (appState.editingContentId !== entity.id || !appState.contentDirty) {
    entityNameEl.value = entity.name || '';
    entityDescriptionEl.value = entity.description || '';
    entityVersionEl.value = entity.version || '';
    entityAuthorEl.value = entity.author || '';
    entityAgentsEl.value = formatList(entity.agents).replace('-', '');
    entityScopesEl.value = formatList(entity.scopes).replace('-', '');
    entityDomainEl.value = entity.domain || 'guidance';
    entityTypeEl.value = entity.type || 'markdown';
    entityConflictsEl.value = formatList(entity.conflictsWith).replace('-', '');
    entityTagsEl.value = formatList(entity.tags).replace('-', '');
    entityRequiresEl.value = formatList(entity.requires).replace('-', '');
    entityRequiresToolsEl.value = formatList(entity.requiresTools).replace('-', '');
    entityRuntimeEl.value = entity.runtime || '';
    entityEntrypointEl.value = entity.entrypoint || '';
    entityPreview.value = editedFileContent(entity, activeFile) || '';
    appState.editingContentId = entity.id;
    appState.contentDirty = false;
    saveContentBtn.disabled = true;
  }
  renderPluginFileTabs(entity);
  sourcePathText.textContent = activeFile?.path || entity.path || '-';
  installedPathText.textContent = installedAssetPath(entity, activeFile);
  installedPathText.className = 'pathValue' + (isInstalled(entity) ? ' ok' : '');
  document.querySelectorAll('.shellOnly').forEach((field) => {
    field.hidden = entityTypeEl.value !== 'shell';
  });
}

function renderPluginFileTabs(entity) {
  pluginFileTabs.innerHTML = '';
  const files = editableFiles(entity);
  if (files.length <= 1) {
    pluginFileTabs.hidden = files.length === 0;
    return;
  }
  pluginFileTabs.hidden = false;
  const activeFile = activeEditableFile(entity);
  files.forEach((file) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'pluginFileTab tooltipTarget';
    tab.classList.toggle('active', activeFile && activeFile.path === file.path);
    tab.textContent = file.label || file.path;
    tab.dataset.tooltip = `${file.role}: ${file.path}`;
    tab.onclick = () => {
      rememberActiveEditorValue(entity);
      appState.activeFileByEntity.set(entity.id, file.path);
      appState.editingContentId = entity.id;
      entityPreview.value = editedFileContent(entity, file);
      sourcePathText.textContent = file.path;
      installedPathText.textContent = installedAssetPath(entity, file);
      renderPluginFileTabs(entity);
    };
    pluginFileTabs.appendChild(tab);
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
  appState.agents = data.agents || [];
  if (appState.agents.length === 0) appState.agents = ['codex'];
  appState.agents.forEach((agent) => appState.selectedAgents.add(agent));

  const projectPath = data.project?.path || '';
  projectInput.value = projectPath;
  if (!appState.selectedId && appState.entities.length) {
    appState.selectedId = appState.entities[0].id;
  }
  if (appState.collapsedCategories.size === 0) {
    appState.categoryTree.forEach((main) => main.subcategories.forEach((subcategory) => appState.collapsedCategories.add(subcategory.id)));
  }
  agentApiEndpoint.textContent = `GET ${window.location.origin}/api/agent-context`;
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
    await applyEntityIndex(data.entities);
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
    await applyEntityIndex(data.entities);
    setStatus(`Disabled ${entity.id}`, 'ok');
    render();
  } catch (error) {
    setStatus(error.message, 'error');
  }
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
  rememberActiveEditorValue(entity);
  const files = editableFiles(entity);
  const fileContents = {};
  files.forEach((file) => {
    const key = `${entity.id}:${file.path}`;
    if (appState.fileEdits.has(key)) fileContents[file.path] = appState.fileEdits.get(key);
  });
  const instructionFile = files.find((file) => file.role === 'instructions')
    || files.find((file) => file.role === 'legacy')
    || activeEditableFile(entity);
  const instructionContent = instructionFile ? editedFileContent(entity, instructionFile) : entityPreview.value;
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
      agents: parseList(entityAgentsEl.value),
      scopes: parseList(entityScopesEl.value),
      domain: entityDomainEl.value,
      type: entityTypeEl.value,
      tags: parseList(entityTagsEl.value),
      conflictsWith: parseList(entityConflictsEl.value),
      requires: parseList(entityRequiresEl.value),
      requiresTools: parseList(entityRequiresToolsEl.value),
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

entitySearch.addEventListener('input', () => {
  appState.query = entitySearch.value;
  renderTree();
});

entityPreview.addEventListener('input', markDirty);
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
copyAgentApiBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(`${window.location.origin}/api/agent-context`);
    copyAgentApiBtn.textContent = 'Copied';
    window.setTimeout(() => { copyAgentApiBtn.textContent = 'Copy'; }, 1200);
  } catch (error) {
    setStatus('Could not copy agent API endpoint', 'error');
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
