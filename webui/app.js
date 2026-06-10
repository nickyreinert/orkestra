const sourceColumn = document.getElementById('sourceColumn');
const globalColumn = document.getElementById('globalColumn');
const renderedColumn = document.getElementById('renderedColumn');
const globalFilters = document.getElementById('globalFilters');
const renderedFilters = document.getElementById('renderedFilters');
const sourceHeaderControls = document.getElementById('sourceHeaderControls');

const leftEditor = document.getElementById('leftEditor');
const rightEditor = document.getElementById('rightEditor');
const rightCol = document.getElementById('rightCol');
const previewGrid = document.getElementById('previewGrid');

const compareToggle = document.getElementById('compareToggle');
const compareToggleWrap = document.getElementById('compareToggleWrap');
const diffOutput = document.getElementById('diffOutput');
const diffHeader = document.getElementById('diffHeader');
const diffVisual = document.getElementById('diffVisual');
const output = document.getElementById('output');

const savePrimaryBtn = document.getElementById('savePrimaryBtn');
const saveSecondaryBtn = document.getElementById('saveSecondaryBtn');
const applyLeftToRightBtn = document.getElementById('applyLeftToRightBtn');
const applyRightToLeftBtn = document.getElementById('applyRightToLeftBtn');
const copyDiffBtn = document.getElementById('copyDiffBtn');
const copyOutputBtn = document.getElementById('copyOutputBtn');

const projectPathEl = document.getElementById('projectPath');
const projectStateEl = document.getElementById('projectState');
const statusEl = document.getElementById('status');
const currentPathEl = document.getElementById('currentPath');
const leftMeta = document.getElementById('leftMeta');
const rightMeta = document.getElementById('rightMeta');

let latestIndex = null;
let primary = null;
let secondary = null;
let compareArmed = false;
let currentDiffBlocks = [];
let globalAgentFilter = 'all';
let renderedAgentFilter = 'all';
let devHash = null;
const sourceDeployState = {
  agents: {},
  globalEnabled: false,
  globalFiles: {},
  activeTemplate: '',
  templateFiles: {},
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
    const p = 'instructions/global/' + name;
    if (typeof sourceDeployState.globalFiles[p] !== 'boolean') {
      sourceDeployState.globalFiles[p] = true;
    }
  });

  (data.templatesSource || []).forEach((tpl) => {
    const paths = [tpl.templateYaml];
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
  if (statusEl) statusEl.textContent = msg;
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

  const templateInstruction = relPath.match(/^templates\/[^/]+\/instructions\/(.+)$/);
  if (templateInstruction) return templateInstruction[1];

  const templateRoot = relPath.match(/^templates\/[^/]+\/(template\.yaml)$/);
  if (templateRoot) return templateRoot[1];

  const globalSource = relPath.match(/^instructions\/global\/(.+)$/);
  if (globalSource) return globalSource[1];

  const renderedTemplate = relPath.match(/^\.orkestra\/instructions\/template\/(.+)$/);
  if (renderedTemplate) return renderedTemplate[1];

  const renderedGlobal = relPath.match(/^\.orkestra\/instructions\/global\/(.+)$/);
  if (renderedGlobal) return renderedGlobal[1];

  return relPath;
}

function sourcePathForTemplateInstruction(templateName, filename) {
  return 'templates/' + templateName + '/instructions/' + filename;
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

  if (sourceHeaderControls) {
    sourceHeaderControls.innerHTML = '';
    const inlineDeploy = document.createElement('span');
    inlineDeploy.className = 'inlineDeployControls';

    const deployGlobalBtn = document.createElement('button');
    deployGlobalBtn.type = 'button';
    deployGlobalBtn.className = 'inlineDeployBtn';
    deployGlobalBtn.textContent = 'G';
    deployGlobalBtn.title = 'Deploy selected source variants to global scope';
    deployGlobalBtn.onclick = () => deploySectionFromTop('global');
    inlineDeploy.appendChild(deployGlobalBtn);

    const deployProjectBtn = document.createElement('button');
    deployProjectBtn.type = 'button';
    deployProjectBtn.className = 'inlineDeployBtn';
    deployProjectBtn.textContent = 'P';
    deployProjectBtn.title = 'Deploy selected source variants to project scope';
    deployProjectBtn.onclick = () => deploySectionFromTop('project');
    inlineDeploy.appendChild(deployProjectBtn);

    const inlineAgents = document.createElement('span');
    inlineAgents.className = 'inlineAgentChecks';
    (data.agents || []).forEach((agent) => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!sourceDeployState.agents[agent];
      checkbox.onchange = () => {
        sourceDeployState.agents[agent] = checkbox.checked;
      };
      label.appendChild(checkbox);
      label.append(' ' + titleCase(agent));
      inlineAgents.appendChild(label);
    });

    inlineDeploy.appendChild(inlineAgents);
    sourceHeaderControls.appendChild(inlineDeploy);
  }

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
    const path = 'instructions/global/' + name;
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

    const paths = [t.templateYaml];
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
    sourceColumn.appendChild(card);
  });
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

    output.value = ((result.stdout || '') + '\n' + (result.stderr || '')).trim();
    if (copyOutputBtn) copyOutputBtn.disabled = !output.value;
    setStatus('Variant deploy finished');
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
  const agents = Object.keys(byAgent).sort();
  const templateNames = (data.templatesSource || []).map((t) => t.name);

  renderPills(
    globalFilters,
    [{ value: 'all', label: 'All' }, ...agents.map((agent) => ({ value: agent, label: titleCase(agent) }))],
    globalAgentFilter,
    (value) => {
      globalAgentFilter = value;
      renderGlobalColumn(data);
      setActiveButtons();
    }
  );

  if (!agents.length) {
    globalColumn.appendChild(createEmptyMessage('No global files found.'));
    return;
  }

  const grouped = {};
  const categoryOrder = ['Global Instructions', ...templateNames, 'Config'];

  agents.forEach((agent) => {
    if (globalAgentFilter !== 'all' && globalAgentFilter !== agent) return;
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
      agentCard.open = globalAgentFilter !== 'all';

      const agentSummary = document.createElement('summary');
      agentSummary.className = 'templateSummary';
      agentSummary.textContent = titleCase(agent);
      agentCard.appendChild(agentSummary);

      const ul = document.createElement('ul');
      ul.className = 'globalInstructionList';
      (agentMap[agent] || []).forEach((path) => {
        addFileButton(ul, { location: 'global', path });
      });
      agentCard.appendChild(ul);

      catCard.appendChild(agentCard);
    });

    globalColumn.appendChild(catCard);
  });
}

