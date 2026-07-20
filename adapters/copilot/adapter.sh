#!/usr/bin/env bash
# Copilot adapter: thin hook to .orkestra/AGENTS.md.
set -euo pipefail

project="$1"
_src_global="$2"
_src_template="$3"

mkdir -p "$project/.github/copilot"

main="$project/.github/copilot/instructions.md"
{
    printf "<!-- orkestra:generated agent=copilot scope=project -->\n"
    printf "# Orkestra hook\n\n"
    printf "@import \"../../.orkestra/AGENTS.md\"\n"
} > "$main"
