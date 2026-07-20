# Orkestra Agent Bridge

Purpose: provide a consistent way for coding agents to update Orkestra guidance
through MCP or HTTP API without directly editing rendered files.

## Preferred protocol

1. Use MCP tools from `tools/orkestra_mcp_server.py`.
2. If MCP is unavailable, use the local HTTP API from `tools/webui_server.py`.

## Hard constraints

- Edit only source files (`templates/...`, `instructions/global/...`, `skills/...`, `mcp/...`, `workflows/...`).
- Treat rendered files as read-only observability.
- Re-render after updates (`orkestra_render_project` or `POST /api/render`).

## MCP fallback API mapping

- `orkestra_status` -> `GET /api/context`
- `orkestra_list_sources` -> `GET /api/templates`
- `orkestra_get_instruction` -> `GET /api/file`
- `orkestra_update_instruction` -> `POST /api/save`
- `orkestra_diff_source_rendered` -> `GET /api/diff`
- `orkestra_init_project` -> `POST /api/init`
- `orkestra_render_project` -> `POST /api/render`
