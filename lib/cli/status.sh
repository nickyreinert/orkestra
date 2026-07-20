#!/usr/bin/env bash
# orkestra status [--scope project|global]
set -euo pipefail
source "$ORK_HOME/lib/ui/colors.sh"
source "$ORK_HOME/lib/core/paths.sh"
source "$ORK_HOME/lib/core/entities.sh"

scope="project"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --scope) scope="$2"; shift 2 ;;
        -h|--help)
            printf "orkestra status [--scope project|global]\n"
            exit 0 ;;
        *) ork_die "Unknown status flag: $1" ;;
    esac
done

[[ "$scope" == "project" || "$scope" == "global" ]] || ork_die "Invalid scope: $scope"

project="$(pwd)"
scope_dir="$(ork_scope_dir "$scope" "$project")"
index="$(ork_agents_index_path "$scope" "$project")"
entities_dir="$(ork_entities_install_dir "$scope" "$project")"

ork_header "Orkestra status"
printf "  scope    : %s\n" "$scope"
printf "  path     : %s\n" "$scope_dir"
printf "  AGENTS.md: %s\n" "$index"

printf "\nInstalled entities:\n"
if [[ -d "$entities_dir" ]] && find "$entities_dir" -type f -name "*.md" | grep -q .; then
    while IFS= read -r f; do
        rel="${f#$entities_dir/}"
        id="${rel%.md}"
        printf "  %s%s%s\n" "$ORK_CYAN" "${id//\//.}" "$ORK_NC"
    done < <(find "$entities_dir" -type f -name "*.md" | sort)
else
    printf "  none\n"
fi
