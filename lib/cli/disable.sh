#!/usr/bin/env bash
# orkestra disable <plugin> [--scope project|global]
set -euo pipefail
source "$ORK_HOME/lib/ui/colors.sh"
source "$ORK_HOME/lib/core/paths.sh"
source "$ORK_HOME/lib/core/entities.sh"

scope="project"
entity=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --scope) scope="$2"; shift 2 ;;
        -h|--help)
            cat <<EOF
orkestra disable <plugin> [--scope project|global]

Removes a plugin from the selected scope and refreshes AGENTS.md.
EOF
            exit 0 ;;
        -*)
            ork_die "Unknown disable flag: $1" ;;
        *)
            entity="$1"; shift ;;
    esac
done

[[ -n "$entity" ]] || ork_die "Usage: orkestra disable <plugin> [--scope project|global]"
[[ "$scope" == "project" || "$scope" == "global" ]] || ork_die "Invalid scope: $scope"

ork_entity_disable "$scope" "$(pwd)" "$entity"
ork_ok "disabled plugin $entity in $scope scope"
