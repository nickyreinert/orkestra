const sourceColumn = document.getElementById('sourceColumn');
const globalColumn = document.getElementById('globalColumn');
const renderedColumn = document.getElementById('renderedColumn');

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
const refreshBtn = document.getElementById('refreshBtn');
const renderBtn = document.getElementById('renderBtn');
const deployBtn = document.getElementById('deployBtn');

const initTemplate = document.getElementById('initTemplate');
const initAgents = document.getElementById('initAgents');

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

function setStatus(msg) {
  statusEl.textContent = msg;
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

function selectedDeployTarget() {
  const el = document.querySelector('input[name="deployTarget"]:checked');
  return el ? el.value : 'project';
}

function inferTemplateFromSourcePath(path) {
  const m = path.match(/^templates\/([^/]+)\//);
  return m ? m[1] : null;
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

function renderInitForm(templates, agents) {
  initTemplate.innerHTML = '';
  templates.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.name;
    opt.textContent = t.name;
    initTemplate.appendChild(opt);
  });

  initAgents.innerHTML = '';
  agents.forEach((agent, index) => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = agent;
    checkbox.checked = index === 0;
    label.appendChild(checkbox);
    label.append(' ' + agent);
    initAgents.appendChild(label);
  });
}

function renderSourceColumn(data) {
  sourceColumn.innerHTML = '';

  const globalCard = document.createElement('details');
  globalCard.className = 'templateCard';
  globalCard.open = true;

  const globalSummary = document.createElement('summary');
  globalSummary.className = 'templateSummary';
  globalSummary.textContent = 'Global Instructions';
  globalCard.appendChild(globalSummary);

  const globalList = document.createElement('ul');
  (data.globalSource || []).forEach((name) => {
    addFileButton(globalList, { location: 'source', path: 'instructions/global/' + name });
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
    card.open = false;

    const summary = document.createElement('summary');
    summary.className = 'templateSummary';
    summary.textContent = t.name;
    card.appendChild(summary);

    const top = document.createElement('div');
    top.className = 'templateBodyTop';
    top.appendChild(fileButton({ location: 'source', path: t.templateYaml }));
    card.appendChild(top);

    const order = ['Planning', 'Coding', 'Review', 'Other'];
    const ul = document.createElement('ul');
    order.forEach((cat) => {
      const files = t.instructionsByCategory[cat] || [];
      files.forEach((filename) => {
        addFileButton(ul, { location: 'source', path: sourcePathForTemplateInstruction(t.name, filename) });
      });
    });

    if (!ul.children.length) {
      card.appendChild(createEmptyMessage('No template instruction files.'));
    } else {
      card.appendChild(ul);
    }

    sourceColumn.appendChild(card);
  });
}

function renderGlobalColumn(data) {
  globalColumn.innerHTML = '';
  const hint = createEmptyMessage('Common locations only. Customize via global/orkestra/.config/orkestra/settings.yaml');
  globalColumn.appendChild(hint);

  const byAgent = data.globalByAgent || {};
  const agents = Object.keys(byAgent).sort();
  if (!agents.length) {
    globalColumn.appendChild(createEmptyMessage('No global files found.'));
    return;
  }

  agents.forEach((agent) => {
    const card = document.createElement('details');
    card.className = 'templateCard';
    card.open = agent === 'orkestra';

    const summary = document.createElement('summary');
    summary.className = 'templateSummary';
    summary.textContent = agent;
    card.appendChild(summary);

    const ul = document.createElement('ul');
    (byAgent[agent] || []).forEach((path) => {
      addFileButton(ul, { location: 'global', path });
    });

    if (!ul.children.length) {
      card.appendChild(createEmptyMessage('No files in this group.'));
    } else {
      card.appendChild(ul);
    }

    globalColumn.appendChild(card);
  });
}

