#!/bin/bash
set -e

SUB_AGENT=$1
PROMPT=$2
CONTEXT_FILE=$3
OUTPUT_FILE=$4

# Read config
CONFIG_FILE=".orkestra/config.yaml"

# Extract command and args template (requires yq or python)
# Simple grep/awk parsing (assumes standard formatting)
COMMAND_LINE=$(grep -A 2 "^  $SUB_AGENT:" "$CONFIG_FILE" | grep "command:" | head -n 1)
COMMAND=$(echo "$COMMAND_LINE" | sed -E 's/.*command: "([^"]+)".*/\1/')
ARGS_TEMPLATE_LINE=$(grep -A 2 "^  $SUB_AGENT:" "$CONFIG_FILE" | grep "args_template:" | head -n 1)
ARGS_TEMPLATE=$(echo "$ARGS_TEMPLATE_LINE" | sed -E 's/.*args_template: "([^"]+)".*/\1/')

# Check if command exists
if ! command -v "$(echo "$COMMAND" | awk '{print $1}')" &> /dev/null; then
    echo "❌ Error: Sub-agent command '$COMMAND' not found in PATH."
    echo "   Please check .orkestra/config.yaml and ensure the tool is installed."
    echo "   Current PATH: $PATH"
    exit 1
fi

# Replace placeholders
ARGS="${ARGS_TEMPLATE//\{prompt\}/$PROMPT}"
ARGS="${ARGS//\{context_file\}/$CONTEXT_FILE}"

# Execute sub-agent
echo "🤖 Running sub-agent: $SUB_AGENT"
eval "$COMMAND $ARGS" > "$OUTPUT_FILE"

echo "✅ Sub-agent completed. Output: $OUTPUT_FILE"
