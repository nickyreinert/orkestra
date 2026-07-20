const sourceColumn = document.getElementById('sourceColumn');
const globalColumn = document.getElementById('globalColumn');
const renderedColumn = document.getElementById('renderedColumn');
const agentFilters = document.getElementById('agentFilters');
const globalHeaderControls = document.getElementById('globalHeaderControls');
const renderedHeaderControls = document.getElementById('renderedHeaderControls');

const leftEditor = document.getElementById('leftEditor');
const rightEditor = document.getElementById('rightEditor');
const rightCol = document.getElementById('rightCol');
const previewGrid = document.getElementById('previewGrid');

const diffVisual = document.getElementById('diffVisual');
const compareCheckbox = document.getElementById('compareCheckbox');
const compareCheckLabel = document.getElementById('compareCheckLabel');

const savePrimaryBtn = document.getElementById('savePrimaryBtn');
const saveSecondaryBtn = document.getElementById('saveSecondaryBtn');
const applyLeftToRightBtn = document.getElementById('applyLeftToRightBtn');
const applyRightToLeftBtn = document.getElementById('applyRightToLeftBtn');

const projectPathEl = document.getElementById('projectPath');
const projectStateEl = document.getElementById('projectState');
const currentPathEl = document.getElementById('currentPath');
const leftMeta = document.getElementById('leftMeta');
const rightMeta = document.getElementById('rightMeta');
const confirmModal = document.getElementById('confirmModal');
const confirmModalBody = document.getElementById('confirmModalBody');
const confirmModalConfirm = document.getElementById('confirmModalConfirm');
const confirmModalCancel = document.getElementById('confirmModalCancel');

if (confirmModal) {
  confirmModal.hidden = true;
}

let latestIndex = null;
let primary = null;
let secondary = null;
let compareArmed = false;
let compareMode = false;
let comparePrimaryKey = '';
let currentDiffBlocks = [];
let activeAgentFilter = '';
let devHash = null;
let globalSelectionState = {};
let renderedSelectionState = {};
let globalApplyBtn = null;
let renderedApplyBtn = null;
let confirmModalResolver = null;
const sourceDeployState = {
  agents: {},
  globalEnabled: false,
  globalFiles: {},
  activeTemplate: '',
  templateFiles: {},
  extrasFiles: {},
};

function titleCase(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function renderPills(container, options, active, onPick) {
  if (!container) return;
  container.innerHTML = '';
  options.forEach((opt) => {
    const btn = document.createElement('button');
    btn.className = 'pillBtn' + (opt.value === active ? ' active' : '');
    btn.textContent = opt.label;
    btn.type = 'button';
    btn.dataset.agent = opt.value;
    btn.setAttribute('aria-pressed', opt.value === active ? 'true' : 'false');
    btn.onclick = () => onPick(opt.value);
    container.appendChild(btn);
  });
}

function ensureSourceDeployState(data) {
  const agents = (data.agents || []).slice();
  agents.forEach((agent, idx) => {
    if (typeof sourceDeployState.agents[agent] !== 'boolean') {
      sourceDeployState.agents[agent] = idx === 0;
    }
  });

  const templateNames = (data.templatesSource || []).map((t) => t.name);
  if (!sourceDeployState.activeTemplate || !templateNames.includes(sourceDeployState.activeTemplate)) {
    sourceDeployState.activeTemplate = templateNames[0] || '';
  }

  (data.globalSource || []).forEach((name) => {
    const p = 'content/instructions/global/' + name;
    if (typeof sourceDeployState.globalFiles[p] !== 'boolean') {
      sourceDeployState.globalFiles[p] = true;
    }
  });

  (data.templatesSource || []).forEach((tpl) => {
    const paths = [];
    ['Planning', 'Coding', 'Review', 'Other'].forEach((cat) => {
      (tpl.instructionsByCategory[cat] || []).forEach((filename) => {
        paths.push(sourcePathForTemplateInstruction(tpl.name, filename));
      });
    });

    sourceDeployState.templateFiles[tpl.name] = sourceDeployState.templateFiles[tpl.name] || {};
    paths.forEach((p) => {
      if (typeof sourceDeployState.templateFiles[tpl.name][p] !== 'boolean') {
        sourceDeployState.templateFiles[tpl.name][p] = true;
      }
    });
  });

  (data.extras || []).forEach((item) => {
    if (typeof sourceDeployState.extrasFiles[item.path] !== 'boolean') {
      sourceDeployState.extrasFiles[item.path] = true;
    }
  });
}

function selectedDeployAgents() {
  return Object.keys(sourceDeployState.agents).filter((agent) => sourceDeployState.agents[agent]);
}

function collectSelectedSourcePaths() {
  const out = [];

  if (sourceDeployState.globalEnabled) {
    Object.keys(sourceDeployState.globalFiles).forEach((path) => {
      if (sourceDeployState.globalFiles[path]) out.push(path);
    });
  }

  const tpl = sourceDeployState.activeTemplate;
  if (tpl && sourceDeployState.templateFiles[tpl]) {
    Object.keys(sourceDeployState.templateFiles[tpl]).forEach((path) => {
      if (sourceDeployState.templateFiles[tpl][path]) out.push(path);
    });
  }

  Object.keys(sourceDeployState.extrasFiles).forEach((path) => {
    if (sourceDeployState.extrasFiles[path]) out.push(path);
  });

  return out;
}

function matchesRenderedAgent(path, agent) {
  const p = String(path || '').toLowerCase();
  if (agent === 'all') return true;
  if (agent === 'orkestra') return p.includes('.orkestra/') || p.includes('orkestra');
  if (agent === 'copilot') return p.includes('copilot') || p.includes('.github/');
  if (agent === 'claude') return p.includes('claude');
  if (agent === 'codex') return p.includes('agents.md') || p.includes('codex');
  return false;
}

function startDevHotReload() {
  setInterval(async () => {
    try {
      const payload = await apiGet('/api/dev-hash');
      const nextHash = payload.hash || '';

      if (!devHash) {
        devHash = nextHash;
        return;
      }

      if (nextHash !== devHash) {
        setStatus('Change detected. Reloading UI ...');
        window.location.reload();
      }
    } catch (_err) {
      // Ignore transient failures during server restart while editing.
    }
  }, 1000);
}

function setStatus(msg) {
  // Status element removed from header, log to console for debugging
  console.log('[Orkestra]', msg);
}

function clearNode(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

function closeConfirmModal(result) {
  if (!confirmModal || !confirmModalResolver) return;
  confirmModal.hidden = true;
  document.body.style.overflow = '';
  const resolve = confirmModalResolver;
  confirmModalResolver = null;
  resolve(result);
}

function showConfirmModal(content) {
  if (!confirmModal || !confirmModalBody || !confirmModalConfirm || !confirmModalCancel) {
    return Promise.resolve(false);
  }

  if (confirmModalResolver) {
    closeConfirmModal(false);
  }

  clearNode(confirmModalBody);

  if (typeof content === 'string') {
    confirmModalBody.textContent = content;
  } else if (content && typeof content === 'object') {
    if (content.lead) {
      const lead = document.createElement('p');
      lead.className = 'modalLead';
      lead.textContent = content.lead;
      confirmModalBody.appendChild(lead);
    }

    if (Array.isArray(content.meta) && content.meta.length) {
      const metaList = document.createElement('dl');
      metaList.className = 'modalMetaList';
      content.meta.forEach((item) => {
        const dt = document.createElement('dt');
        dt.textContent = item.label;
        const dd = document.createElement('dd');
        dd.textContent = item.value;
        metaList.appendChild(dt);
        metaList.appendChild(dd);
      });
      confirmModalBody.appendChild(metaList);
    }

    if (Array.isArray(content.items) && content.items.length) {
      const listTitle = document.createElement('p');
      listTitle.className = 'modalListTitle';
      listTitle.textContent = 'Selected files';
      confirmModalBody.appendChild(listTitle);

      const list = document.createElement('ul');
      list.className = 'modalItemList';
      content.items.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        list.appendChild(li);
      });
      confirmModalBody.appendChild(list);
    }

    if (content.note) {
      const note = document.createElement('p');
      note.className = 'modalNote';
      note.textContent = content.note;
      confirmModalBody.appendChild(note);
    }
  }

  confirmModal.hidden = false;
  document.body.style.overflow = 'hidden';

  return new Promise((resolve) => {
    confirmModalResolver = resolve;
    confirmModalConfirm.focus();
  });
}

