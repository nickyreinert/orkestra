#!/bin/bash
set -e

SUB_AGENT=$1
PROMPT=$2
CONTEXT_FILE=$3
OUTPUT_FILE=$4

# Read config
CONFIG_FILE=".orkestra/config.yaml"

# Extract command and args template (requires yq or python)
COMMAND=$(grep -A 2 "^  $SUB_AGENT:" "$CONFIG_FILE" | grep "command:" | awk '{print $2}' | tr -d '"')
ARGS_TEMPLATE=$(grep -A 2 "^  $SUB_AGENT:" "$CONFIG_FILE" | grep "args_template:" | cut -d'"' -f2)

# Replace placeholders
ARGS="${ARGS_TEMPLATE//\{prompt\}/$PROMPT}"
ARGS="${ARGS//\{context_file\}/$CONTEXT_FILE}"

# Execute sub-agent
echo "🤖 Running sub-agent: $SUB_AGENT"
eval "$COMMAND $ARGS" > "$OUTPUT_FILE"

echo "✅ Sub-agent completed. Output: $OUTPUT_FILE"
