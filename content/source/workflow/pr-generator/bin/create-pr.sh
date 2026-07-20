#!/usr/bin/env bash
set -euo pipefail

git diff --quiet || { echo "Working tree has uncommitted changes" >&2; exit 1; }
template=".github/pull_request_template.md"
if [[ -f "$template" ]]; then
  gh pr create --fill --body-file "$template"
else
  gh pr create --fill
fi