async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

async function apiPost(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

function refLabel(fileRef) {
  if (!fileRef) return '-';
  return `${fileRef.location}: ${fileRef.path}`;
}

function shortPathLabel(relPath) {
  const globalPath = relPath.match(/^global\/[^/]+\/(.+)$/);
  if (globalPath) return globalPath[1];

  const templateInstruction = relPath.match(/^content\/templates\/[^/]+\/instructions\/(.+)$/);
  if (templateInstruction) return templateInstruction[1];

  const templateRoot = relPath.match(/^content\/templates\/[^/]+\/(template\.yaml)$/);
  if (templateRoot) return templateRoot[1];

  const globalSource = relPath.match(/^content\/instructions\/global\/(.+)$/);
  if (globalSource) return globalSource[1];

  const renderedTemplate = relPath.match(/^\.orkestra\/instructions\/template\/(.+)$/);
  if (renderedTemplate) return renderedTemplate[1];

  const renderedGlobal = relPath.match(/^\.orkestra\/instructions\/global\/(.+)$/);
  if (renderedGlobal) return renderedGlobal[1];

  return relPath;
}

function sourcePathForTemplateInstruction(templateName, filename) {
  return 'content/templates/' + templateName + '/instructions/' + filename;
}

function renderedPathForTemplateInstruction(filename) {
  return '.orkestra/instructions/template/' + filename;
}

function renderedPathForGlobalInstruction(filename) {
  return '.orkestra/instructions/global/' + filename;
}

function globalInstructionCategory(path, templateNames) {
  const lower = String(path || '').toLowerCase();
  if (lower.endsWith('.json')) return 'Config';
  if (!lower.endsWith('.md')) return '';

  for (const name of templateNames) {
    if (lower.includes(name.toLowerCase())) return name;
  }

  return 'Global Instructions';
}

function fileButton(fileRef) {
  const btn = document.createElement('button');
  btn.className = 'fileBtn';
  btn.textContent = shortPathLabel(fileRef.path);
  btn.title = fileRef.path;
  btn.dataset.ref = JSON.stringify(fileRef);
  btn.onclick = () => handleFilePick(fileRef);
  return btn;
}

function fileKey(fileRef) {
  return `${fileRef.location}:${fileRef.path}`;
}

function disableCompareMode() {
  compareMode = false;
  compareArmed = false;
  comparePrimaryKey = '';
  clearSecondary();
  if (compareCheckbox) compareCheckbox.checked = false;
  renderSelectionMeta();
  setButtonStates();
}

function addFileButton(parent, fileRef) {
  const li = document.createElement('li');
  li.appendChild(fileButton(fileRef));
  parent.appendChild(li);
}

function createEmptyMessage(text) {
  const div = document.createElement('div');
  div.className = 'small';
  div.textContent = text;
  return div;
}

function renderSourceColumn(data) {
  sourceColumn.innerHTML = '';
  ensureSourceDeployState(data);

  const globalCard = document.createElement('details');
  globalCard.className = 'templateCard';
  globalCard.open = true;

  const globalSummary = document.createElement('summary');
  globalSummary.className = 'templateSummary';

  const globalSummaryRow = document.createElement('span');
  globalSummaryRow.className = 'inlineSummaryRow';
  const globalHeaderCheck = document.createElement('input');
  globalHeaderCheck.type = 'checkbox';
  globalHeaderCheck.checked = !!sourceDeployState.globalEnabled;
  globalHeaderCheck.onclick = (e) => e.stopPropagation();
  globalHeaderCheck.onchange = () => {
    sourceDeployState.globalEnabled = globalHeaderCheck.checked;
  };
  const globalLabel = document.createElement('span');
  globalLabel.textContent = 'Global Instructions';
  globalSummaryRow.appendChild(globalHeaderCheck);
  globalSummaryRow.appendChild(globalLabel);

  globalSummary.appendChild(globalSummaryRow);
  globalCard.appendChild(globalSummary);

  const globalList = document.createElement('ul');
  (data.globalSource || []).forEach((name) => {
    const path = 'content/instructions/global/' + name;
    const li = document.createElement('li');
    li.className = 'sourceRow';

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = !!sourceDeployState.globalFiles[path];
    check.onchange = () => {
      sourceDeployState.globalFiles[path] = check.checked;
      if (!check.checked) {
        sourceDeployState.globalEnabled = false;
        renderSourceColumn(data);
      }
    };

    const btn = fileButton({ location: 'source', path });
    li.appendChild(check);
    li.appendChild(btn);
    globalList.appendChild(li);
  });
  if (!globalList.children.length) {
    globalCard.appendChild(createEmptyMessage('No source global files.'));
  } else {
    globalCard.appendChild(globalList);
  }
  sourceColumn.appendChild(globalCard);

  const languageCard = document.createElement('details');
  languageCard.className = 'templateCard languageSpecificCard';
  languageCard.open = true;

  const languageSummary = document.createElement('summary');
  languageSummary.className = 'templateSummary';
  languageSummary.textContent = 'Language Specific Instructions';
  languageCard.appendChild(languageSummary);

  const languageBody = document.createElement('div');
  languageBody.className = 'languageSpecificBody';

  (data.templatesSource || []).forEach((t) => {
    const card = document.createElement('details');
    card.className = 'templateCard';
    card.open = sourceDeployState.activeTemplate === t.name;

    const summary = document.createElement('summary');
    summary.className = 'templateSummary';
    const summaryRow = document.createElement('span');
    summaryRow.className = 'inlineSummaryRow';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'sourceTemplateChoice';
    radio.checked = sourceDeployState.activeTemplate === t.name;
    radio.onclick = (e) => e.stopPropagation();
    radio.onchange = () => {
      sourceDeployState.activeTemplate = t.name;
      renderSourceColumn(data);
      setActiveButtons();
    };

    const title = document.createElement('span');
    title.textContent = t.name;
    summaryRow.appendChild(radio);
    summaryRow.appendChild(title);
    summary.appendChild(summaryRow);
    card.appendChild(summary);

    const paths = [];
    ['Planning', 'Coding', 'Review', 'Other'].forEach((cat) => {
      (t.instructionsByCategory[cat] || []).forEach((filename) => {
        paths.push(sourcePathForTemplateInstruction(t.name, filename));
      });
    });

    const ul = document.createElement('ul');
    paths.forEach((path) => {
      const li = document.createElement('li');
      li.className = 'sourceRow';

      const check = document.createElement('input');
      check.type = 'checkbox';
      const templateState = sourceDeployState.templateFiles[t.name] || {};
      check.checked = !!templateState[path];
      check.onchange = () => {
        sourceDeployState.templateFiles[t.name][path] = check.checked;
      };

      const btn = fileButton({ location: 'source', path });
      li.appendChild(check);
      li.appendChild(btn);
      ul.appendChild(li);
    });

    if (!ul.children.length) {
      card.appendChild(createEmptyMessage('No template instruction files.'));
    } else {
      card.appendChild(ul);
    }
    languageBody.appendChild(card);
  });

  if (!languageBody.children.length) {
    languageCard.appendChild(createEmptyMessage('No language specific templates found.'));
  } else {
    languageCard.appendChild(languageBody);
  }
  sourceColumn.appendChild(languageCard);

  // Extras: skills, mcp, workflows, etc.
  const extrasByCategory = {};
  (data.extras || []).forEach((item) => {
    extrasByCategory[item.category] = extrasByCategory[item.category] || [];
    extrasByCategory[item.category].push(item.path);
  });

  Object.keys(extrasByCategory).sort().forEach((cat) => {
    const extCard = document.createElement('details');
    extCard.className = 'templateCard';
    extCard.open = false;

    const extSummary = document.createElement('summary');
    extSummary.className = 'templateSummary';
    extSummary.textContent = titleCase(cat);
    extCard.appendChild(extSummary);

    const extUl = document.createElement('ul');
    (extrasByCategory[cat] || []).forEach((path) => {
      const li = document.createElement('li');
      li.className = 'sourceRow';

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = !!sourceDeployState.extrasFiles[path];
      check.onchange = () => {
        sourceDeployState.extrasFiles[path] = check.checked;
      };

      const btn = fileButton({ location: 'source', path });
      li.appendChild(check);
      li.appendChild(btn);
      extUl.appendChild(li);
    });

    if (!extUl.children.length) {
      extCard.appendChild(createEmptyMessage('No files.'));
    } else {
      extCard.appendChild(extUl);
    }
    sourceColumn.appendChild(extCard);
  });
}

function renderAgentFilters(agents) {
  if (!agentFilters) return;
  
  agentFilters.innerHTML = '';
  
  if (!agents || !agents.length) {
    return;
  }
  
  // Set default if not set
  if (!activeAgentFilter && agents.length > 0) {
    activeAgentFilter = agents[0];
  }
  
  agents.forEach((agent) => {
    const btn = document.createElement('button');
    btn.className = 'pillBtn' + (agent === activeAgentFilter ? ' active' : '');
    btn.textContent = titleCase(agent);
    btn.type = 'button';
    btn.dataset.agent = agent;
    btn.setAttribute('aria-pressed', agent === activeAgentFilter ? 'true' : 'false');
    btn.onclick = () => {
      activeAgentFilter = agent;
      renderAgentFilters(agents);
      if (latestIndex) {
        renderGlobalColumn(latestIndex);
        renderRenderedColumn(latestIndex);
      }
      updateApplyButtonStates();
      setActiveButtons();
    };
    agentFilters.appendChild(btn);
  });
}

function selectedGlobalPathsForAgent(agent) {
  if (!agent) return [];
  const prefix = 'global/' + agent + '/';
  return Object.keys(globalSelectionState).filter((path) => path.startsWith(prefix) && globalSelectionState[path]);
}

function selectedProjectPathsForAgent(agent) {
  if (!agent) return [];
  const prefix = 'project/' + agent + '/';
  return Object.keys(renderedSelectionState).filter((path) => path.startsWith(prefix) && renderedSelectionState[path]);
}

function applyButtonLabel(scope, agent, count) {
  const arrow = scope === 'global' ? '↗' : '↘';
  const agentLabel = agent ? titleCase(agent) : 'Agent';
  return 'APPLY ' + arrow + ' ' + agentLabel + (count ? ' (' + count + ')' : '');
}

function updateApplyButtonStates() {
  const globalCount = selectedGlobalPathsForAgent(activeAgentFilter).length;
  const projectCount = selectedProjectPathsForAgent(activeAgentFilter).length;

  if (globalApplyBtn) {
    globalApplyBtn.disabled = !activeAgentFilter || globalCount === 0;
    globalApplyBtn.textContent = applyButtonLabel('global', activeAgentFilter, globalCount);
    globalApplyBtn.title = activeAgentFilter
      ? 'Apply selected GLOBAL items to global scope for ' + titleCase(activeAgentFilter)
      : 'Select one agent first';
  }

  if (renderedApplyBtn) {
    renderedApplyBtn.disabled = !activeAgentFilter || projectCount === 0;
    renderedApplyBtn.textContent = applyButtonLabel('project', activeAgentFilter, projectCount);
    renderedApplyBtn.title = activeAgentFilter
      ? 'Apply selected GLOBAL items to project scope for ' + titleCase(activeAgentFilter)
      : 'Select one agent first';
  }
}

function renderHeaderApplyControls() {
  if (globalHeaderControls) {
    globalHeaderControls.innerHTML = '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'headerApplyBtn';
    btn.onclick = () => applyGlobalSelectionToScope('global');
    globalHeaderControls.appendChild(btn);
    globalApplyBtn = btn;
  } else {
    globalApplyBtn = null;
  }

  if (renderedHeaderControls) {
    renderedHeaderControls.innerHTML = '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'headerApplyBtn';
    btn.onclick = () => applyGlobalSelectionToScope('project');
    renderedHeaderControls.appendChild(btn);
    renderedApplyBtn = btn;
  } else {
    renderedApplyBtn = null;
  }

  updateApplyButtonStates();
}

function getDeploymentsForScope(scope, agent, itemType = null) {
  const deployments = (latestIndex?.deployments || []).filter(d => 
    d.scope === scope && 
    d.agent === agent &&
    (!itemType || d.item_type === itemType)
  );
  return deployments;
}

async function applyGlobalSelectionToScope(scope) {
  const agent = activeAgentFilter;
  if (!agent) {
    alert('Select one agent first.');
    return;
  }

  const selectedPaths = selectedGlobalPathsForAgent(agent);
  if (!selectedPaths.length) {
    alert('Select at least one item in B: GLOBAL for ' + titleCase(agent) + '.');
    return;
  }

  // Get all deployments for this agent and scope
  const deployments = getDeploymentsForScope(scope, agent);
  if (!deployments.length) {
    alert('No deployments configured for ' + titleCase(agent) + ' in ' + scope + ' scope.');
    return;
  }

  const deploymentIds = deployments.map(d => d.id);
  const scopeLabel = scope === 'global' ? 'Global scope' : 'Project scope';

  const ok = await showConfirmModal({
    lead: 'Deploy ' + titleCase(agent) + ' configurations to ' + scopeLabel + '?',
    meta: [
      { label: 'Scope', value: scopeLabel },
      { label: 'Agent', value: titleCase(agent) },
      { label: 'Deployments', value: String(deploymentIds.length) },
    ],
    items: deploymentIds,
    note: 'This will execute configured deployment strategies for selected scope.',
  });
  if (!ok) return;

  try {
    console.log('Deploying:', { agent, scope, deploymentIds });
    const result = await apiPost('/api/deploy', {
      agent: agent,
      scope: scope,
      deploymentIds: deploymentIds,
      template: latestIndex?.project?.template || null
    });

    console.log('Deploy results:', result);
    
    // Handle results array
    const results = result.results || [];
    const failed = results.filter(r => !r.success);
    
    if (failed.length) {
      console.error('Deployment failures:', failed);
      const failedIds = failed.map(r => r.deployment_id).join(', ');
      alert('Some deployments failed: ' + failedIds + '\n\nCheck console for details.');
    } else {
      console.log('All deployments succeeded:', results);
    }
    
    await loadIndex();
  } catch (err) {
    console.error('Deploy error:', err);
    alert('Deploy failed: ' + err.message);
  }
}

async function deploySectionFromTop(destination) {
  if (destination === 'project') {
    const ok = window.confirm('Deploy to project scope? This can create or overwrite project-level instruction files in the current folder.');
    if (!ok) return;
  }

  const agents = selectedDeployAgents();
  if (!agents.length) {
    alert('Select at least one agent target at the top right first.');
    return;
  }

  const sourcePaths = collectSelectedSourcePaths();
  if (!sourcePaths.length) {
    alert('Select at least one source variant (header/file checkbox or active template file).');
    return;
  }

  try {
    setStatus('Deploying selected variants to ' + destination + ' ...');
    const result = await apiPost('/api/deploy-section', {
      destination,
      sourcePaths,
      agents,
    });

    const deployMessage = ((result.stdout || '') + '\n' + (result.stderr || '')).trim();
    setStatus(deployMessage || 'Variant deploy finished');
    await loadIndex();
  } catch (err) {
    setStatus('Variant deploy failed');
    alert('Variant deploy failed: ' + err.message);
  }
}

function renderGlobalColumn(data) {
  globalColumn.innerHTML = '';
  const hint = createEmptyMessage('Common locations only. Customize via global/orkestra/.config/orkestra/settings.yaml');
  globalColumn.appendChild(hint);

  const byAgent = data.globalByAgent || {};
  const templateNames = (data.templatesSource || []).map((t) => t.name);

  const grouped = {};
  const categoryOrder = ['Global Instructions', ...templateNames, 'Config'];

  Object.keys(byAgent).forEach((agent) => {
    if (activeAgentFilter && activeAgentFilter !== agent) return;
    (byAgent[agent] || []).forEach((path) => {
      const category = globalInstructionCategory(path, templateNames);
      if (!category) return;
      grouped[category] = grouped[category] || {};
      grouped[category][agent] = grouped[category][agent] || [];
      grouped[category][agent].push(path);
    });
  });

  const presentCategories = categoryOrder.filter((cat) => grouped[cat] && Object.keys(grouped[cat]).length);
  if (!presentCategories.length) {
    globalColumn.appendChild(createEmptyMessage('No copied instruction files available in Global.'));
    return;
  }

  const globalGroupCard = document.createElement('details');
  globalGroupCard.className = 'templateCard';
  globalGroupCard.open = true;

  const globalGroupSummary = document.createElement('summary');
  globalGroupSummary.className = 'templateSummary';
  globalGroupSummary.textContent = 'Global Instructions';
  globalGroupCard.appendChild(globalGroupSummary);

  const globalGroupBody = document.createElement('div');
  globalGroupBody.className = 'languageSpecificBody';

  const languageGroupCard = document.createElement('details');
  languageGroupCard.className = 'templateCard languageSpecificCard';
  languageGroupCard.open = true;

  const languageGroupSummary = document.createElement('summary');
  languageGroupSummary.className = 'templateSummary';
  languageGroupSummary.textContent = 'Language Specific Instructions';
  languageGroupCard.appendChild(languageGroupSummary);

  const languageGroupBody = document.createElement('div');
  languageGroupBody.className = 'languageSpecificBody';

  presentCategories.forEach((category) => {
    const catCard = document.createElement('details');
    catCard.className = 'templateCard globalCategoryCard';
    catCard.open = category === 'Global Instructions';

    const catSummary = document.createElement('summary');
    catSummary.className = 'templateSummary';
    catSummary.textContent = category;
    catCard.appendChild(catSummary);

    const agentMap = grouped[category] || {};
    Object.keys(agentMap).sort().forEach((agent) => {
      const agentCard = document.createElement('details');
      agentCard.className = 'templateCard globalAgentCard';
      agentCard.open = true;

      const agentSummary = document.createElement('summary');
      agentSummary.className = 'templateSummary';
      agentSummary.textContent = titleCase(agent);
      agentCard.appendChild(agentSummary);

      const ul = document.createElement('ul');
      ul.className = 'globalInstructionList';
      (agentMap[agent] || []).forEach((path) => {
        const li = document.createElement('li');
        li.className = 'sourceRow';

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = !!globalSelectionState[path];
        check.onchange = () => {
          globalSelectionState[path] = check.checked;
          updateApplyButtonStates();
        };

        const btn = fileButton({ location: 'global', path });
        li.appendChild(check);
        li.appendChild(btn);
        ul.appendChild(li);
      });
      agentCard.appendChild(ul);

      catCard.appendChild(agentCard);
    });

    const isLanguageSpecific = templateNames.includes(category);
    if (isLanguageSpecific) {
      languageGroupBody.appendChild(catCard);
    } else {
      globalGroupBody.appendChild(catCard);
    }
  });

  if (!globalGroupBody.children.length) {
    globalGroupCard.appendChild(createEmptyMessage('No global instruction files available.'));
  } else {
    globalGroupCard.appendChild(globalGroupBody);
  }
  globalColumn.appendChild(globalGroupCard);

  if (!languageGroupBody.children.length) {
    languageGroupCard.appendChild(createEmptyMessage('No language specific instruction files available.'));
  } else {
    languageGroupCard.appendChild(languageGroupBody);
  }
  globalColumn.appendChild(languageGroupCard);
}

function renderRenderedColumn(data) {
  renderedColumn.innerHTML = '';

  const globalCard = document.createElement('details');
  globalCard.className = 'templateCard';
  globalCard.open = true;

  const globalSummary = document.createElement('summary');
  globalSummary.className = 'templateSummary';
  globalSummary.textContent = 'Global Instructions';
  globalCard.appendChild(globalSummary);

  const globalList = document.createElement('ul');

  if (data.renderedAvailable) {
    (data.globalRendered || []).forEach((name) => {
      const path = renderedPathForGlobalInstruction(name);
      if (!activeAgentFilter || matchesRenderedAgent(path, activeAgentFilter)) {
        addFileButton(globalList, { location: 'rendered', path });
      }
    });
  }

  if (!globalList.children.length) {
    const globalMessage = data.renderedAvailable
      ? 'No rendered global files.'
      : 'Project is not initialized yet.';
    globalCard.appendChild(createEmptyMessage(globalMessage));
  } else {
    globalCard.appendChild(globalList);
  }
  renderedColumn.appendChild(globalCard);

  const languageCard = document.createElement('details');
  languageCard.className = 'templateCard languageSpecificCard';
  languageCard.open = true;

  const languageSummary = document.createElement('summary');
  languageSummary.className = 'templateSummary';
  languageSummary.textContent = 'Language Specific Instructions';
  languageCard.appendChild(languageSummary);

  const renderedTemplate = data.templateRendered;
  if (!data.renderedAvailable || !renderedTemplate) {
    const languageMessage = data.renderedAvailable
      ? 'No rendered template data.'
      : 'Project is not initialized yet.';
    languageCard.appendChild(createEmptyMessage(languageMessage));
    renderedColumn.appendChild(languageCard);
    return;
  }

  const templateCard = document.createElement('details');
  templateCard.className = 'templateCard';
  templateCard.open = true;

  const templateSummary = document.createElement('summary');
  templateSummary.className = 'templateSummary';
  templateSummary.textContent = renderedTemplate.name || 'Template (Rendered)';
  templateCard.appendChild(templateSummary);

  const order = ['Planning', 'Coding', 'Review', 'Other'];
  const ul = document.createElement('ul');
  order.forEach((cat) => {
    const files = renderedTemplate.instructionsByCategory[cat] || [];
    files.forEach((filename) => {
      const path = renderedPathForTemplateInstruction(filename);
      if (!activeAgentFilter || matchesRenderedAgent(path, activeAgentFilter)) {
        addFileButton(ul, { location: 'rendered', path });
      }
    });
  });

  if (!ul.children.length) {
    templateCard.appendChild(createEmptyMessage('No rendered template files.'));
  } else {
    templateCard.appendChild(ul);
  }

  const languageBody = document.createElement('div');
  languageBody.className = 'languageSpecificBody';
  languageBody.appendChild(templateCard);
  languageCard.appendChild(languageBody);
  renderedColumn.appendChild(languageCard);
}

function setButtonStates() {
  const hasCompareTarget = compareMode && !!secondary;
  const leftWritable = !!primary && !primary.readOnly;
  const rightWritable = !!secondary && !secondary.readOnly;

  if (savePrimaryBtn) savePrimaryBtn.disabled = !leftWritable;
  if (saveSecondaryBtn) saveSecondaryBtn.disabled = !hasCompareTarget || !rightWritable;

  const bothSelected = !!primary && !!secondary;
  if (applyLeftToRightBtn) applyLeftToRightBtn.disabled = !hasCompareTarget || !(bothSelected && rightWritable);
  if (applyRightToLeftBtn) applyRightToLeftBtn.disabled = !hasCompareTarget || !(bothSelected && leftWritable);

}

function editorLines(text) {
  if (!text) return [];
  return text.split('\n');
}

function setEditorFromLines(editor, lines) {
  editor.value = lines.join('\n');
}

function mk(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

const DIFF_CONTEXT = 3;

function makeDiffSide(cls, lineNum, text) {
  const side = mk('div', 'diffSide ' + cls);
  side.appendChild(mk('span', 'diffNum', lineNum !== null && lineNum !== undefined ? String(lineNum) : ''));
  side.appendChild(mk('span', 'diffCode', text !== undefined && text !== null ? text : ''));
  return side;
}

function makeDiffRow(tag, leftNum, leftText, rightNum, rightText) {
  const row = mk('div', 'diffRow ' + tag);
  row.appendChild(makeDiffSide('left', leftNum, leftText));
  row.appendChild(makeDiffSide('right', rightNum, rightText));
  return row;
}

function renderSideBySideDiff(blocks, leftLines, rightLines) {
  diffVisual.innerHTML = '';
  currentDiffBlocks = blocks || [];
  leftLines = leftLines || [];
  rightLines = rightLines || [];

  if (!currentDiffBlocks.length) {
    if (leftLines.length) {
      diffVisual.appendChild(mk('div', 'diffEmpty', 'Files are identical.'));
    }
    return;
  }

  let li = 0;
  let ri = 0;

  currentDiffBlocks.forEach((block) => {
    const ctxStart = Math.max(li, block.leftStart - DIFF_CONTEXT);
    const ctxRStart = ri + (ctxStart - li);

    if (ctxStart > li) {
      const skipped = ctxStart - li;
      const sep = mk('div', 'diffSeparator');
      sep.textContent = `⋯  ${skipped} unchanged line${skipped !== 1 ? 's' : ''}  ⋯`;
      diffVisual.appendChild(sep);
    }

    for (let i = 0; i < block.leftStart - ctxStart; i++) {
      const lIdx = ctxStart + i;
      const rIdx = ctxRStart + i;
      diffVisual.appendChild(makeDiffRow('equal', lIdx + 1, leftLines[lIdx], rIdx + 1, rightLines[rIdx]));
    }

    const bar = mk('div', 'diffHunkBar');
    const lCount = block.leftEnd - block.leftStart;
    const rCount = block.rightEnd - block.rightStart;
    bar.appendChild(mk('span', 'diffHunkLabel',
      `@@ -${block.leftStart + 1},${lCount} +${block.rightStart + 1},${rCount} @@`));
    const acts = mk('span', 'diffHunkActions');
    const r2l = mk('button', 'diffBtn', '← accept left');
    r2l.title = 'Replace right side with left (keep left)';
    r2l.onclick = () => applyHunk(block, 'rightToLeft');
    const l2r = mk('button', 'diffBtn', 'accept right →');
    l2r.title = 'Replace left side with right (keep right)';
    l2r.onclick = () => applyHunk(block, 'leftToRight');
    acts.appendChild(r2l);
    acts.appendChild(l2r);
    bar.appendChild(acts);
    diffVisual.appendChild(bar);

    const lLines = block.leftLines || [];
    const rLines = block.rightLines || [];
    const rows = Math.max(lLines.length, rLines.length);
    for (let i = 0; i < rows; i++) {
      const lText = lLines[i];
      const rText = rLines[i];
      const lNum = lText !== undefined ? block.leftStart + i + 1 : null;
      const rNum = rText !== undefined ? block.rightStart + i + 1 : null;
      let tag = 'changed';
      if (lText !== undefined && rText === undefined) tag = 'removed';
      else if (lText === undefined && rText !== undefined) tag = 'added';
      diffVisual.appendChild(makeDiffRow(tag, lNum, lText, rNum, rText));
    }

    li = block.leftEnd;
    ri = block.rightEnd;
  });

  const trailEnd = Math.min(li + DIFF_CONTEXT, leftLines.length);
  for (let i = li; i < trailEnd; i++) {
    const rIdx = ri + (i - li);
    diffVisual.appendChild(makeDiffRow('equal', i + 1, leftLines[i], rIdx + 1, rightLines[rIdx]));
  }

  const remaining = leftLines.length - trailEnd;
  if (remaining > 0) {
    const sep = mk('div', 'diffSeparator');
    sep.textContent = `⋯  ${remaining} unchanged line${remaining !== 1 ? 's' : ''}  ⋯`;
    diffVisual.appendChild(sep);
  }
}

async function applyHunk(block, direction) {
  if (!primary || !secondary) return;

  const leftLines = editorLines(leftEditor.value);
  const rightLines = editorLines(rightEditor.value);

  if (direction === 'leftToRight') {
    const replacement = leftLines.slice(block.leftStart, block.leftEnd);
    rightLines.splice(block.rightStart, block.rightEnd - block.rightStart, ...replacement);
    setEditorFromLines(rightEditor, rightLines);
    secondary.content = rightEditor.value;
  } else {
    const replacement = rightLines.slice(block.rightStart, block.rightEnd);
    leftLines.splice(block.leftStart, block.leftEnd - block.leftStart, ...replacement);
    setEditorFromLines(leftEditor, leftLines);
    primary.content = leftEditor.value;
  }

  setStatus('Applied hunk ' + block.id + ' (' + (direction === 'leftToRight' ? '→' : '←') + ')');
  await refreshDiff();
}

function setActiveButtons() {
  const buttons = [...document.querySelectorAll('.fileBtn')];
  buttons.forEach((btn) => btn.classList.remove('active'));

  [primary, secondary].forEach((sel) => {
    if (!sel) return;
    const key = JSON.stringify({ location: sel.location, path: sel.path });
    const match = buttons.find((btn) => btn.dataset.ref === key);
    if (match) match.classList.add('active');
  });
}

function renderSelectionMeta() {
  if (leftMeta) leftMeta.textContent = 'Preview: ' + refLabel(primary);
  if (rightMeta) rightMeta.textContent = 'Compare: ' + refLabel(secondary);

  if (currentPathEl) {
    if (primary) {
      currentPathEl.textContent = refLabel(primary);
    } else {
      currentPathEl.textContent = 'No file selected';
    }
  }

  // Show/hide compare checkbox label
  if (compareCheckLabel) compareCheckLabel.hidden = !primary;
  if (compareCheckbox && !compareMode) compareCheckbox.checked = false;

  // rightCol textarea stays hidden always – it's just a data source for the diff
  rightCol.hidden = true;
  rightCol.style.display = 'none';

  // In compare mode the grid hides editors and shows diffVisual in their place
  const inDiffView = !!(compareMode && secondary);
  previewGrid.classList.toggle('compareMode', inDiffView);
  diffVisual.hidden = !inDiffView;
  diffVisual.style.display = inDiffView ? 'flex' : 'none';
}

async function readFileRef(fileRef) {
  const data = await apiGet('/api/file?mode=' + encodeURIComponent(fileRef.location) + '&path=' + encodeURIComponent(fileRef.path));
  return {
    ...fileRef,
    readOnly: !!data.readOnly,
    content: data.content || '',
  };
}

async function refreshDiff() {
  if (!compareMode || !primary || !secondary) {
    renderSideBySideDiff([], [], []);
    setButtonStates();
    return;
  }

  try {
    const diff = await apiPost('/api/compare-structured', {
      leftLabel: `${primary.location}/${primary.path}`,
      rightLabel: `${secondary.location}/${secondary.path}`,
      leftContent: leftEditor.value,
      rightContent: rightEditor.value,
    });

    diffVisual.hidden = false;
    renderSideBySideDiff(diff.blocks || [], editorLines(leftEditor.value), editorLines(rightEditor.value));
    setButtonStates();
  } catch (err) {
    renderSideBySideDiff([], [], []);
    setButtonStates();
  }
}

function clearSecondary() {
  secondary = null;
  rightEditor.value = '';
  rightEditor.readOnly = true;
  renderSideBySideDiff([], [], []);
}

async function handleFilePick(fileRef) {
  try {
    setStatus('Loading file ...');
    const resolved = await readFileRef(fileRef);

    if (compareMode && primary && fileKey(resolved) !== fileKey(primary)) {
      secondary = resolved;
      rightEditor.value = secondary.content;
      rightEditor.readOnly = secondary.readOnly;
      compareArmed = false;
      setStatus('Compare target loaded');
    } else {
      primary = resolved;
      leftEditor.value = primary.content;
      leftEditor.readOnly = primary.readOnly;
      if (!compareMode) {
        clearSecondary();
      }
      setStatus('File loaded');
    }

    renderSelectionMeta();
    setActiveButtons();
    await refreshDiff();
  } catch (err) {
    setStatus('Load failed');
    alert('Failed to load file: ' + err.message);
  }
}

async function loadContext() {
  const ctx = await apiGet('/api/context');
  if (projectPathEl) {
    // Show just the directory name or last part of path
    const pathParts = ctx.projectDir.split('/');
    const dirName = pathParts[pathParts.length - 1] || ctx.projectDir;
    projectPathEl.textContent = dirName;
    projectPathEl.title = ctx.projectDir;  // Full path in tooltip
  }
  if (projectStateEl) projectStateEl.textContent = 'State: ' + (ctx.initialized ? 'initialized' : 'not initialized');
}

async function loadIndex() {
  sourceColumn.innerHTML = '';
  globalColumn.innerHTML = '';
  renderedColumn.innerHTML = '';

  primary = null;
  clearSecondary();
  leftEditor.value = '';
  leftEditor.readOnly = true;
  disableCompareMode();
  compareArmed = false;

  renderSelectionMeta();
  setButtonStates();

  try {
    setStatus('Fetching files ...');
    const data = await apiGet('/api/templates');
    latestIndex = data;

    renderHeaderApplyControls();
    renderAgentFilters(data.agents || []);

    renderSourceColumn(data);
    renderGlobalColumn(data);
    renderRenderedColumn(data);
    updateApplyButtonStates();
    await loadContext();
    setActiveButtons();
    setStatus('Ready');
  } catch (err) {
    setStatus('Index load failed');
    alert('Failed to load file index: ' + err.message);
  }
}

async function saveSide(which) {
  const side = which === 'left' ? primary : secondary;
  const editor = which === 'left' ? leftEditor : rightEditor;

  if (!side || side.readOnly) return;

  try {
    setStatus('Saving ' + side.path + ' ...');
    await apiPost('/api/save', {
      mode: side.location,
      path: side.path,
      content: editor.value,
    });

    side.content = editor.value;
    await refreshDiff();
    setStatus('Saved ' + side.path);
  } catch (err) {
    setStatus('Save failed');
    alert('Save failed: ' + err.message);
  }
}

async function applyCopy(direction) {
  if (!primary || !secondary) return;

  const source = direction === 'leftToRight' ? primary : secondary;
  const target = direction === 'leftToRight' ? secondary : primary;

  try {
    setStatus('Applying ' + source.path + ' -> ' + target.path + ' ...');
    const result = await apiPost('/api/apply-file-copy', {
      source: { mode: source.location, path: source.path },
      target: { mode: target.location, path: target.path },
    });

    const applyMessage = ((result.stdout || '') + '\n' + (result.stderr || '')).trim();

    const updated = await readFileRef({ location: target.location, path: target.path });
    if (direction === 'leftToRight') {
      secondary = updated;
      rightEditor.value = updated.content;
    } else {
      primary = updated;
      leftEditor.value = updated.content;
    }

    renderSelectionMeta();
    setActiveButtons();
    await refreshDiff();
    setStatus(applyMessage || 'Apply finished');
  } catch (err) {
    setStatus('Apply failed');
    alert('Apply failed: ' + err.message);
  }
}

if (savePrimaryBtn) savePrimaryBtn.onclick = () => saveSide('left');
if (saveSecondaryBtn) saveSecondaryBtn.onclick = () => saveSide('right');

if (applyLeftToRightBtn) applyLeftToRightBtn.onclick = () => applyCopy('leftToRight');
if (applyRightToLeftBtn) applyRightToLeftBtn.onclick = () => applyCopy('rightToLeft');

if (compareCheckbox) {
  compareCheckbox.onchange = () => {
    if (!compareCheckbox.checked) {
      disableCompareMode();
      return;
    }
    compareMode = true;
    compareArmed = true;
    comparePrimaryKey = primary ? fileKey(primary) : '';
    renderSelectionMeta();
    setButtonStates();
    setStatus('Compare mode active. Click any file to load into the right side.');
  };
}

if (confirmModalConfirm) {
  confirmModalConfirm.onclick = () => closeConfirmModal(true);
}

if (confirmModalCancel) {
  confirmModalCancel.onclick = () => closeConfirmModal(false);
}

if (confirmModal) {
  confirmModal.addEventListener('click', (event) => {
    if (event.target === confirmModal) closeConfirmModal(false);
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && confirmModalResolver) {
    closeConfirmModal(false);
  }
});

leftEditor.addEventListener('input', () => {
  if (primary) {
    primary.content = leftEditor.value;
    refreshDiff();
  }
});

rightEditor.addEventListener('input', () => {
  if (secondary) {
    secondary.content = rightEditor.value;
    refreshDiff();
  }
});

loadIndex();
startDevHotReload();
