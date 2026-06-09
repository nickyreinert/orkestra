# shellcheck shell=bash
# Color and status helpers. Sourced by lib/cli/* and bin/orkestra.
# Honors NO_COLOR and non-TTY stdout.

if [[ -n "${NO_COLOR:-}" || ! -t 1 ]]; then
    ORK_RED=""; ORK_GREEN=""; ORK_BLUE=""; ORK_CYAN=""; ORK_YELLOW=""
    ORK_BOLD=""; ORK_DIM=""; ORK_NC=""
else
    ORK_RED=$'\033[0;31m'
    ORK_GREEN=$'\033[0;32m'
    ORK_BLUE=$'\033[0;34m'
    ORK_CYAN=$'\033[0;36m'
    ORK_YELLOW=$'\033[1;33m'
    ORK_BOLD=$'\033[1m'
    ORK_DIM=$'\033[2m'
    ORK_NC=$'\033[0m'
fi

ORK_QUIET="${ORK_QUIET:-0}"

ork_info()  { [[ "$ORK_QUIET" == "1" ]] || printf "%s→%s %s\n" "$ORK_BLUE"   "$ORK_NC" "$*"; }
ork_ok()    { [[ "$ORK_QUIET" == "1" ]] || printf "%s✔%s %s\n" "$ORK_GREEN"  "$ORK_NC" "$*"; }
ork_warn()  {                              printf "%s!%s %s\n" "$ORK_YELLOW" "$ORK_NC" "$*" >&2; }
ork_error() {                              printf "%s✖%s %s\n" "$ORK_RED"    "$ORK_NC" "$*" >&2; }
ork_dim()   { [[ "$ORK_QUIET" == "1" ]] || printf "%s%s%s\n"   "$ORK_DIM"    "$*"      "$ORK_NC"; }

ork_header() {
    [[ "$ORK_QUIET" == "1" ]] && return 0
    printf "\n%s%s%s%s\n" "$ORK_BOLD" "$ORK_BLUE" "$*" "$ORK_NC"
}

ork_die() {
    ork_error "$*"
    exit "${2:-1}"
}
