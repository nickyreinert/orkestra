#!/usr/bin/env bash
# orkestra update [--check]  — pull distribution + re-render
set -euo pipefail
source "$ORK_HOME/lib/ui/colors.sh"
source "$ORK_HOME/lib/core/paths.sh"

check_only=0
[[ "${1:-}" == "--check" ]] && check_only=1

if [[ -d "$ORK_HOME/.git" ]]; then
    ork_info "checking $ORK_HOME for updates"
    ( cd "$ORK_HOME" && git fetch --quiet )
    behind="$(cd "$ORK_HOME" && git rev-list --count HEAD..@{u} 2>/dev/null || echo 0)"
    if [[ "$behind" -eq 0 ]]; then
        ork_ok "distribution is up to date"
    else
        ork_warn "$behind commit(s) behind upstream"
        if [[ $check_only -eq 1 ]]; then exit 0; fi
        ( cd "$ORK_HOME" && git pull --ff-only )
    fi
else
    ork_warn "$ORK_HOME is not a git checkout; skipping pull"
fi

[[ $check_only -eq 1 ]] && exit 0

if [[ -f ".orkestra/manifest.yaml" ]]; then
    ork_info "re-rendering current project"
    "$ORK_HOME/bin/orkestra" render
fi