function renderRenderedColumn(data) {
  renderedColumn.innerHTML = '';

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
    addFileButton(globalList, { location: 'rendered', path: renderedPathForGlobalInstruction(name) });
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
      addFileButton(ul, { location: 'rendered', path: renderedPathForTemplateInstruction(filename) });
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
  const compareMode = compareToggle.checked;
  const hasCompareTarget = compareMode && !!secondary;
  const leftWritable = !!primary && !primary.readOnly;
  const rightWritable = !!secondary && !secondary.readOnly;

  savePrimaryBtn.disabled = !leftWritable;
  saveSecondaryBtn.disabled = !hasCompareTarget || !rightWritable;

  const bothSelected = !!primary && !!secondary;
  applyLeftToRightBtn.disabled = !hasCompareTarget || !(bothSelected && rightWritable);
  applyRightToLeftBtn.disabled = !hasCompareTarget || !(bothSelected && leftWritable);

  copyDiffBtn.disabled = !hasCompareTarget || !diffOutput.value;
  copyOutputBtn.disabled = !output.value;
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
  leftMeta.textContent = 'Preview: ' + refLabel(primary);
  rightMeta.textContent = 'Compare: ' + refLabel(secondary);

  if (primary) {
    currentPathEl.textContent = refLabel(primary);
  } else {
    currentPathEl.textContent = 'No file selected';
  }

  const hasPrimary = !!primary;
  compareToggleWrap.hidden = !hasPrimary;

  const showRight = compareToggle.checked && !!secondary;
  rightCol.hidden = !showRight;
  rightCol.style.display = showRight ? 'flex' : 'none';
  previewGrid.classList.toggle('compareMode', showRight);

  const showCompareUi = compareToggle.checked && !!secondary;
  diffHeader.hidden = !showCompareUi;
  diffOutput.hidden = !showCompareUi;
  diffHeader.style.display = showCompareUi ? 'flex' : 'none';
  diffOutput.style.display = 'none';
  diffVisual.hidden = !showCompareUi;
  diffVisual.style.display = showCompareUi ? 'flex' : 'none';
  saveSecondaryBtn.hidden = !showCompareUi;
  applyLeftToRightBtn.hidden = !showCompareUi;
  applyRightToLeftBtn.hidden = !showCompareUi;
  copyDiffBtn.hidden = !showCompareUi;
  saveSecondaryBtn.style.display = showCompareUi ? 'inline-block' : 'none';
  applyLeftToRightBtn.style.display = showCompareUi ? 'inline-block' : 'none';
  applyRightToLeftBtn.style.display = showCompareUi ? 'inline-block' : 'none';
  copyDiffBtn.style.display = showCompareUi ? 'inline-block' : 'none';
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
  if (!compareToggle.checked || !primary || !secondary) {
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

    if (resolved.location === 'source') {
      const inferred = inferTemplateFromSourcePath(resolved.path);
      if (inferred && [...initTemplate.options].some((o) => o.value === inferred)) {
        initTemplate.value = inferred;
      }
    }

    if (compareToggle.checked && compareArmed && primary && resolved.location !== primary.location) {
      secondary = resolved;
      rightEditor.value = secondary.content;
      rightEditor.readOnly = secondary.readOnly;
      compareArmed = false;
      setStatus('Loaded compare target: ' + secondary.path);
    } else {
      primary = resolved;
      leftEditor.value = primary.content;
      leftEditor.readOnly = primary.readOnly;
      if (!compareToggle.checked) {
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
  projectPathEl.textContent = 'Project: ' + ctx.projectDir;
  projectStateEl.textContent = 'State: ' + (ctx.initialized ? 'initialized' : 'not initialized');
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
  compareToggle.checked = false;
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
    renderInitForm(data.templatesSource || [], data.agents || []);

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
    copyOutputBtn.disabled = !output.value;

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

savePrimaryBtn.onclick = () => saveSide('left');
saveSecondaryBtn.onclick = () => saveSide('right');

applyLeftToRightBtn.onclick = () => applyCopy('leftToRight');
applyRightToLeftBtn.onclick = () => applyCopy('rightToLeft');

renderBtn.onclick = async () => {
  try {
    setStatus('Re-rendering project ...');
    const result = await apiPost('/api/render', {});
    output.value = ((result.stdout || '') + '\n' + (result.stderr || '')).trim();
    copyOutputBtn.disabled = !output.value;
    await loadIndex();
    setStatus('Re-render finished');
  } catch (err) {
    setStatus('Render failed');
    alert('Re-render failed: ' + err.message);
  }
};

copyOutputBtn.onclick = async () => {
  try {
    await navigator.clipboard.writeText(output.value || '');
    setStatus('Copied output');
  } catch (_err) {
    alert('Clipboard copy failed.');
  }
};

copyDiffBtn.onclick = async () => {
  try {
    await navigator.clipboard.writeText(diffOutput.value || '');
    setStatus('Copied diff');
  } catch (_err) {
    alert('Clipboard copy failed.');
  }
};

deployBtn.onclick = async () => {
  try {
    const selectedAgents = [...initAgents.querySelectorAll('input[type="checkbox"]:checked')]
      .map((el) => el.value);

    if (!selectedAgents.length) {
      alert('Select at least one agent.');
      return;
    }

    const target = selectedDeployTarget();
    setStatus('Deploying template to ' + target + ' ...');

    const result = await apiPost('/api/deploy-template', {
      template: initTemplate.value,
      agents: selectedAgents,
      target,
    });

    await loadContext();
    output.value = ((result.stdout || '') + '\n' + (result.stderr || '')).trim();
    copyOutputBtn.disabled = !output.value;
    setStatus('Deploy finished');
    alert('Deploy complete.');
    await loadIndex();
  } catch (err) {
    setStatus('Deploy failed');
    alert('Deploy failed: ' + err.message);
  }
};

refreshBtn.onclick = loadIndex;

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
