# shellcheck shell=bash
# Distribution & user paths. Sourced first by every subcommand.

# ORK_HOME = the orkestra distribution root (this repo or ~/.orkestra)
if [[ -z "${ORK_HOME:-}" ]]; then
    # bin/orkestra resolves and exports this; fallback for direct sourcing:
    ORK_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi
export ORK_HOME

ORK_USER_DIR="${ORK_USER_DIR:-$HOME/.config/orkestra}"
export ORK_USER_DIR

ORK_VERSION="2.0.0-dev"
export ORK_VERSION

ork_list_templates() {
    # Built-ins first, then user overrides.
    local seen=()
    if [[ -d "$ORK_HOME/templates" ]]; then
        for d in "$ORK_HOME/templates"/*/; do
            [[ -d "$d" ]] || continue
            local n; n="$(basename "$d")"
            seen+=("$n")
            printf "%s\n" "$n"
        done
    fi
    if [[ -d "$ORK_USER_DIR/templates" ]]; then
        for d in "$ORK_USER_DIR/templates"/*/; do
            [[ -d "$d" ]] || continue
            local n; n="$(basename "$d")"
            # shellcheck disable=SC2076
            [[ " ${seen[*]} " =~ " ${n} " ]] && continue
            printf "%s\n" "$n"
        done
    fi
}

# Resolve a template name to an absolute directory (user dir wins).
ork_template_dir() {
    local name="$1"
    if [[ -d "$ORK_USER_DIR/templates/$name" ]]; then
        printf "%s\n" "$ORK_USER_DIR/templates/$name"
    elif [[ -d "$ORK_HOME/templates/$name" ]]; then
        printf "%s\n" "$ORK_HOME/templates/$name"
    else
        return 1
    fi
}

ork_list_agents() {
    local d
    for d in "$ORK_HOME/adapters"/*/; do
        [[ -d "$d" ]] || continue
        printf "%s\n" "$(basename "$d")"
    done
}

ork_adapter_script() {
    printf "%s\n" "$ORK_HOME/adapters/$1/adapter.sh"
}
