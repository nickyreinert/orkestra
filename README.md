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

Once installed, navigate to your project directory and run:

```bash
mkdir my-new-project
cd my-new-project
orkestra init
```

Follow the interactive prompts to:
1. Select a project template (e.g. Python Flask, HTML/JS).
2. Pick which AI coding agents to support (Copilot, Claude, Codex, …).
3. Initialize a Git repository (optional).

Or skip the wizard with flags:

```bash
orkestra init --template python-flask --agents copilot,claude --here -y
```

## CLI

```
orkestra                              interactive top-level menu
orkestra init        [--template T] [--agents a,b,c] [--here|--dir N] [-y]
orkestra render      [--agent a] [--dry-run]
orkestra list        templates|agents|entities
orkestra enable      <entity> [--scope project|global] [--agents a,b,c]
orkestra disable     <entity> [--scope project|global]
orkestra status      [--scope project|global]
orkestra add-agent    <name>
orkestra remove-agent <name>
orkestra add-template <name>
orkestra update      [--check]
orkestra suggest     <url|path> [--apply]
orkestra webui       [--host 127.0.0.1] [--port 8732]
orkestra doctor
orkestra version
```

Global flags: `-y/--yes`, `--quiet`, `--dry-run`.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full data model.

## Entity Model

Orkestra can install reusable guidance entities from `content/source/` into a
scope-specific `AGENTS.md` index:

- Source scope: shipped read-only entities under `content/source/`
- Global scope: user-wide entities under the platform-specific Orkestra data dir
- Project scope: repository-local entities under `.orkestra/`

Project agent files such as `AGENTS.md`, `CLAUDE.md`, and
`.github/copilot/instructions.md` are thin hooks that import
`.orkestra/AGENTS.md`. The actual installed entity content lives under
`.orkestra/entities/`.

## WebUI Global Mode Settings

The WebUI `Global` mode reads files from a small set of common locations only.
It does not recursively scan your whole home directory.

Default locations are defined in `settings/global-locations.yaml`:

- `global_locations`: common folders (top-level files only)
- `global_files`: exact file paths

You can override these defaults per machine in:

- `~/.config/orkestra/settings.yaml`

Example:

```yaml
global_locations:
    claude:
        - ~/.claude
    copilot:
        - ~/.github

global_files:
    codex:
        - ~/AGENTS.md
    copilot:
        - ~/.github/copilot-instructions.md
```

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
~/.orkestra/                     # distribution
├── bin/orkestra                 # CLI entrypoint
├── lib/{cli,ui,core}/           # subcommands + helpers
├── adapters/{copilot,claude,codex,generic}/
├── instructions/global/         # universal sources rendered for every project
├── templates/                   # project templates (python-flask, html-js, …)
└── ARCHITECTURE.md
```

After `orkestra init`, your project gets:

```
my-project/
├── .orkestra/                   # manifest, flow, state, config, outputs
├── .github/copilot-instructions.md   # if 'copilot' enabled
├── CLAUDE.md, .claude/          # if 'claude' enabled
└── AGENTS.md                    # if 'codex' enabled
```

Generated files carry a `<!-- orkestra:generated … -->` marker. Edit the
**sources** in `~/.orkestra/`, then run `orkestra render`.

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