function renderRenderedColumn(data) {
  renderedColumn.innerHTML = '';

  const renderedAgentOptions = [
    { value: 'all', label: 'All' },
    { value: 'claude', label: 'Claude' },
    { value: 'codex', label: 'Codex' },
    { value: 'copilot', label: 'Copilot' },
    { value: 'orkestra', label: 'Orkestra' },
  ];
  renderPills(renderedFilters, renderedAgentOptions, renderedAgentFilter, (value) => {
    renderedAgentFilter = value;
    renderRenderedColumn(data);
    setActiveButtons();
  });

  if (!data.renderedAvailable) {
    renderedColumn.appendChild(createEmptyMessage('Project is not initialized yet.'));
    return;
  }

  const globalCard = document.createElement('details');
  globalCard.className = 'templateCard';
  globalCard.open = true;

  const globalSummary = document.createElement('summary');
  globalSummary.className = 'templateSummary';
  globalSummary.textContent = 'Global (Rendered)';
  globalCard.appendChild(globalSummary);

  const globalList = document.createElement('ul');
  (data.globalRendered || []).forEach((name) => {
    const path = renderedPathForGlobalInstruction(name);
    if (matchesRenderedAgent(path, renderedAgentFilter)) {
      addFileButton(globalList, { location: 'rendered', path });
    }
  });
  if (!globalList.children.length) {
    globalCard.appendChild(createEmptyMessage('No rendered global files.'));
  } else {
    globalCard.appendChild(globalList);
  }
  renderedColumn.appendChild(globalCard);

  const renderedTemplate = data.templateRendered;
  if (!renderedTemplate) {
    renderedColumn.appendChild(createEmptyMessage('No rendered template data.'));
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
      if (matchesRenderedAgent(path, renderedAgentFilter)) {
        addFileButton(ul, { location: 'rendered', path });
      }
    });
  });

  if (!ul.children.length) {
    templateCard.appendChild(createEmptyMessage('No rendered template files.'));
  } else {
    templateCard.appendChild(ul);
  }

  renderedColumn.appendChild(templateCard);
}

