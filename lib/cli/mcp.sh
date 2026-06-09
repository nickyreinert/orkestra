#!/usr/bin/env bash
# Run Orkestra MCP server (stdio).
set -euo pipefail

if command -v python3 >/dev/null 2>&1; then
    exec python3 "$ORK_HOME/tools/orkestra_mcp_server.py"
elif command -v python >/dev/null 2>&1; then
    exec python "$ORK_HOME/tools/orkestra_mcp_server.py"
else
    echo "Error: python3/python not found on PATH"
    exit 1
fi
