#!/usr/bin/env bash
# orkestra render [--agent NAME] [--dry-run]
# Re-renders agent files from current sources, based on .orkestra/manifest.yaml.
set -euo pipefail
source "$ORK_HOME/lib/ui/colors.sh"
source "$ORK_HOME/lib/core/paths.sh"
source "$ORK_HOME/lib/core/manifest.sh"
source "$ORK_HOME/lib/core/entities.sh"

filter_agent=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --agent) filter_agent="$2"; shift 2 ;;
        --dry-run) export ORK_DRY_RUN=1; shift ;;
        *) ork_die "Unknown render flag: $1" ;;
    esac
done

project="$(pwd)"
manifest="$(ork_manifest_path "$project")"
[[ -f "$manifest" ]] || ork_die "No .orkestra/manifest.yaml here. Run 'orkestra init' first."

# Parse template + agents from manifest (line-based; keep schema simple).
template="$(awk -F': *' '/^template:/{print $2; exit}' "$manifest")"
[[ -n "$template" ]] || ork_die "manifest.yaml has no template:"

agents=()
in_agents=0
while IFS= read -r line; do
    if [[ "$line" =~ ^agents: ]]; then in_agents=1; continue; fi
    if [[ $in_agents -eq 1 ]]; then
        if [[ "$line" =~ ^[[:space:]]+-[[:space:]]+(.+)$ ]]; then
            agents+=("${BASH_REMATCH[1]}")
        elif [[ "$line" =~ ^[a-z] ]]; then
            in_agents=0
        fi
    fi
done < "$manifest"

[[ ${#agents[@]} -gt 0 ]] || ork_die "No agents listed in manifest.yaml"

src_global="$ORK_HOME/content/instructions/global"
src_template_dir="$(ork_template_dir "$template")" || ork_die "Template not found: $template"
src_template="$src_template_dir/instructions"

ork_header "Render plan"
printf "  template : %s\n" "$template"
printf "  agents   : %s\n" "${agents[*]}"
printf "  globals  : %s\n" "$src_global"
printf "  template : %s\n" "$src_template"
[[ "${ORK_DRY_RUN:-0}" == "1" ]] && { ork_dim "(dry-run, no files written)"; exit 0; }

ork_info "refreshing entity index and agent hooks"
ork_write_agents_index "project" "$project"
ork_write_agent_hooks "project" "$project" "${agents[@]}"

# Always run the generic adapter so .orkestra/instructions/ stays fresh.
ork_info "rendering generic mirror"
bash "$(ork_adapter_script generic)" "$project" "$src_global" "$src_template"

for agent in "${agents[@]}"; do
    [[ -n "$filter_agent" && "$agent" != "$filter_agent" ]] && continue
    script="$(ork_adapter_script "$agent")"
    [[ -x "$script" || -f "$script" ]] || { ork_warn "no adapter for '$agent', skipping"; continue; }
    ork_info "rendering adapter: $agent"
    bash "$script" "$project" "$src_global" "$src_template"
done

ork_ok "render complete"
