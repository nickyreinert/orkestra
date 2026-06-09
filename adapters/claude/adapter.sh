#!/usr/bin/env bash
# Claude adapter:
#   CLAUDE.md                   <- top-level summary + globals
#   .claude/orkestra/*.md       <- per-source mirror (skills/MCP later)
set -euo pipefail

project="$1"
src_global="$2"
src_template="$3"

mkdir -p "$project/.claude/orkestra"

main="$project/CLAUDE.md"
{
    printf "<!-- orkestra:generated source=instructions/global/* adapter=claude -->\n"
    printf "# Claude project guidance\n\n"
    printf "Sources under \`.claude/orkestra/\` (mirrored from Orkestra) — do not\n"
    printf "edit by hand. Run \`orkestra render\` after changing sources.\n\n"
    while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        printf -- "---\n\n"
        cat "$f"
        printf "\n"
    done < <(find "$src_global" -maxdepth 1 -type f -name "*.md" | sort)
} > "$main"

# Mirror per-source files for Claude to load on demand.
copy_into() {
    local src="$1" sub="$2"
    [[ -d "$src" ]] || return 0
    mkdir -p "$project/.claude/orkestra/$sub"
    while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        local name; name="$(basename "$f")"
        {
            printf "<!-- orkestra:generated source=%s/%s adapter=claude -->\n" "$sub" "$name"
            cat "$f"
        } > "$project/.claude/orkestra/$sub/$name"
    done < <(find "$src" -maxdepth 1 -type f -name "*.md")
}

copy_into "$src_global"   "global"
copy_into "$src_template" "template"
