#!/usr/bin/env bash
# orkestra add-template <name> — scaffold a new user template.
set -euo pipefail
source "$ORK_HOME/lib/ui/colors.sh"
source "$ORK_HOME/lib/core/paths.sh"

name="${1:-}"
[[ -n "$name" ]] || ork_die "Usage: orkestra add-template <name>"

dir="$ORK_USER_DIR/templates/$name"
[[ -e "$dir" ]] && ork_die "Already exists: $dir"

mkdir -p "$dir/instructions"
cat > "$dir/template.yaml" <<EOF
name: $name
description: TODO — describe this template
extends: []

instructions:
  - coding.instructions.md

workflow: flow.yaml

mcp: []
skills: []
EOF
cat > "$dir/instructions/coding.instructions.md" <<EOF
# Coding instructions for $name

TODO: write stack-specific guidance here.
EOF
cat > "$dir/flow.yaml" <<EOF
global_instructions: "global.instructions.md"

steps:
  - id: "0_planning"
    role: "product_manager"
    instruction_files: []
    prompt: "Draft a plan."
    output_file: ".orkestra/outputs/plan.md"
EOF

ork_ok "template scaffolded: $dir"
ork_dim "edit it, then run: orkestra init --template $name"
