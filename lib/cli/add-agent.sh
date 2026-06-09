#!/usr/bin/env bash
# orkestra add-agent <name>
set -euo pipefail
source "$ORK_HOME/lib/ui/colors.sh"
source "$ORK_HOME/lib/core/paths.sh"

agent="${1:-}"
[[ -n "$agent" ]] || ork_die "Usage: orkestra add-agent <name>"
[[ -f "$(ork_adapter_script "$agent")" ]] || ork_die "No such adapter: $agent"

m=".orkestra/manifest.yaml"
[[ -f "$m" ]] || ork_die "Run from a project root (no .orkestra/manifest.yaml)"

if grep -E "^  - $agent$" "$m" >/dev/null; then
    ork_warn "$agent already enabled"
    exit 0
fi

# Insert under 'agents:' block.
awk -v a="$agent" '
    /^agents:/ { print; print "  - " a; next }
    { print }
' "$m" > "$m.tmp" && mv "$m.tmp" "$m"

ork_ok "added agent: $agent"
ork_info "re-rendering"
"$ORK_HOME/bin/orkestra" render
