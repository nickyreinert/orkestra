# Orkestra — Architecture

Status: **draft** (locked for v2 implementation, 2026-06)

This document is the source of truth for Orkestra's data model, directory
layout and CLI surface. Everything else (CLI code, templates, adapters)
must conform to this document. If implementation diverges, update this
document first.

---

## 1. Goals

1. **One source of truth** for project guidance, rendered into whatever
   format each AI coding agent expects.
2. **Composable** instructions: a global core + project-type specifics +
   (later) skills/MCP/etc.
3. **Extensible** project types and agent adapters without forking the
   tool.
4. **Self-maintaining**: any supported coding agent can be told
   "/orkestra update X" and knows how the system is wired and how to
   propose patches.
5. **Cross-platform via plain shell**, no Electron, no Node runtime
   required for the core CLI.

## 2. Concepts

### 2.1 Repository roles

There are two repositories that matter:

| Repo                         | Role                                                                |
| ---------------------------- | ------------------------------------------------------------------- |
| `~/.orkestra` (this repo)    | **Distribution**. Ships templates, instructions, adapters, the CLI. |
| User's project repo          | **Consumer**. Receives a rendered `.orkestra/` + agent files.       |

The user's project never imports code from `~/.orkestra` at runtime —
files are copied/rendered at `init` time and re-rendered on `update`.

### 2.2 Sources, Adapters, Targets

```
   sources                adapters             targets
   ───────                ────────             ───────
 instructions/global  ─┐
                       ├─►  copilot  ──►  .github/copilot-instructions.md
 instructions/        ─┤                  .github/instructions/*.md
   <template>/        ─┤
                       ├─►  claude   ──►  CLAUDE.md
 (later) skills/      ─┤                  .claude/skills/<name>/SKILL.md
                       │
                       ├─►  codex    ──►  AGENTS.md
                       │
                       └─►  generic  ──►  .orkestra/instructions/  (raw copy)
```

A **source** is an authoritative piece of guidance (a markdown file plus
optional frontmatter). An **adapter** knows how to render N sources into
the file layout a specific agent expects. A **target** is a concrete
file path inside the user's project.

Re-rendering must be **idempotent**: running `orkestra render` twice
yields the same files.

## 3. Distribution layout (`~/.orkestra/`)

```
~/.orkestra/
├── bin/
│   └── orkestra                 # single CLI entrypoint (bash)
├── lib/
│   ├── cli/                     # subcommand implementations (bash)
│   │   ├── init.sh
│   │   ├── render.sh
│   │   ├── add-agent.sh
│   │   ├── add-template.sh
│   │   ├── update.sh
│   │   ├── suggest.sh
│   │   └── doctor.sh
│   ├── ui/
│   │   ├── menu.sh              # interactive menu helpers
│   │   └── colors.sh
│   └── core/
│       ├── manifest.sh          # read/write .orkestra/manifest.yaml
│       └── render.sh            # source → adapter → target pipeline
├── adapters/
│   ├── copilot/
│   │   └── adapter.sh           # render() function, target list
│   ├── claude/
│   │   └── adapter.sh
│   ├── codex/
│   │   └── adapter.sh
│   └── generic/
│       └── adapter.sh
├── instructions/
│   └── global/                  # always rendered, regardless of template
│       ├── orkestra-meta.md     # the "supervisor" instruction
│       ├── communication.md
│       └── safety.md
├── templates/
│   ├── python-flask/
│   │   ├── template.yaml        # metadata + workflow + instruction list
│   │   └── instructions/
│   │       └── *.md
│   ├── python-cli/
│   ├── html-js/
│   └── netlify-app/
├── workflows/                   # optional reusable flow.yaml fragments
│   └── plan-code-review.yaml
├── install.sh
└── ARCHITECTURE.md (this file)
```

User-defined templates live at `~/.config/orkestra/templates/<name>/`
and shadow built-ins with the same name.

## 4. Project layout (after `orkestra init`)

```
my-project/
├── .orkestra/
│   ├── manifest.yaml            # what was rendered, with versions
│   ├── flow.yaml                # workflow (copied from template)
│   ├── state.json               # runtime state for the orchestrator
│   ├── config.yaml              # sub-agent CLI bindings (gemini, etc.)
│   ├── instructions/            # rendered raw instructions (generic adapter)
│   ├── outputs/                 # workflow step outputs
│   └── tmp/                     # scratch (gitignored)
│
├── .github/
│   ├── copilot-instructions.md  # copilot adapter, if enabled
│   └── instructions/*.md
├── CLAUDE.md                    # claude adapter, if enabled
├── .claude/                     # claude adapter, if enabled
├── AGENTS.md                    # codex adapter, if enabled
└── .vscode/tasks.json           # Orkestra: Start/Reset/Next tasks
```

Generated files carry a header marker so re-renders can detect manual edits:

```markdown
<!-- orkestra:generated source=instructions/global/communication.md adapter=copilot -->
```

## 5. `manifest.yaml` (per project)

Tracks what was rendered, so `orkestra update` is deterministic.

