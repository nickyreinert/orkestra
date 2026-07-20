#!/usr/bin/env bash
# orkestra hooks <subcommand>
# Manage quality hooks for the current project.
set -euo pipefail

source "$ORK_HOME/lib/ui/colors.sh"
source "$ORK_HOME/lib/ui/menu.sh"
source "$ORK_HOME/lib/core/paths.sh"
source "$ORK_HOME/lib/core/manifest.sh"
source "$ORK_HOME/lib/core/hooks.sh"

sub="${1:-}"
shift || true

_require_git_root() {
    git rev-parse --show-toplevel >/dev/null 2>&1 \
        || ork_die "Not inside a git repository"
}

_project_root() {
    git rev-parse --show-toplevel 2>/dev/null || pwd
}

usage() {
    cat <<EOF
${ORK_BOLD}orkestra hooks${ORK_NC} — manage quality hooks for this project

${ORK_BOLD}SUBCOMMANDS${ORK_NC}
  list              show available hooks (distribution + user)
  status            show installed hooks for this project
  install           install hook dispatchers into .git/hooks/
  add <id>          add a hook to this project and re-install
  remove <id>       remove a hook from this project
  run <event>       run all hooks for an event manually (for testing)

${ORK_BOLD}HOOK IDS${ORK_NC}
  common/check-secrets        block commits with hardcoded secrets
  common/validate-commit-msg  enforce conventional commit format
  common/block-main-push      prevent direct pushes to main/master

${ORK_BOLD}EXAMPLES${ORK_NC}
  orkestra hooks list
  orkestra hooks install
  orkestra hooks add common/check-secrets
  orkestra hooks run pre-commit
EOF
}

# ── list ──────────────────────────────────────────────────────────────────────
cmd_list() {
    ork_header "Available hooks"
    local found=0
    while IFS='|' read -r id event; do
        printf "  %-42s %s%s%s\n" "$id" "$ORK_DIM" "$event" "$ORK_NC"
        found=1
    done < <(ork_list_hooks)
    [[ $found -eq 0 ]] && ork_warn "No hooks found in $ORK_HOME/content/hooks/"
}

# ── status ────────────────────────────────────────────────────────────────────
cmd_status() {
    _require_git_root
    local project; project="$(_project_root)"
    local mf; mf="$(ork_hooks_manifest_path "$project")"

    ork_header "Hooks status: $(basename "$project")"

    if [[ ! -f "$mf" ]]; then
        ork_warn "No hooks installed. Run: orkestra hooks install"
        return 0
    fi

    printf "\n%sManifest:%s %s\n\n" "$ORK_DIM" "$ORK_NC" "$mf"
    cat "$mf"

    printf "\n%sDispatchers:%s\n" "$ORK_BOLD" "$ORK_NC"
    for ev in pre-commit commit-msg pre-push; do
        local dispatcher="$project/.git/hooks/$ev"
        if [[ -f "$dispatcher" ]] && grep -q 'orkestra:generated' "$dispatcher" 2>/dev/null; then
            ork_ok "$ev"
        else
            ork_dim "  $ev (not installed)"
        fi
    done
}

# ── install ───────────────────────────────────────────────────────────────────
cmd_install() {
    _require_git_root
    local project; project="$(_project_root)"
    local mf; mf="$(ork_hooks_manifest_path "$project")"

    ork_header "Installing hooks"

    # If no manifest yet, run an interactive setup.
    if [[ ! -f "$mf" ]]; then
        ork_info "No hooks manifest found. Running interactive setup..."
        cmd_setup_interactive "$project"
        return
    fi

    ork_hooks_install_runner "$project"
    ork_hooks_install_dispatchers "$project"
    ork_manifest_set_hooks_installed "$project"
    ork_ok "hooks installed"
    _print_installed_summary "$project"
}

