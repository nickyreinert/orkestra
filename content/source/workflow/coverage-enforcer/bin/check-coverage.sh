#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${ORKESTRA_COVERAGE_COMMAND:-}" ]]; then
  bash -lc "$ORKESTRA_COVERAGE_COMMAND"
elif [[ -f Makefile ]] && grep -q '^coverage:' Makefile; then
  make coverage
else
  echo "No coverage command configured. Set ORKESTRA_COVERAGE_COMMAND or add a Makefile coverage target." >&2
  exit 2
fi
