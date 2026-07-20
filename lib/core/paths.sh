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
    if [[ -d "$ORK_HOME/content/templates" ]]; then
        for d in "$ORK_HOME/content/templates"/*/; do
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
    elif [[ -d "$ORK_HOME/content/templates/$name" ]]; then
        printf "%s\n" "$ORK_HOME/content/templates/$name"
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

# ── Hook paths ────────────────────────────────────────────────────────────────

# List all available hook IDs ("category/name") from distribution + user dir.
ork_list_hooks_available() {
    local seen=()
    for base in "$ORK_HOME/content/hooks" "$ORK_USER_DIR/hooks"; do
        [[ -d "$base" ]] || continue
        while IFS= read -r -d '' f; do
            local rel="${f#$base/}"
            local id="${rel%.sh}"
            # shellcheck disable=SC2076
            [[ " ${seen[*]:-} " =~ " ${id} " ]] && continue
            seen+=("$id")
            printf "%s\n" "$id"
        done < <(find "$base" -name "*.sh" -print0 | sort -z)
    done
}

# Resolve a hook ID to an absolute script path (user dir wins over built-in).
ork_hook_script_resolve() {
    local id="$1"
    local user_f="$ORK_USER_DIR/hooks/${id}.sh"
    local dist_f="$ORK_HOME/content/hooks/${id}.sh"
    if   [[ -f "$user_f" ]]; then printf "%s\n" "$user_f"
    elif [[ -f "$dist_f" ]]; then printf "%s\n" "$dist_f"
    else return 1
    fi
}
