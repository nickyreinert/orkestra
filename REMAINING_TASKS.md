# Remaining Tasks: WebUI Config-Driven Deployment

## Completed Tasks ✅

### Task 1: Config-Schema erstellen ✅
- Created `settings/agents-config.yaml` with complete deployment rules
- Defined agents, item_types, and 12 deployment configurations

### Task 2: Backend Config-Loader ✅
- Implemented `parse_agents_config_yaml()` with PyYAML
- Added `validate_agents_config()` for schema validation
- Created `load_agents_config()` with user override support (~/.config/orkestra/agents-config.yaml)

### Task 3: APIs für Config-Zugriff ✅
- Created `GET /api/agents-config` endpoint (returns full config)
- Created `GET /api/deploy-index` endpoint (returns agents, itemTypes, deployments, project info, projectItems with git status)

### Task 4: Deployment-Engine ✅
- Implemented `expand_source_globs()` for {template} placeholder and glob expansion
- Created deployment strategies:
  - `deploy_bundle_strategy()` - concatenate with section markers
  - `deploy_copy_file_strategy()` - copy individual files
  - `deploy_copy_tree_strategy()` - recursive directory copy
- Implemented `execute_deployment()` orchestrator
- Created `POST /api/deploy` endpoint accepting agent, scope, deploymentIds

### Task 5: Git-Status-Detection ✅
- Implemented `is_git_repository()` check
- Created `is_tracked_by_git(rel_path)` using git ls-files
- Created `is_gitignored(rel_path)` using git check-ignore
- Implemented `get_file_git_status(rel_path)` returning tracked/gitignored/untracked
- Integrated into `collect_project_items_with_status()` for /api/deploy-index

### Task 6: WebUI Header umbauen ✅
- **HTML (index.html):**
  - Changed header from flex to 3-column grid: topbarLeft | topbarCenter | topbarRight
  - Removed separate global/rendered filter sections
  - Added single `<div id="agentFilters" class="agentFilters"></div>` in topbarRight
  - Removed `<div class="status" id="status">` element
  - Column B: kept as "B: Global"
  - Column C: renamed to "C: Project"

- **CSS (styles.css):**
  - `.topbar`: grid with `grid-template-columns: auto 1fr auto;`
  - Added `.topbarSection`, `.topbarLeft/.topbarCenter/.topbarRight`
  - `.agentFilters`: flex layout with ::before pseudo-element "Agent:"
  - `.projectPath`: centered text with overflow ellipsis
  - Removed `.quickFilters` styles (no longer needed)
  - Kept `.pillBtn` for agent filter buttons

- **JavaScript (app.js):**
  - Removed: `const statusEl` DOM reference
  - Added: `const agentFilters` DOM reference
  - Merged: `let globalAgentFilter` + `let renderedAgentFilter` → `let activeAgentFilter`
  - Created: `renderAgentFilters(agents)` - renders pill buttons in header, sets activeAgentFilter
  - Updated: `loadContext()` to show only directory name in center (full path in tooltip)
  - Updated: `setStatus(msg)` to use console.log only
  - Created: `selectedProjectPathsForAgent(agent)` to filter project items
  - Updated: `updateApplyButtonStates()` to use projectCount instead of renderedCount
  - Updated: All column renderers to use `activeAgentFilter` consistently

---

## Remaining Tasks 🚧

### Task 7: Source/Global/Project Columns config-driven rendern � PARTIALLY COMPLETE

**Status:** Backend ready, frontend rendering still uses old template-based approach.

**Completed:**
- ✅ Backend `/api/deploy-index` provides all necessary data (itemTypes, deployments, projectItems)
- ✅ Data structure validated and tested

**Remaining Work:**
Update frontend column renderers to use config data instead of hardcoded templates.

**Source Column (A):**
- Fetch data from `/api/deploy-index` instead of `/api/templates`
- Group items by `itemTypes` (instructions, skills, mcp, workflows, plugins) instead of hardcoded categories
- Show each itemType as expandable section with file count
- Display individual files with checkboxes for selection
- Update `collectSelectedSourcePaths()` to work with new structure

**Global Column (B):**
- Use `deployments` data filtered by `scope: global`
- Group by agent (already filtered by `activeAgentFilter`)
- Show items by itemType instead of hardcoded categories
- Display existing deployed files with checkboxes
- Keep selection state in `globalSelectionState`

**Project Column (C):**
- Use `projectItems` data from `/api/deploy-index`
- Show items grouped by itemType (instructions, skills, mcp, workflows, plugins)
- Display subcategories: `tracked` vs `gitignored` items
- Add visual distinction for gitignored items (e.g., gray icon or different color)
- Keep selection state in `renderedSelectionState`

