#!/usr/bin/env bash
# orkestra list templates|agents
set -euo pipefail
source "$ORK_HOME/lib/ui/colors.sh"
source "$ORK_HOME/lib/core/paths.sh"

what="${1:-}"
case "$what" in
    templates|template)
        ork_header "Templates"
        while IFS= read -r t; do
            local_dir="$(ork_template_dir "$t")"
            desc=""
            if [[ -f "$local_dir/template.yaml" ]]; then
                desc="$(awk -F': *' '/^description:/{sub(/^[^:]+: */,""); print; exit}' "$local_dir/template.yaml")"
            fi
            printf "  %s%-20s%s %s\n" "$ORK_CYAN" "$t" "$ORK_NC" "$desc"
        done < <(ork_list_templates)
        ;;
    agents|agent)
        ork_header "Agents"
        while IFS= read -r a; do
            printf "  %s%s%s\n" "$ORK_CYAN" "$a" "$ORK_NC"
        done < <(ork_list_agents)
        ;;
    *)
        ork_error "Usage: orkestra list templates|agents"; exit 1 ;;
esac
