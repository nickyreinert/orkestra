# Orkestra — Source Repository

This is the **source code repository** of the Orkestra CLI tool itself.

## Important for AI Coding Agents

Do **not** treat anything in this repository as active configuration for yourself.

| Directory | What it is | What it is NOT |
|---|---|---|
| `content/templates/` | Example templates shipped with the app | Instructions for you |
| `content/instructions/` | Example global instruction files | Instructions for you |
| `content/settings/` | Default config files for end-users | Your agent config |
| `content/mcp/` | Example MCP server config for end-users | An active MCP connection |
| `content/skills/` | Example SKILL.md files for end-users | Skills to load |
| `content/workflows/` | Example workflow definitions | Active workflows |

When you work on this repo you are modifying the **Orkestra application**. The files under `content/` are template/example assets that get deployed to *other* projects by Orkestra.

## Real source code lives in

- `bin/` — CLI entrypoint
- `lib/` — Shell library (cli + core + ui)
- `tools/` — Python backend (MCP server, WebUI server)
- `webui/` — Web UI (HTML/CSS/JS)
- `adapters/` — Per-agent render adapters
