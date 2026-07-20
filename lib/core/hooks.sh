# shellcheck shell=bash
# Core hook helpers: install, manifest I/O, dispatcher generation, runner.
# Sourced by lib/cli/hooks.sh and lib/cli/init.sh.

# ── Path helpers ──────────────────────────────────────────────────────────────

# Absolute dir for a hook ID (e.g. "common/check-secrets" → .../content/hooks/common)
ork_hook_script_path() {
    local id="$1"  # e.g. "common/check-secrets"
    local script="$ORK_HOME/content/hooks/${id}.sh"
    if [[ -f "$script" ]]; then printf "%s\n" "$script"; return 0; fi
    # User override wins
    local user_script="$ORK_USER_DIR/hooks/${id}.sh"
    if [[ -f "$user_script" ]]; then printf "%s\n" "$user_script"; return 0; fi
    return 1
}

ork_list_hooks() {
    # Prints "id|event" lines for all available hooks.
    local base; base="$ORK_HOME/content/hooks"
    [[ -d "$base" ]] || return 0
    find "$base" -name "*.sh" | sort | while IFS= read -r f; do
        local rel="${f#$base/}"           # e.g. "common/check-secrets.sh"
        local id="${rel%.sh}"             # e.g. "common/check-secrets"
        # Infer event from script header comment "# Git event: <event>"
        local event
        event=$(grep -m1 '^# Git event:' "$f" | sed 's/# Git event:[[:space:]]*//' || true)
        printf "%s|%s\n" "$id" "${event:-unknown}"
    done
}

# ── Manifest I/O ──────────────────────────────────────────────────────────────

ork_hooks_manifest_path() {
    printf "%s/.orkestra/hooks/manifest.yaml\n" "${1:-.}"
}

# Read active hook IDs for a given event from manifest.yaml
# Prints one ID per line.
ork_hooks_for_event() {
    local project="${1:-.}" event="$2"
    local mf; mf="$(ork_hooks_manifest_path "$project")"
    [[ -f "$mf" ]] || return 0

    local in_event=0 in_list=0
    while IFS= read -r line; do
        # Detect "pre-commit:", "commit-msg:", "pre-push:" section headers
        if [[ "$line" =~ ^([a-z-]+):[[:space:]]*$ ]]; then
            if [[ "${BASH_REMATCH[1]}" == "$event" ]]; then
                in_event=1
            else
                in_event=0
            fi
            in_list=0
            continue
        fi
        [[ $in_event -eq 0 ]] && continue

        # "  - id: common/check-secrets"
        if [[ "$line" =~ ^[[:space:]]+-[[:space:]]+id:[[:space:]]+(.+)$ ]]; then
            local cur_id="${BASH_REMATCH[1]}"
            in_list=1
            # Peek ahead for "enabled: false" — handled below by tracking state
            printf "%s\n" "$cur_id"
        fi
    done < "$mf"
    # NOTE: "enabled: false" filtering is done in ork_run_hooks below to keep
    # the reader simple; a future version can do a two-pass read here.
}