**Code Changes Needed:**
```javascript
// in loadIndex():
async function loadIndex() {
  const data = await apiGet('/api/deploy-index');
  latestIndex = data;
  
  renderAgentFilters(data.agents || []);
  renderSourceColumn(data);     // use data.itemTypes
  renderGlobalColumn(data);     // use data.deployments filtered by scope=global
  renderProjectColumn(data);    // use data.projectItems
  updateApplyButtonStates();
}

// Update renderSourceColumn to use itemTypes:
function renderSourceColumn(data) {
  sourceColumn.innerHTML = '';
  const itemTypes = data.itemTypes || [];
  
  itemTypes.forEach(itemType => {
    // Create expandable section for each item type
    const section = createItemTypeSection(itemType);
    sourceColumn.appendChild(section);
  });
}

// Update renderGlobalColumn to use deployments:
function renderGlobalColumn(data) {
  globalColumn.innerHTML = '';
  const deployments = (data.deployments || []).filter(d => 
    d.scope === 'global' && 
    (!activeAgentFilter || d.agent === activeAgentFilter)
  );
  
  // Group by itemType and render
  const byItemType = groupBy(deployments, 'item_type');
  Object.entries(byItemType).forEach(([itemType, deploys]) => {
    const section = createDeploymentSection(itemType, deploys, 'global');
    globalColumn.appendChild(section);
  });
}

// Update renderProjectColumn (renamed from renderRenderedColumn):
function renderProjectColumn(data) {
  const projectItems = data.projectItems || {};
  
  Object.entries(projectItems).forEach(([itemType, categories]) => {
    // categories = { tracked: [...], gitignored: [...] }
    const section = createProjectItemSection(itemType, categories);
    projectColumn.appendChild(section);
  });
}
```

**Files to modify:**
- `webui/app.js`: Update all column rendering functions
- `webui/index.html`: Potentially rename `renderedColumn` to `projectColumn` (optional)

---

### Task 8: Apply-Buttons auf /api/deploy umstellen 🟢 MOSTLY COMPLETE

**Status:** Core functionality implemented, needs testing.

**Completed:**
- ✅ Created `getDeploymentsForScope(scope, agent, itemType)` helper function
- ✅ Updated `applyGlobalSelectionToScope()` to use `/api/deploy` endpoint
- ✅ Properly handles deployment results array with success/failure reporting
- ✅ Console logging for debugging
- ✅ User feedback via alerts for failed deployments

**Current Implementation:**
```javascript
async function applyGlobalSelectionToScope(scope) {
  const agent = activeAgentFilter;
  if (!agent) {
    alert('Select one agent first.');
    return;
  }

  const deployments = getDeploymentsForScope(scope, agent);
  if (!deployments.length) {
    alert('No deployments configured...');
    return;
  }

  const deploymentIds = deployments.map(d => d.id);
  
  const ok = await showConfirmModal({...});
  if (!ok) return;

  const result = await apiPost('/api/deploy', {
    agent: agent,
    scope: scope,
    deploymentIds: deploymentIds,
    template: latestIndex?.project?.template || null
  });

  const results = result.results || [];
  const failed = results.filter(r => !r.success);
  
  if (failed.length) {
    alert('Some deployments failed: ...');
  }
  
  await loadIndex();
}
```

**Remaining Work:**
- 🟡 Update `deploySectionFromTop()` to use `/api/deploy` (currently still uses old `/api/deploy-section`)
  - This function is more complex - it collects source paths and deploys to multiple agents
  - May need refactoring to map source selections to deployment IDs
  - Can be deferred if not critical for initial release

**Testing Needed:**
- [ ] Test applyGlobalSelectionToScope() with Claude agent
- [ ] Verify deployment succeeds and files are created
- [ ] Test failure handling (e.g., invalid template placeholder)
- [ ] Verify console logs show correct data
- [ ] Test with multiple agents
- [ ] Test with both global and project scopes

**Backend validation:**
- ✅ `/api/deploy` endpoint exists and returns proper results array
- ✅ Error handling returns `{success: false, error: "..."}` format

---

## Testing Checklist 🧪

After completing remaining tasks:

- [ ] **Task 7 Testing:**
  - [ ] Source column shows all itemTypes from config
  - [ ] Global column shows deployments grouped by itemType
  - [ ] Project column shows tracked vs gitignored items
  - [ ] Gitignored items have visual distinction
  - [ ] Selection checkboxes work correctly

- [ ] **Task 8 Testing:**
  - [ ] Apply buttons call `/api/deploy` endpoint
  - [ ] Deployment IDs correctly mapped from selections
  - [ ] Success/failure results properly displayed
  - [ ] Error handling works for failed deployments
  - [ ] UI refreshes after deployment

- [ ] **Integration Testing:**
  - [ ] Agent filter in header works across all columns
  - [ ] Switching agents updates all three columns
  - [ ] Apply buttons enable/disable based on selections
  - [ ] Git status correctly detected for project items
  - [ ] Config overrides work (~/.config/orkestra/agents-config.yaml)

- [ ] **End-to-End Workflow:**
  - [ ] Select agent filter
  - [ ] Select items in source column
  - [ ] Deploy to global scope
  - [ ] Verify items appear in global column
  - [ ] Select global items
  - [ ] Deploy to project scope
  - [ ] Verify items appear in project column with correct git status

---

## Implementation Notes 📝

**Current State:**
- Backend fully implemented and tested
- Frontend header redesign complete
- Single agent filter working
- Old filter variables fully replaced

**Known Issues:**
- None currently

**Dependencies:**
- PyYAML 6.0.3 installed in venv
- Git must be available for status detection
- Project must be initialized for project-scope operations

**Future Enhancements (Optional):**
- Bulk deployment operations
- Deployment history/rollback
- Config editor in WebUI
- Deployment dry-run preview
- Advanced filtering (by itemType, deployment strategy)
