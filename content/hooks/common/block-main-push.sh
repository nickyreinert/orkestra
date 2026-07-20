#!/usr/bin/env bash
# orkestra hook: block-main-push
# Git event: pre-push
# Blocks direct pushes to the main or master branch.
# All changes must go through a pull request.
set -euo pipefail

PROTECTED="main master"

while IFS= read -r _local_ref _local_sha _remote_ref _remote_sha; do
    branch="${_remote_ref#refs/heads/}"
    for protected in $PROTECTED; do
        if [[ "$branch" == "$protected" ]]; then
            printf "\033[0;31m✖\033[0m orkestra/block-main-push: direct push to '%s' is not allowed\n" "$branch" >&2
            printf "\nAll changes must go through a pull request.\n" >&2
            printf "Create a feature branch:  git checkout -b feat/your-change\n\n" >&2
            exit 1
        fi
    done
done

exit 0
