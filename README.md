# Orkestra

Orchestration framework for VS Code Copilot that coordinates multi-step AI development workflows with optional CLI sub-agents.

## Purpose

- Lead developers through structured planning → coding → review → testing loops
- Keep Copilot focused on the current workflow step via scoped instructions
- Delegate specialized checks to CLI sub-agents (Gemini, Mistral, Claude, etc.)
- Persist workflow state so Copilot can resume seamlessly inside VS Code

## How It Works

1. User interacts with Copilot Chat.
2. Copilot reads `.orkestra/state.json` to determine the active step.
3. Copilot consults `.orkestra/flow.yaml` to load that step's instruction files.
4. Copilot (or a configured sub-agent) produces the requested output, stores it under `.orkestra/outputs/`, then advances the state.

## Setup

1. Copy the `.orkestra/` folder into your project (includes config, flow, instructions, scripts).
2. Copy `.github/copilot-instructions.md` so Copilot understands the context-loading protocol.
3. (Optional) Customize `.orkestra/flow.yaml` to match your workflow.
4. (Optional) Extend `.orkestra/config.yaml` with additional sub-agents or validation tools.

## Usage

### Start Workflow

Run the VS Code task `Orkestra: Start Workflow` or ask Copilot:

```
@workspace Start the orchestrate workflow
```

### Reset Workflow

Run the task `Orkestra: Reset` or execute:

```bash
rm -f .orkestra/state.json && echo '{"current_step_index": 0, "previous_output": {}, "loaded_instructions": []}' > .orkestra/state.json
```

### Workflow Steps (Default)

0. Planning (Product Manager) → produces `.orkestra/outputs/plan.md`
1. Backend (Backend Developer) → produces `.orkestra/outputs/backend.md`
2. Frontend (Frontend Developer) → produces `.orkestra/outputs/frontend.md`
3. Review (Gemini sub-agent) → produces `.orkestra/outputs/review.md`

## Structure

```
.orkestra/
├── config.yaml                  # Sub-agent + validation tool config
├── flow.yaml                    # Workflow definition
├── state.json                   # Current progress for Copilot
├── instructions/                # Instruction sets loaded per step
│   ├── global.instructions.md
│   ├── planning.instructions.md
│   ├── coding.instructions.md
│   ├── testing.instructions.md
│   └── review.instructions.md
├── outputs/                     # Generated artifacts per step
└── scripts/
    └── run_sub_agent.sh         # Helper script for CLI sub-agents

.github/
└── copilot-instructions.md      # Tells Copilot how to load state + instructions

.vscode/
└── tasks.json                   # Convenience tasks (start, reset, next step, test sub-agent)
```

## Customization

### Add Custom Steps

Edit `.orkestra/flow.yaml` to insert new roles, inputs, outputs, or sub-agents.

### Add CLI Validators

Define new entries under `sub_agents` or `validation_tools` inside `.orkestra/config.yaml` to integrate linters, security scanners, or other automation.