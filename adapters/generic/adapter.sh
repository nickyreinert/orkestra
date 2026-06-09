#!/usr/bin/env bash
# Generic adapter: raw mirror of all sources into .orkestra/instructions/.
# Used as the "always-on" baseline that orkestra-meta.md and the workflow
# orchestrator read from.
set -euo pipefail

project="$1"
src_global="$2"
src_template="$3"

target_dir="$project/.orkestra/instructions"
mkdir -p "$target_dir/global"
[[ -d "$src_template" ]] && mkdir -p "$target_dir/template"

write_file() {
    local src="$1" dst="$2" rel="$3"
    {
        printf "<!-- orkestra:generated source=%s adapter=generic -->\n" "$rel"
        cat "$src"
    } > "$dst"
}

while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    name="$(basename "$f")"
    write_file "$f" "$target_dir/global/$name" "global/$name"
done < <(find "$src_global" -maxdepth 1 -type f -name "*.md" 2>/dev/null)

if [[ -d "$src_template" ]]; then
    while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        name="$(basename "$f")"
        write_file "$f" "$target_dir/template/$name" "template/$name"
    done < <(find "$src_template" -maxdepth 1 -type f -name "*.md" 2>/dev/null)
fi
