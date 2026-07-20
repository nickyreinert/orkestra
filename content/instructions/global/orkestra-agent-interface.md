# Orkestra Agent Interface

If you are a coding agent working in an Orkestra-managed project:

- Prefer MCP tools from `orkestra_mcp_server.py`.
- If MCP is unavailable, use Orkestra local API endpoints.

## Source of truth

- Editable sources: `templates/...`, `instructions/global/...`, `skills/...`,
  `mcp/...`, `workflows/...`.
- Rendered files are read-only observability artifacts.

## Required workflow

1. Read current status (`orkestra_status`).
2. Read/update source files.
3. Re-render project (`orkestra_render_project`).
4. Show source-vs-rendered diff (`orkestra_diff_source_rendered`) for user review.

## Do not

- Do not hand-edit rendered targets as primary change path.
- Do not skip re-render after changing source instructions.
