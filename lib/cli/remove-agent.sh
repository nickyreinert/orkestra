#!/usr/bin/env bash
# orkestra remove-agent <name>
set -euo pipefail
source "$ORK_HOME/lib/ui/colors.sh"
source "$ORK_HOME/lib/core/paths.sh"

agent="${1:-}"
[[ -n "$agent" ]] || ork_die "Usage: orkestra remove-agent <name>"
m=".orkestra/manifest.yaml"
[[ -f "$m" ]] || ork_die "Run from a project root"

if ! grep -E "^  - $agent$" "$m" >/dev/null; then
    ork_warn "$agent not enabled"
    exit 0
fi

awk -v a="$agent" '
    $0 == "  - " a { next }
    { print }
' "$m" > "$m.tmp" && mv "$m.tmp" "$m"

ork_ok "removed agent: $agent (rendered files left in place; delete manually if no longer wanted)"
