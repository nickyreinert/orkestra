#!/usr/bin/env bash
# orkestra hook: validate-commit-msg
# Git event: commit-msg
# Validates the commit message subject line against the conventional commit
# format:  type: subject  or  type(scope): subject
#
# Valid types: feat, fix, refactor, test, docs, chore, style, perf, ci, build, revert
set -euo pipefail

COMMIT_MSG_FILE="$1"
[[ -f "$COMMIT_MSG_FILE" ]] || exit 0

# Read first non-empty, non-comment line as the subject.
subject=""
while IFS= read -r line; do
    [[ "$line" =~ ^# ]] && continue
    [[ -z "${line// }" ]] && continue
    subject="$line"
    break
done < "$COMMIT_MSG_FILE"

[[ -z "$subject" ]] && exit 0

TYPES="feat|fix|refactor|test|docs|chore|style|perf|ci|build|revert"
PATTERN="^(${TYPES})(\([^)]+\))?(!)?: .+"

if ! [[ "$subject" =~ $PATTERN ]]; then
    printf "\033[0;31m✖\033[0m orkestra/validate-commit-msg: invalid commit message format\n" >&2
    printf "\n  subject: %s\n" "$subject" >&2
    printf "\n  expected: type: subject  or  type(scope): subject\n" >&2
    printf "  valid types: %s\n\n" "$TYPES" >&2
    printf "  examples:\n" >&2
    printf "    feat: add user authentication\n" >&2
    printf "    fix(auth): handle token expiry edge case\n" >&2
    printf "    chore!: drop Python 3.8 support\n\n" >&2
    exit 1
fi

exit 0
