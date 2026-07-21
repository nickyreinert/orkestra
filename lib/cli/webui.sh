#!/usr/bin/env bash
# Run Orkestra WebUI server.
set -euo pipefail

HOST="127.0.0.1"
PORT="8732"

usage() {
    cat <<EOF
Usage: orkestra webui [options]

Start the local Orkestra WebUI server.

Options:
  --host <host>    Bind host (default: 127.0.0.1)
  --port <port>    Bind port (default: 8732)
  -h, --help       Show this help
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --host)
            HOST="${2:-}"
            shift 2
            ;;
        --port)
            PORT="${2:-}"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
    echo "Error: --port must be an integer between 1 and 65535"
    exit 1
fi

run_server() {
    if command -v python3 >/dev/null 2>&1; then
        env PYTHONUNBUFFERED=1 ORKESTRA_WEBUI_HOST="$HOST" ORKESTRA_WEBUI_PORT="$PORT" python3 "$ORK_HOME/tools/webui_server.py"
    elif command -v python >/dev/null 2>&1; then
        env PYTHONUNBUFFERED=1 ORKESTRA_WEBUI_HOST="$HOST" ORKESTRA_WEBUI_PORT="$PORT" python "$ORK_HOME/tools/webui_server.py"
    else
        echo "Error: python3/python not found on PATH"
        exit 1
    fi
}

if [[ ! -t 0 || ! -t 1 ]]; then
    run_server
    exit $?
fi

run_server &
server_pid=$!

cleanup() {
    if kill -0 "$server_pid" >/dev/null 2>&1; then
        kill "$server_pid" >/dev/null 2>&1 || true
        wait "$server_pid" >/dev/null 2>&1 || true
    fi
    printf "\033[?25h"
}

trap 'cleanup; exit 130' INT TERM
trap cleanup EXIT

printf "Press ESC to stop the WebUI server.\n"
esc="$(printf "\033")"
while kill -0 "$server_pid" >/dev/null 2>&1; do
    key=""
    if IFS= read -rsn1 -t 1 key; then
        if [[ "$key" == "$esc" ]]; then
            printf "\nStopping Orkestra WebUI...\n"
            cleanup
            trap - EXIT
            exit 0
        fi
    fi
done

wait "$server_pid"
exit $?
