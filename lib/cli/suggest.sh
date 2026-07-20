#!/usr/bin/env bash
# orkestra suggest <url|path> [--apply] [--source ID]
# Fetch a remote markdown snippet, diff against an existing source, and
# optionally apply it. Read-only by default.
set -euo pipefail
source "$ORK_HOME/lib/ui/colors.sh"
source "$ORK_HOME/lib/ui/menu.sh"
source "$ORK_HOME/lib/core/paths.sh"

target=""
apply=0
source_id=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --apply)  apply=1; shift ;;
        --source) source_id="$2"; shift 2 ;;
        -*) ork_die "Unknown flag: $1" ;;
        *)  target="$1"; shift ;;
    esac
done
[[ -n "$target" ]] || ork_die "Usage: orkestra suggest <url|path> [--apply]"

tmp="$(mktemp -t orkestra-suggest.XXXXXX)"
trap 'rm -f "$tmp"' EXIT

if [[ "$target" =~ ^https?:// ]]; then
    ork_info "fetching $target"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$target" -o "$tmp"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO "$tmp" "$target"
    else
        ork_die "Need curl or wget"
    fi
else
    [[ -f "$target" ]] || ork_die "Not a file: $target"
    cp "$target" "$tmp"
fi

# Pick a source to diff against.
if [[ -z "$source_id" ]]; then
    mapfile -t globals < <(find "$ORK_HOME/content/instructions/global" -maxdepth 1 -type f -name "*.md" -exec basename {} \;)
    pick=""
    ork_menu "Compare against which source?" pick "${globals[@]}"
    source_id="global/$pick"
fi

src_path="$ORK_HOME/content/instructions/$source_id"
[[ -f "$src_path" ]] || ork_die "Source not found: $source_id"

ork_header "Diff: $source_id  vs  $target"
diff -u "$src_path" "$tmp" || true

if [[ $apply -eq 1 ]]; then
    if ork_confirm "Replace $source_id with the fetched content?"; then
        cp "$tmp" "$src_path"
        ork_ok "applied. Run 'orkestra render' in your project to propagate."
    else
        ork_warn "not applied"
    fi
else
    ork_dim "rerun with --apply to write the change"
fi
