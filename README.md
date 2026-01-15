# Orkestra

<p align="center"><img src="orkestra.png" width="128" alt="Orkestra logo"></p>

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

### Quick Install

To install Orkestra globally, run the following command in your terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/nickyreinert/orkestra/main/install.sh | bash
```

This will download the repository to `~/.orkestra` and add the `bin` directory to your PATH.

### Manual Install

Alternatively, you can clone the repository and install it manually:

```bash
git clone https://github.com/nickyreinert/orkestra.git
cd orkestra
./install.sh
```

### Initialize a New Project

Once installed, navigate to your project directory and run the initialization script:

```bash
mkdir my-new-project
cd my-new-project
init-orkestra
```

Follow the interactive prompts to:
1. Select a project flavor (e.g., Python Flask, HTML/JS).
2. Initialize a Git repository (optional).

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

This repository contains the framework source code and flavor definitions.

```
.orkestra/
├── flavors/                     # Project templates
│   ├── python-flask/            # Example flavor
│   │   ├── config.yaml          # Flavor-specific config
│   │   ├── flow.yaml            # Flavor-specific workflow
│   │   └── instructions/        # Flavor-specific instructions
│   └── [other-flavors]/
├── scripts/                     # Shared utility scripts
│   └── run_sub_agent.sh
└── state.json                   # Local state (for dev/testing)

bin/
└── init-orkestra.sh             # Initialization script

.github/
└── copilot-instructions.md      # Global Copilot instructions

.vscode/
└── tasks.json                   # VS Code tasks
```

## Flavors & Initialization

Orkestra uses "flavors" to define project-specific workflows. Each flavor (located in `.orkestra/flavors/`) contains its own:
- `flow.yaml`: The workflow steps and rules.
- `config.yaml`: Configuration for sub-agents and tools.
- `instructions/`: Markdown files with role-specific prompts.

When you run `bin/init-orkestra.sh` in a new project:
1. You select a flavor (e.g., `python-flask`).
2. The script copies that flavor's `flow.yaml`, `config.yaml`, and `instructions/` into your project's `.orkestra/` directory.
3. It also installs the shared `scripts/` and `.github/copilot-instructions.md`.

This ensures that every project has a self-contained configuration tailored to its technology stack.

Key points:
- **Where defined:** Flavors are declared during `init-orkestra.sh` and referenced in `flow.yaml` or `config.yaml`.
- **What they change:** the set of instruction files, default task order, scaffolding templates, and optional sub-agent hooks.
- **How instructions are chosen:** When a flavor is active, Orkestra will prefer instruction files under `instructions/<flavor>/` (if present) and fall back to the global files in `instructions/`.

Example `flow.yaml`:

```yaml
steps:
    - id: planning
        role: product
        instructions:
            - instructions/global.instructions.md
            - instructions/python-flask/planning.instructions.md
        output: .orkestra/outputs/plan.md

    - id: backend
        role: backend
        instructions:
            - instructions/global.instructions.md
            - instructions/python-flask/coding.instructions.md
        output: .orkestra/outputs/backend.md
```

This approach keeps global guidance available while allowing flavor-specific behavior to override or extend steps.

## Customization

### Add Custom Steps

Edit `.orkestra/flow.yaml` to insert new roles, inputs, outputs, or sub-agents.

### Add CLI Validators

Define new entries under `sub_agents` or `validation_tools` inside `.orkestra/config.yaml` to integrate linters, security scanners, or other automation.

## Sub-Agents & Tools

Orkestra's default configuration references example CLI tools (like `gemini-cli`, `mistral`, `claude-code`). **These are not installed by Orkestra.**

You must:
1.  Install the CLI tools you want to use (e.g., `pip install gemini-cli` if available, or your own wrapper script).
2.  Ensure they are in your system `PATH`.
3.  Or, edit `.orkestra/config.yaml` to point to the correct executable path (e.g., `command: "/usr/bin/python3 scripts/my_gemini_wrapper.py"`).