cmd_setup_interactive() {
    local project="${1:-$(_project_root)}"

    printf "\nSelect hooks to install:\n\n"

    local -a choices=()
    local -A hook_events=()

    while IFS='|' read -r id event; do
        choices+=("$id  ($event)")
        hook_events["$id"]="$event"
    done < <(ork_list_hooks)

    [[ ${#choices[@]} -eq 0 ]] && ork_die "No hooks available"

    local sel=""
    ork_multiselect "Use space to toggle, Enter to confirm" sel "${choices[@]}"

    local flat_pairs=()
    while IFS= read -r choice; do
        [[ -z "$choice" ]] && continue
        local id; id="${choice%%  *}"
        local ev="${hook_events[$id]:-pre-commit}"
        flat_pairs+=("$ev" "$id")
    done <<< "$sel"

    [[ ${#flat_pairs[@]} -eq 0 ]] && { ork_warn "No hooks selected"; return; }

    ork_hooks_manifest_write "$project" "${flat_pairs[@]}"
    ork_hooks_install_runner "$project"
    ork_hooks_install_dispatchers "$project"
    ork_manifest_set_hooks_installed "$project"
    ork_ok "hooks installed"
    _print_installed_summary "$project"
}

# ── add ───────────────────────────────────────────────────────────────────────
cmd_add() {
    local id="${1:-}"
    [[ -n "$id" ]] || ork_die "Usage: orkestra hooks add <id>"
    _require_git_root
    local project; project="$(_project_root)"

    local script; script="$(ork_hook_script_resolve "$id" 2>/dev/null)" \
        || ork_die "Hook not found: $id"

    # Infer event from script header.
    local event
    event=$(grep -m1 '^# Git event:' "$script" | sed 's/# Git event:[[:space:]]*//' || true)
    [[ -z "$event" ]] && event="pre-commit"

    ork_hooks_manifest_add "$project" "$event" "$id"
    ork_hooks_install_runner "$project"
    ork_hooks_install_dispatchers "$project"
    ork_ok "added: $id ($event)"
}

# ── remove ────────────────────────────────────────────────────────────────────
cmd_remove() {
    local id="${1:-}"
    [[ -n "$id" ]] || ork_die "Usage: orkestra hooks remove <id>"
    _require_git_root
    local project; project="$(_project_root)"

    ork_hooks_manifest_remove "$project" "$id"
    ork_hooks_install_dispatchers "$project"
    ork_ok "removed: $id"
}

# ── run ───────────────────────────────────────────────────────────────────────
cmd_run() {
    local event="${1:-}"
    [[ -n "$event" ]] || ork_die "Usage: orkestra hooks run <event>"
    shift || true
    _require_git_root
    local project; project="$(_project_root)"
    local runner="$project/.orkestra/hooks/runner.sh"
    [[ -f "$runner" ]] || ork_die "Hooks not installed. Run: orkestra hooks install"
    ork_info "running $event hooks..."
    bash "$runner" "$event" "$@"
    ork_ok "done"
}

# ── helpers ───────────────────────────────────────────────────────────────────
_print_installed_summary() {
    local project="$1"
    printf "\n%sActive hooks:%s\n" "$ORK_BOLD" "$ORK_NC"
    for ev in pre-commit commit-msg pre-push; do
        local ids; ids="$(ork_hooks_for_event "$project" "$ev" | tr '\n' ' ')"
        [[ -z "$ids" ]] && continue
        printf "  %-12s %s\n" "$ev" "$ids"
    done
    printf "\n%sTip:%s test with: orkestra hooks run pre-commit\n" "$ORK_DIM" "$ORK_NC"
}

# ── dispatch ──────────────────────────────────────────────────────────────────
case "$sub" in
    list)    cmd_list ;;
    status)  cmd_status ;;
    install) cmd_install ;;
    add)     cmd_add "$@" ;;
    remove)  cmd_remove "$@" ;;
    run)     cmd_run "$@" ;;
    ""|-h|--help) usage ;;
    *)
        ork_error "Unknown hooks subcommand: $sub"
        usage; exit 1 ;;
esac
