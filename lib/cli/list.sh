#!/usr/bin/env bash
# orkestra list templates|agents|entities
set -euo pipefail
source "$ORK_HOME/lib/ui/colors.sh"
source "$ORK_HOME/lib/core/paths.sh"
source "$ORK_HOME/lib/core/entities.sh"

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
    entities|entity)
        ork_header "Entities"
        while IFS= read -r id; do
            [[ -z "$id" ]] && continue
            file="$(ork_entity_source_path "$id")"
            name="$(ork_entity_yaml_value "$file" "name")"
            category="$(ork_entity_yaml_value "$file" "category")"
            printf "  %s%-28s%s %-12s %s\n" "$ORK_CYAN" "$id" "$ORK_NC" "$category" "$name"
        done < <(ork_list_entities)
        ;;
    *)
        ork_error "Usage: orkestra list templates|agents|entities"; exit 1 ;;
esac
