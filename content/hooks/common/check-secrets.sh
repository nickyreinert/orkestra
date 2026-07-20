#!/usr/bin/env bash
# orkestra hook: check-secrets
# Git event: pre-commit
# Blocks the commit when staged files contain patterns that look like
# hardcoded secrets (API keys, passwords, tokens, private keys).
set -euo pipefail

PATTERNS=(
    'api[_-]?key[[:space:]]*[:=][[:space:]]*["\x27][^"\x27]{8,}'
    'api[_-]?secret[[:space:]]*[:=][[:space:]]*["\x27][^"\x27]{8,}'
    'password[[:space:]]*[:=][[:space:]]*["\x27][^"\x27]{6,}'
    'passwd[[:space:]]*[:=][[:space:]]*["\x27][^"\x27]{6,}'
    'secret[_-]?key[[:space:]]*[:=][[:space:]]*["\x27][^"\x27]{8,}'
    'access[_-]?token[[:space:]]*[:=][[:space:]]*["\x27][^"\x27]{8,}'
    'private[_-]?key[[:space:]]*[:=][[:space:]]*["\x27][^"\x27]{8,}'
    'client[_-]?secret[[:space:]]*[:=][[:space:]]*["\x27][^"\x27]{8,}'
    'auth[_-]?token[[:space:]]*[:=][[:space:]]*["\x27][^"\x27]{8,}'
    '-----BEGIN (RSA|EC|DSA|OPENSSH) PRIVATE KEY-----'
)

diff=$(git diff --cached --diff-filter=ACMR -U0 2>/dev/null) || true
[[ -z "$diff" ]] && exit 0

found=""
for pattern in "${PATTERNS[@]}"; do
    match=$(printf "%s" "$diff" | grep -iE "$pattern" | grep -v '^-' || true)
    [[ -n "$match" ]] && found+="$match"$'\n'
done

if [[ -n "$found" ]]; then
    printf "\033[0;31m✖\033[0m orkestra/check-secrets: potential secret in staged files\n" >&2
    printf "\n%s\n" "$found" | head -5 >&2
    printf "\nMove secret values to environment variables and re-stage.\n" >&2
    printf "To skip (only if certain it is a false positive): git commit --no-verify\n\n" >&2
    exit 1
fi

exit 0
