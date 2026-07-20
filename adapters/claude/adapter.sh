#!/usr/bin/env bash
# Claude adapter: thin hook to .orkestra/AGENTS.md.
set -euo pipefail

project="$1"
_src_global="$2"
_src_template="$3"

main="$project/CLAUDE.md"
{
    printf "<!-- orkestra:generated agent=claude scope=project -->\n"
    printf "# Orkestra hook\n\n"
    printf "@import \"./.orkestra/AGENTS.md\"\n"
} > "$main"
