#!/usr/bin/env bash
set -euo pipefail

title="${1:-decision}"
slug=$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-')
mkdir -p docs/adr
file="docs/adr/$(date +%Y%m%d)-${slug%-}.md"
cat > "$file" <<EOF
# $title

## Context

## Decision

## Consequences
EOF
printf '%s\n' "$file"