```yaml
orkestra_version: 2.0.0
template: python-flask
agents:
  - copilot
  - claude
sources:
  - id: global/orkestra-meta
    sha256: 9f1c…
  - id: global/communication
    sha256: e7a3…
  - id: python-flask/coding
    sha256: 41b0…
adapters:
  copilot:
    rendered_at: 2026-06-01T10:12:00Z
    files:
      - .github/copilot-instructions.md
      - .github/instructions/coding.md
  claude:
    rendered_at: 2026-06-01T10:12:00Z
    files:
      - CLAUDE.md
```

## 6. `template.yaml` (per template)

```yaml
name: python-flask
description: Python Flask web app (backend + minimal frontend)
extends: []                       # future: inheritance / mix-ins

instructions:                     # template-specific instructions
  - planning.md
  - coding.md
  - review.md

workflow: workflows/plan-code-review.yaml   # or inline `steps:` block

# future:
mcp: []
skills: []
```

Templates **never** redefine global instructions; they only add their own.

## 7. CLI surface (`orkestra`)

Single binary, all subcommands. Interactive when invoked without
arguments, scriptable when given flags.

```
orkestra                              # interactive top-level menu
orkestra init [--template T] [--agents a,b,c] [--here|--dir NAME] [-y]
orkestra render [--agent a] [--dry-run]
orkestra add-agent <name>
orkestra remove-agent <name>
orkestra add-template <name>          # scaffold a new template
orkestra list templates|agents
orkestra update [--check]             # pull latest from ~/.orkestra and re-render
orkestra suggest <url|path> [--apply] # diff remote guidance against local
orkestra doctor                       # check tools, paths, manifest integrity
orkestra version
```

Exit codes: 0 ok, 1 user error, 2 internal error, 3 conflict (manual
edits detected).

### 7a. UX modes (no extra dependencies)

The CLI must serve both non-technical users and scripts. Rules:

1. **Interactive by default, flags override.** Running `orkestra` or any
   subcommand without required arguments opens a guided wizard
   (arrow-key menu, defaults pre-selected, `?` help text per step).
   Passing all required flags skips the wizard.
2. **Plan + confirm before writing.** Every mutating command prints a
   summary of what it will create / overwrite / delete and asks for
   confirmation. `--yes` / `-y` skips confirmation for scripts.
3. **`--dry-run` everywhere it can mutate.** Shows the same plan and
   exits 0.
4. **Pure Bash.** No `gum`, `whiptail`, `dialog`, `jq`, `yq` or other
   runtime dependencies. The existing arrow-key menu helper in
   `lib/ui/menu.sh` is the only UI primitive. Optional niceties
   (colors, unicode symbols) degrade gracefully when `NO_COLOR=1` or
   the terminal isn't a TTY.
5. **Consistent status output.** `→` in-progress, `✔` success, `✖`
   failure, `!` warning. `--quiet` for CI.
6. **`orkestra doctor`** is the recovery path: it explains what's
   missing or inconsistent in plain language and prints the exact
   command to fix each issue.

YAML/JSON parsing is done with small, dependency-free Bash helpers
(line-based parser sufficient for our schema). If the schema ever
outgrows that, we revisit — but adding a runtime dep crosses a
deliberate line.

## 8. Supervisor instruction (`orkestra-meta.md`)

Always rendered globally. Tells any agent:

1. Which files in the repo are **generated by Orkestra** and must not be
   hand-edited (or how to mark intentional manual edits).
2. The mapping source → adapter → target (so the agent can locate the
   right source file when asked to change something).
3. How to propose updates: by editing `~/.orkestra/...` and re-running
   `orkestra render`, **not** by editing the rendered files.
4. The contract for `/orkestra suggest <url>`: the agent fetches the
   URL, diffs against current sources, and returns a unified patch the
   user can review.

The full text lives in `instructions/global/orkestra-meta.md` and is
the only piece of guidance that mentions Orkestra itself by name.

## 9. Update / suggest flow

```
orkestra update
  ├─ git -C ~/.orkestra pull --ff-only
  ├─ recompute sha256 of every source listed in manifest
  ├─ for each changed source: re-render via its adapters
  ├─ for each rendered target with manual edits: warn, do not overwrite
  └─ rewrite manifest.yaml

orkestra suggest <url>
  ├─ fetch <url> as markdown
  ├─ classify (which source does it most resemble?) — heuristic + ask user
  ├─ produce a unified diff against the chosen source
  └─ on --apply: write into ~/.orkestra/instructions/... and re-render
```

Both commands are **read-only by default**; mutations require `--apply`
or interactive confirmation.

## 10. Out of scope (for v2.0)

- MCP / Skill packaging beyond a placeholder field in `template.yaml`.
- A web/Electron UI. The interactive shell menu is the GUI.
- Multi-repo orchestration / monorepos with multiple templates.
- Auto-merging remote suggestions.
- Backwards compatibility with v1 (`flavors/`, `init-orkestra`, the
  per-template `global.instructions.md`). v1 is removed; users
  re-initialize their projects with `orkestra init`.