function setButtonStates() {
  const compareMode = !!(compareToggle && compareToggle.checked);
  const hasCompareTarget = compareMode && !!secondary;
  const leftWritable = !!primary && !primary.readOnly;
  const rightWritable = !!secondary && !secondary.readOnly;

  if (savePrimaryBtn) savePrimaryBtn.disabled = !leftWritable;
  if (saveSecondaryBtn) saveSecondaryBtn.disabled = !hasCompareTarget || !rightWritable;

  const bothSelected = !!primary && !!secondary;
  if (applyLeftToRightBtn) applyLeftToRightBtn.disabled = !hasCompareTarget || !(bothSelected && rightWritable);
  if (applyRightToLeftBtn) applyRightToLeftBtn.disabled = !hasCompareTarget || !(bothSelected && leftWritable);

  if (copyDiffBtn) copyDiffBtn.disabled = !hasCompareTarget || !diffOutput.value;
  if (copyOutputBtn) copyOutputBtn.disabled = !output.value;
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

function renderSideBySideDiff(blocks) {
  diffVisual.innerHTML = '';
  currentDiffBlocks = blocks || [];

  if (!currentDiffBlocks.length) {
    diffVisual.appendChild(mk('div', 'diffEmpty', 'No differences.'));
    return;
  }

  currentDiffBlocks.forEach((block) => {
    const hunk = mk('section', 'diffHunk');

    const header = mk('div', 'diffHunkHeader');
    const meta = mk(
      'span',
      'diffHunkMeta',
      `Hunk ${block.id} | L${block.leftStart + 1}-${block.leftEnd} <> R${block.rightStart + 1}-${block.rightEnd}`
    );

    const actions = mk('div', 'hunkActions');
    const btnL2R = mk('button', '', '→');
    btnL2R.title = 'Apply this hunk left to right';
    btnL2R.onclick = () => applyHunk(block, 'leftToRight');

    const btnR2L = mk('button', '', '<-');
    btnR2L.title = 'Apply this hunk right to left';
    btnR2L.onclick = () => applyHunk(block, 'rightToLeft');

    actions.appendChild(btnL2R);
    actions.appendChild(btnR2L);

    header.appendChild(meta);
    header.appendChild(actions);
    hunk.appendChild(header);

    const grid = mk('div', 'diffGrid');
    const leftLines = block.leftLines || [];
    const rightLines = block.rightLines || [];
    const rows = Math.max(leftLines.length, rightLines.length);

    for (let i = 0; i < rows; i++) {
      const leftLine = leftLines[i];
      const rightLine = rightLines[i];

      const leftCls = block.tag === 'insert' ? 'diffCell empty' : 'diffCell removed';
      const rightCls = block.tag === 'delete' ? 'diffCell empty' : 'diffCell added';

      const leftCell = mk('div', leftLine === undefined ? 'diffCell empty' : leftCls);
      leftCell.appendChild(mk('div', 'diffNum', leftLine === undefined ? '' : String(block.leftStart + i + 1)));
      leftCell.appendChild(mk('div', 'diffCode', leftLine === undefined ? '' : leftLine));

      const rightCell = mk('div', rightLine === undefined ? 'diffCell empty' : rightCls);
      rightCell.appendChild(mk('div', 'diffNum', rightLine === undefined ? '' : String(block.rightStart + i + 1)));
      rightCell.appendChild(mk('div', 'diffCode', rightLine === undefined ? '' : rightLine));

      grid.appendChild(leftCell);
      grid.appendChild(rightCell);
    }

    hunk.appendChild(grid);
    diffVisual.appendChild(hunk);
  });
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

  const hasPrimary = !!primary;
  if (compareToggleWrap) compareToggleWrap.hidden = !hasPrimary;

  const showRight = !!(compareToggle && compareToggle.checked && secondary);
  rightCol.hidden = !showRight;
  rightCol.style.display = showRight ? 'flex' : 'none';
  previewGrid.classList.toggle('compareMode', showRight);

  const showCompareUi = !!(compareToggle && compareToggle.checked && secondary);
  diffHeader.hidden = !showCompareUi;
  diffOutput.hidden = !showCompareUi;
  diffHeader.style.display = showCompareUi ? 'flex' : 'none';
  diffOutput.style.display = 'none';
  diffVisual.hidden = !showCompareUi;
  diffVisual.style.display = showCompareUi ? 'flex' : 'none';
  if (saveSecondaryBtn) {
    saveSecondaryBtn.hidden = !showCompareUi;
    saveSecondaryBtn.style.display = showCompareUi ? 'inline-block' : 'none';
  }
  if (applyLeftToRightBtn) {
    applyLeftToRightBtn.hidden = !showCompareUi;
    applyLeftToRightBtn.style.display = showCompareUi ? 'inline-block' : 'none';
  }
  if (applyRightToLeftBtn) {
    applyRightToLeftBtn.hidden = !showCompareUi;
    applyRightToLeftBtn.style.display = showCompareUi ? 'inline-block' : 'none';
  }
  if (copyDiffBtn) {
    copyDiffBtn.hidden = !showCompareUi;
    copyDiffBtn.style.display = showCompareUi ? 'inline-block' : 'none';
  }
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
  if (!(compareToggle && compareToggle.checked) || !primary || !secondary) {
    diffOutput.value = '';
    renderSideBySideDiff([]);
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

    diffOutput.value = diff.diff || 'No differences.';
    renderSideBySideDiff(diff.blocks || []);
    setButtonStates();
  } catch (err) {
    diffOutput.value = 'Diff failed: ' + err.message;
    renderSideBySideDiff([]);
    setButtonStates();
  }
}

function clearSecondary() {
  secondary = null;
  rightEditor.value = '';
  rightEditor.readOnly = true;
  renderSideBySideDiff([]);
}

async function handleFilePick(fileRef) {
  try {
    setStatus('Loading ' + fileRef.path + ' ...');
    const resolved = await readFileRef(fileRef);

    if (compareToggle && compareToggle.checked && compareArmed && primary && resolved.location !== primary.location) {
      secondary = resolved;
      rightEditor.value = secondary.content;
      rightEditor.readOnly = secondary.readOnly;
      compareArmed = false;
      setStatus('Loaded compare target: ' + secondary.path);
    } else {
      primary = resolved;
      leftEditor.value = primary.content;
      leftEditor.readOnly = primary.readOnly;
      if (!(compareToggle && compareToggle.checked)) {
        clearSecondary();
        diffOutput.value = '';
      }
      setStatus('Loaded ' + primary.path);
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
  if (projectPathEl) projectPathEl.textContent = 'Project: ' + ctx.projectDir;
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
  diffOutput.value = '';
  output.value = '';
  if (compareToggle) compareToggle.checked = false;
  compareArmed = false;

  renderSelectionMeta();
  setButtonStates();

  try {
    setStatus('Fetching files ...');
    const data = await apiGet('/api/templates');
    latestIndex = data;

    renderSourceColumn(data);
    renderGlobalColumn(data);
    renderRenderedColumn(data);
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

    output.value = ((result.stdout || '') + '\n' + (result.stderr || '')).trim() || 'Applied successfully.';
    if (copyOutputBtn) copyOutputBtn.disabled = !output.value;

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
    setStatus('Apply finished');
  } catch (err) {
    setStatus('Apply failed');
    alert('Apply failed: ' + err.message);
  }
}

if (savePrimaryBtn) savePrimaryBtn.onclick = () => saveSide('left');
if (saveSecondaryBtn) saveSecondaryBtn.onclick = () => saveSide('right');

if (applyLeftToRightBtn) applyLeftToRightBtn.onclick = () => applyCopy('leftToRight');
if (applyRightToLeftBtn) applyRightToLeftBtn.onclick = () => applyCopy('rightToLeft');

if (copyOutputBtn) {
  copyOutputBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(output.value || '');
      setStatus('Copied output');
    } catch (_err) {
      alert('Clipboard copy failed.');
    }
  };
}

if (copyDiffBtn) {
  copyDiffBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(diffOutput.value || '');
      setStatus('Copied diff');
    } catch (_err) {
      alert('Clipboard copy failed.');
    }
  };
}

if (compareToggle) {
  compareToggle.addEventListener('change', () => {
    if (!compareToggle.checked) {
      compareArmed = false;
      clearSecondary();
      diffOutput.value = '';
      renderSelectionMeta();
      setActiveButtons();
      setButtonStates();
      return;
    }

    if (!primary) {
      compareToggle.checked = false;
      alert('Select a primary file first, then enable compare mode.');
      return;
    }

    compareArmed = true;
    setStatus('Compare mode enabled. Pick a second file from another column.');
    renderSelectionMeta();
    setButtonStates();
  });
}

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
