#!/usr/bin/env bash
# orkestra enable <entity> [--scope project|global] [--agents a,b,c]
set -euo pipefail
source "$ORK_HOME/lib/ui/colors.sh"
source "$ORK_HOME/lib/core/paths.sh"
source "$ORK_HOME/lib/core/entities.sh"

scope="project"
agents_csv=""
entity=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --scope) scope="$2"; shift 2 ;;
        --agents) agents_csv="$2"; shift 2 ;;
        -h|--help)
            cat <<EOF
orkestra enable <entity> [--scope project|global] [--agents a,b,c]

Installs an entity into the selected scope and refreshes thin agent hook files.
EOF
            exit 0 ;;
        -*)
            ork_die "Unknown enable flag: $1" ;;
        *)
            entity="$1"; shift ;;
    esac
done

[[ -n "$entity" ]] || ork_die "Usage: orkestra enable <entity> [--scope project|global] [--agents a,b,c]"
[[ "$scope" == "project" || "$scope" == "global" ]] || ork_die "Invalid scope: $scope"

project="$(pwd)"
ork_entity_enable "$scope" "$project" "$entity"

if [[ -n "$agents_csv" ]]; then
    IFS=',' read -ra agents <<< "$agents_csv"
elif [[ -f "$project/.orkestra/manifest.yaml" ]]; then
    mapfile -t agents < <(awk '
        /^agents:/ { in_agents=1; next }
        in_agents && /^[[:space:]]+-[[:space:]]+/ { sub(/^[[:space:]]+-[[:space:]]+/, ""); print; next }
        in_agents && /^[^[:space:]]/ { in_agents=0 }
    ' "$project/.orkestra/manifest.yaml")
else
    agents=(codex)
fi

ork_write_agent_hooks "$scope" "$project" "${agents[@]}"
ork_ok "enabled $entity in $scope scope"
