#!/usr/bin/env bash
# orkestra doctor — sanity-check installation & current project (if any).
set -euo pipefail
source "$ORK_HOME/lib/ui/colors.sh"
source "$ORK_HOME/lib/core/paths.sh"

ork_header "Orkestra doctor"

fail=0

check() {
    local label="$1" cmd="$2" hint="${3:-}"
    if eval "$cmd" >/dev/null 2>&1; then
        ork_ok "$label"
    else
        ork_error "$label"
        [[ -n "$hint" ]] && ork_dim "  hint: $hint"
        fail=1
    fi
}

check "bash >= 4 or modern macOS bash" "[[ \${BASH_VERSINFO[0]} -ge 3 ]]"
check "git on PATH" "command -v git" "install git"
check "shasum or sha256sum available" "command -v shasum || command -v sha256sum"
check "ORK_HOME exists ($ORK_HOME)" "[[ -d \"$ORK_HOME\" ]]"
check "templates/ present" "[[ -d \"$ORK_HOME/templates\" ]]"
check "instructions/global present" "[[ -d \"$ORK_HOME/instructions/global\" ]]"
check "adapters/ present" "[[ -d \"$ORK_HOME/adapters\" ]]"

# Project-level checks
if [[ -d ".orkestra" ]]; then
    ork_header "Current project"
    check "manifest.yaml present" "[[ -f .orkestra/manifest.yaml ]]" "run: orkestra render"
    check "state.json present"    "[[ -f .orkestra/state.json ]]"    "run: orkestra init"
fi

if [[ $fail -ne 0 ]]; then
    ork_warn "doctor found issues (exit 1)"
    exit 1
fi
ork_ok "all good"
