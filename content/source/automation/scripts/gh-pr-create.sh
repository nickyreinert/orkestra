#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
    printf "gh CLI is required\n" >&2
    exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf "not inside a git repository\n" >&2
    exit 1
fi

branch="$(git branch --show-current)"
if [[ -z "$branch" ]]; then
    printf "cannot determine current branch\n" >&2
    exit 1
fi

gh pr create --fill
gh pr edit "$branch" --add-label "needs-review" 2>/dev/null || true
