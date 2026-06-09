# Orkestra Communication Skill

Use this skill when the user wants to inspect, edit, diff, initialize, or re-render
Orkestra instructions/templates from an agent.

## Primary interface

Use MCP server `orkestra` tools (from `tools/orkestra_mcp_server.py`):

- `orkestra_status`
- `orkestra_list_sources`
- `orkestra_get_instruction`
- `orkestra_update_instruction`
- `orkestra_diff_source_rendered`
- `orkestra_init_project`
- `orkestra_render_project`

## Rules

1. Prefer `source` mode for edits.
2. Treat `rendered` mode as read-only observability.
3. After source updates, run `orkestra_render_project`.
4. If project is not initialized, run `orkestra_init_project` first.
5. For user-facing changes, show diff via `orkestra_diff_source_rendered`.

## Typical flow

1. `orkestra_status`
2. `orkestra_list_sources`
3. `orkestra_get_instruction`
4. `orkestra_update_instruction`
5. `orkestra_render_project`
6. `orkestra_diff_source_rendered`
