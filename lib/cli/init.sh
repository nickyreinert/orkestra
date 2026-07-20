#!/usr/bin/env bash
# orkestra init [--template T] [--agents a,b,c] [--here|--dir NAME] [--hooks] [-y]
# Scaffolds .orkestra/ + agent files for a project.
set -euo pipefail
source "$ORK_HOME/lib/ui/colors.sh"
source "$ORK_HOME/lib/ui/menu.sh"
source "$ORK_HOME/lib/core/paths.sh"
source "$ORK_HOME/lib/core/manifest.sh"
source "$ORK_HOME/lib/core/hooks.sh"
source "$ORK_HOME/lib/core/entities.sh"

template=""
agents_csv=""
target_mode=""
target_name=""
install_hooks=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --template) template="$2"; shift 2 ;;
        --agents)   agents_csv="$2"; shift 2 ;;
        --here)     target_mode="here"; shift ;;
        --dir)      target_mode="dir"; target_name="$2"; shift 2 ;;
        --hooks)    install_hooks="yes"; shift ;;
        -y|--yes)   export ORK_YES=1; shift ;;
        --dry-run)  export ORK_DRY_RUN=1; shift ;;
        -h|--help)
            cat <<EOF
orkestra init [--template T] [--agents a,b,c] [--here|--dir NAME] [--hooks] [-y]

Scaffolds an Orkestra-managed project:
  - .orkestra/ (manifest, flow, state, config)
  - rendered agent files (e.g. .github/copilot-instructions.md)
  - optional: quality hooks (pre-commit, commit-msg, pre-push)

Without flags, runs an interactive wizard.
EOF
            exit 0 ;;
        *) ork_die "Unknown init flag: $1" ;;
    esac
done

ork_header "Orkestra init"

# 1. Target directory
if [[ -z "$target_mode" ]]; then
    choice=""
    ork_menu "Where should the project go?" choice "Current directory" "Create new directory"
    if [[ "$choice" == "Current directory" ]]; then target_mode="here"
    else target_mode="dir"; ork_prompt "New directory name" target_name; fi
fi
case "$target_mode" in
    here) target_dir="$(pwd)" ;;
    dir)
        [[ -n "$target_name" ]] || ork_die "Need a directory name"
        target_dir="$(pwd)/$target_name"
        [[ -e "$target_dir" ]] && ork_die "Already exists: $target_dir"
        mkdir -p "$target_dir"
        ;;
esac

# 2. Template
if [[ -z "$template" ]]; then
    mapfile -t tmpls < <(ork_list_templates)
    [[ ${#tmpls[@]} -gt 0 ]] || ork_die "No templates installed"
    ork_menu "Pick a template" template "${tmpls[@]}"
fi
ork_template_dir "$template" >/dev/null || ork_die "Template not found: $template"

# 3. Agents
agents=()
if [[ -n "$agents_csv" ]]; then
    IFS=',' read -ra agents <<< "$agents_csv"
else
    mapfile -t avail < <(ork_list_agents | grep -v '^generic$' || true)
    sel=""
    ork_multiselect "Pick AI coding agents to support" sel "${avail[@]}"
    while IFS= read -r a; do [[ -n "$a" ]] && agents+=("$a"); done <<< "$sel"
    [[ ${#agents[@]} -gt 0 ]] || ork_die "Select at least one agent"
fi

# 3b. Quality hooks (optional)
if [[ -z "$install_hooks" ]]; then
    choice=""
    ork_menu "Install quality hooks?" choice "Yes" "No"
    [[ "$choice" == "Yes" ]] && install_hooks="yes" || install_hooks="no"
fi

# 4. Plan
ork_header "Plan"
printf "  target   : %s\n" "$target_dir"
printf "  template : %s\n" "$template"
printf "  agents   : %s\n" "${agents[*]}"
printf "  hooks    : %s\n" "$install_hooks"
[[ "${ORK_DRY_RUN:-0}" == "1" ]] && { ork_dim "(dry-run)"; exit 0; }
ork_confirm "Proceed?" default-yes || { ork_warn "aborted"; exit 1; }

# 5. Scaffold .orkestra/
mkdir -p "$target_dir/.orkestra/outputs" "$target_dir/.orkestra/tmp" "$target_dir/.orkestra/scripts"
tdir="$(ork_template_dir "$template")"

# Copy flow.yaml (workflow) and config.yaml (sub-agents) verbatim.
[[ -f "$tdir/flow.yaml"   ]] && cp "$tdir/flow.yaml"   "$target_dir/.orkestra/flow.yaml"
[[ -f "$tdir/config.yaml" ]] && cp "$tdir/config.yaml" "$target_dir/.orkestra/config.yaml"

# Copy shared runtime scripts (sub-agent runner, etc.)
if [[ -d "$ORK_HOME/lib/scripts" ]]; then
    cp "$ORK_HOME"/lib/scripts/*.sh "$target_dir/.orkestra/scripts/" 2>/dev/null || true
    chmod +x "$target_dir"/.orkestra/scripts/*.sh 2>/dev/null || true
fi

# state.json
cat > "$target_dir/.orkestra/state.json" <<EOF
{
  "current_step_index": 0,
  "previous_output": {},
  "loaded_instructions": []
}
EOF

# manifest.yaml
agents_lines=""
for a in "${agents[@]}"; do agents_lines+="$a"$'\n'; done
ork_manifest_init "$target_dir" "$template" "$agents_lines"
ork_write_agents_index "project" "$target_dir"
ork_write_agent_hooks "project" "$target_dir" "${agents[@]}"

# 6. Render
ork_info "rendering"
( cd "$target_dir" && ORK_HOME="$ORK_HOME" "$ORK_HOME/bin/orkestra" render )

# 6b. Install hooks if requested
if [[ "$install_hooks" == "yes" ]]; then
    ork_info "installing hooks"
    # Default hooks for all projects: check secrets, validate commit format, block main push
    ork_hooks_manifest_write "$target_dir" \
        "pre-commit" "common/check-secrets" \
        "commit-msg" "common/validate-commit-msg" \
        "pre-push" "common/block-main-push"
    ork_hooks_install_runner "$target_dir"
    ork_hooks_install_dispatchers "$target_dir"
    ork_manifest_set_hooks_installed "$target_dir"
    ork_ok "hooks installed"
fi

# 7. .vscode tasks (optional)
if [[ -f "$ORK_HOME/.vscode/tasks.json" && ! -f "$target_dir/.vscode/tasks.json" ]]; then
    mkdir -p "$target_dir/.vscode"
    cp "$ORK_HOME/.vscode/tasks.json" "$target_dir/.vscode/tasks.json"
fi

# 8. .gitignore
gi="$target_dir/.gitignore"
if [[ ! -f "$gi" ]] || ! grep -q "\.orkestra/tmp" "$gi" 2>/dev/null; then
    printf ".orkestra/tmp/\n" >> "$gi"
fi

ork_ok "initialized: $target_dir"
ork_dim "next: open in VS Code, then ask Copilot to start the workflow"