# Write the hooks manifest for a project.
# Args: project_dir, associative-array-like flat list:
#   event1 id1 event2 id2 ...
# Each (event, id) pair becomes an entry.
ork_hooks_manifest_write() {
    local project="$1"; shift
    local mf; mf="$(ork_hooks_manifest_path "$project")"
    mkdir -p "$(dirname "$mf")"

    # Build a temporary file with all event:id pairs, then partition into YAML.
    local tmpfile; tmpfile="$(mktemp)"
    trap "rm -f '$tmpfile'" RETURN

    # Write all event:id pairs to temp file
    while [[ $# -ge 2 ]]; do
        local ev="$1" hid="$2"; shift 2
        echo "$ev:$hid" >> "$tmpfile"
    done

    {
        printf "# orkestra hooks manifest\n"
        for ev in pre-commit commit-msg pre-push; do
            local ids
            ids="$(grep "^${ev}:" "$tmpfile" 2>/dev/null | cut -d: -f2- | sort -u | tr '\n' ' ')"
            [[ -z "$ids" ]] && continue
            printf "  %s:\n" "$ev"
            for hid in $ids; do
                printf "    - id: %s\n      enabled: true\n" "$hid"
            done
        done
        printf "hooks_installed: true\n"
    } > "$mf"
}

# Add a single hook entry to an existing manifest (or create it).
ork_hooks_manifest_add() {
    local project="$1" event="$2" hid="$3"
    local mf; mf="$(ork_hooks_manifest_path "$project")"
    mkdir -p "$(dirname "$mf")"

    # Already present?
    if [[ -f "$mf" ]] && grep -q "id: $hid" "$mf" 2>/dev/null; then
        return 0
    fi

    local script; script="$(ork_hook_script_path "$hid" 2>/dev/null || true)"
    local sha=""; [[ -n "$script" ]] && sha="$(ork_sha256 "$script")"

    if [[ ! -f "$mf" ]]; then
        printf "# orkestra hooks manifest\n" > "$mf"
    fi

    # Append under the event section if it exists, else add section.
    if grep -q "^${event}:" "$mf" 2>/dev/null; then
        # Insert after the section header using a temp file.
        local tmp; tmp="$(mktemp)"
        awk -v ev="$event" -v hid="$hid" -v sha="$sha" '
            /^[a-z-]+:/ && $0 ~ "^"ev":" { print; inserted=0; next }
            inserted == 0 { print "  - id: "hid; print "    sha256: "sha; print "    enabled: true"; inserted=1 }
            { print }
        ' "$mf" > "$tmp"
        mv "$tmp" "$mf"
    else
        {
            printf "%s:\n" "$event"
            printf "  - id: %s\n" "$hid"
            printf "    sha256: %s\n" "$sha"
            printf "    enabled: true\n"
        } >> "$mf"
    fi
}

# Remove a hook ID from the manifest.
ork_hooks_manifest_remove() {
    local project="$1" hid="$2"
    local mf; mf="$(ork_hooks_manifest_path "$project")"
    [[ -f "$mf" ]] || return 0
    local tmp; tmp="$(mktemp)"
    # Remove the 3-line block (id + sha256 + enabled) for this hook id.
    awk -v hid="$hid" '
        /^[[:space:]]+-[[:space:]]+id:[[:space:]]+/ {
            if ($NF == hid) { skip=3; next }
        }
        skip > 0 { skip--; next }
        { print }
    ' "$mf" > "$tmp"
    mv "$tmp" "$mf"
}

# ── Dispatcher generation ─────────────────────────────────────────────────────

# Write (or overwrite) the runner helper into the project's .orkestra/hooks/.
ork_hooks_install_runner() {
    local project="$1"
    local dest="$project/.orkestra/hooks/runner.sh"
    mkdir -p "$(dirname "$dest")"
    cat > "$dest" <<'RUNNER'
#!/usr/bin/env bash
# orkestra:generated .orkestra/hooks/runner.sh
# Runs all enabled hooks for a given event by reading manifest.yaml.
# Called by each .git/hooks/<event> dispatcher.
set -euo pipefail

ORK_HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORK_PROJECT_ROOT="$(cd "$ORK_HOOKS_DIR/../.." && pwd)"
MANIFEST="$ORK_HOOKS_DIR/manifest.yaml"

[[ -f "$MANIFEST" ]] || exit 0

run_event() {
    local event="$1"; shift
    local hook_args=("$@")
    local in_event=0 cur_id="" cur_enabled="true"
    local scripts=()

    while IFS= read -r line; do
        if [[ "$line" =~ ^([a-z-]+):[[:space:]]*$ ]]; then
            [[ "$in_event" == "1" && -n "$cur_id" && "$cur_enabled" == "true" ]] \
                && scripts+=("$cur_id")
            in_event=0; cur_id=""; cur_enabled="true"
            [[ "${BASH_REMATCH[1]}" == "$event" ]] && in_event=1
            continue
        fi
        [[ "$in_event" == "0" ]] && continue
        if [[ "$line" =~ ^[[:space:]]+-[[:space:]]+id:[[:space:]]+(.+)$ ]]; then
            [[ -n "$cur_id" && "$cur_enabled" == "true" ]] && scripts+=("$cur_id")
            cur_id="${BASH_REMATCH[1]}"; cur_enabled="true"
        elif [[ "$line" =~ enabled:[[:space:]]*(false|true) ]]; then
            cur_enabled="${BASH_REMATCH[1]}"
        fi
    done < "$MANIFEST"
    [[ -n "$cur_id" && "$cur_enabled" == "true" ]] && scripts+=("$cur_id")

    local failed=0
    for id in "${scripts[@]}"; do
        # Scripts stored next to runner.sh or looked up via ORK_HOME if set.
        local script="$ORK_HOOKS_DIR/${id}.sh"
        if [[ ! -f "$script" && -n "${ORK_HOME:-}" ]]; then
            script="$ORK_HOME/content/hooks/${id}.sh"
        fi
        if [[ ! -f "$script" ]]; then
            printf "  \033[1;33m!\033[0m hook not found: %s\n" "$id" >&2
            continue
        fi
        chmod +x "$script"
        if ! bash "$script" "${hook_args[@]}"; then
            failed=1
        fi
    done
    return $failed
}

run_event "$@"
RUNNER
    chmod +x "$dest"
}

# Write a single .git/hooks/<event> dispatcher file.
_ork_write_dispatcher() {
    local project="$1" event="$2"
    local git_hook="$project/.git/hooks/$event"
    # Backup existing hook that wasn't written by us.
    if [[ -f "$git_hook" ]] && ! grep -q 'orkestra:generated' "$git_hook" 2>/dev/null; then
        cp "$git_hook" "${git_hook}.pre-orkestra"
        ork_warn "backed up existing $event hook to ${git_hook}.pre-orkestra"
    fi

    # Map event to the args the hook receives.
    local args=""
    case "$event" in
        commit-msg) args=' "$1"' ;;     # path to commit message file
        pre-push)   args=' "$@" < /dev/stdin' ;; # remote info on stdin
    esac

    cat > "$git_hook" <<DISPATCHER
#!/usr/bin/env bash
# orkestra:generated .git/hooks/$event
set -euo pipefail
RUNNER="\$(git rev-parse --show-toplevel)/.orkestra/hooks/runner.sh"
[[ -f "\$RUNNER" ]] && bash "\$RUNNER" $event${args} || true
DISPATCHER
    chmod +x "$git_hook"
}

# Install all dispatcher files for events that have hooks in the manifest.
ork_hooks_install_dispatchers() {
    local project="${1:-.}"
    local mf; mf="$(ork_hooks_manifest_path "$project")"
    [[ -f "$mf" ]] || return 0

    # Extract unique event names from the manifest and install dispatchers
    local events
    events="$(grep '^  [a-z-]*:$' "$mf" 2>/dev/null | sed 's/[[:space:]]*://g' | sed 's/^[[:space:]]*//' | sort -u)"

    while IFS= read -r ev; do
        [[ -z "$ev" ]] && continue
        _ork_write_dispatcher "$project" "$ev"
    done <<< "$events"
}

# ── Runner (called from within a project, not from the distribution) ──────────

ork_run_hooks() {
    local project="${1:-.}" event="$2"; shift 2 || true
    local runner="$project/.orkestra/hooks/runner.sh"
    [[ -f "$runner" ]] && bash "$runner" "$event" "$@"
}
