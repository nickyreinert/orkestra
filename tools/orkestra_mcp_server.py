#!/usr/bin/env python3
from __future__ import annotations

import difflib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT_DIR = Path.cwd()
TEMPLATES_DIR = ROOT / "templates"
ADAPTERS_DIR = ROOT / "adapters"


def safe_name(value: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9._-]+", value))


def list_agents() -> list[str]:
    agents: list[str] = []
    if not ADAPTERS_DIR.exists():
        return agents
    for d in sorted(ADAPTERS_DIR.iterdir()):
        if not d.is_dir():
            continue
        if d.name == "generic":
            continue
        if (d / "adapter.sh").exists():
            agents.append(d.name)
    return agents


def resolve_path(mode: str, rel: str) -> tuple[Path | None, str | None]:
    base = PROJECT_DIR if mode == "rendered" else ROOT
    candidate = (base / rel).resolve()
    if not str(candidate).startswith(str(base)):
        return None, "Invalid path"
    return candidate, None


def is_source_write_allowed(parts: tuple[str, ...]) -> bool:
    if len(parts) >= 3 and parts[0] == "templates" and safe_name(parts[1]):
        return True
    if len(parts) >= 3 and parts[0] == "instructions" and parts[1] == "global":
        return True
    if len(parts) >= 1 and parts[0] in {"skills", "mcp", "workflows"}:
        return True
    return False


def map_source_to_rendered(rel: str) -> str | None:
    if rel.startswith("instructions/global/"):
        name = rel.split("/", 2)[2]
        return f".orkestra/instructions/global/{name}"

    match = re.fullmatch(r"templates/[^/]+/instructions/(.+)", rel)
    if match:
        return f".orkestra/instructions/template/{match.group(1)}"

    return None


def run_orkestra(args: list[str]) -> tuple[bool, int, str, str]:
    binary = shutil.which("orkestra")
    if binary is None:
        local_bin = ROOT / "bin" / "orkestra"
        if local_bin.exists() and local_bin.is_file():
            binary = str(local_bin)
        else:
            return False, 127, "", "'orkestra' command not found on PATH and no local bin/orkestra present"

    proc = subprocess.run(
        [binary, *args],
        cwd=str(PROJECT_DIR),
        capture_output=True,
        text=True,
        check=False,
    )
    return proc.returncode == 0, proc.returncode, proc.stdout, proc.stderr


def list_source_files() -> dict:
    templates: list[dict] = []
    if TEMPLATES_DIR.exists():
        for d in sorted(TEMPLATES_DIR.iterdir()):
            if not d.is_dir():
                continue
            instruction_files = []
            instructions_dir = d / "instructions"
            if instructions_dir.exists():
                for p in sorted(instructions_dir.glob("*.md")):
                    if p.is_file():
                        instruction_files.append(f"templates/{d.name}/instructions/{p.name}")
            templates.append(
                {
                    "name": d.name,
                    "templateYaml": f"templates/{d.name}/template.yaml",
                    "instructionFiles": instruction_files,
                }
            )

    globals_dir = ROOT / "instructions" / "global"
    global_files = []
    if globals_dir.exists():
        for p in sorted(globals_dir.glob("*.md")):
            if p.is_file():
                global_files.append(f"instructions/global/{p.name}")

    return {
        "templates": templates,
        "globalFiles": global_files,
        "agents": list_agents(),
    }


def tool_orkestra_status(_args: dict) -> dict:
    return {
        "distributionRoot": str(ROOT),
        "projectDir": str(PROJECT_DIR),
        "projectInitialized": (PROJECT_DIR / ".orkestra").is_dir(),
        "manifestPresent": (PROJECT_DIR / ".orkestra" / "manifest.yaml").is_file(),
        "availableAgents": list_agents(),
    }


def tool_orkestra_list_sources(_args: dict) -> dict:
    return list_source_files()


def tool_orkestra_get_instruction(args: dict) -> dict:
    rel = str(args.get("path", "")).strip()
    mode = str(args.get("mode", "source")).strip() or "source"

    if not rel:
        return {"error": "Missing path"}

    target, err = resolve_path(mode, rel)
    if err or target is None:
        return {"error": err or "Invalid path"}
    if not target.exists() or not target.is_file():
        return {"error": "File not found"}

    return {
        "path": rel,
        "mode": mode,
        "content": target.read_text(encoding="utf-8"),
    }


def tool_orkestra_update_instruction(args: dict) -> dict:
    rel = str(args.get("path", "")).strip()
    content = str(args.get("content", ""))

    if not rel:
        return {"error": "Missing path"}

    target, err = resolve_path("source", rel)
    if err or target is None:
        return {"error": err or "Invalid path"}

    parts = target.relative_to(ROOT).parts
    if not is_source_write_allowed(parts):
        return {"error": "Write path not allowed"}

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return {"ok": True, "path": rel}


def tool_orkestra_diff_source_rendered(args: dict) -> dict:
    rel = str(args.get("sourcePath", "")).strip()
    if not rel:
        return {"error": "Missing sourcePath"}

    source_file, err = resolve_path("source", rel)
    if err or source_file is None:
        return {"error": err or "Invalid sourcePath"}
    if not source_file.exists() or not source_file.is_file():
        return {"error": "Source file not found"}

    rendered_rel = map_source_to_rendered(rel)
    if rendered_rel is None:
        return {
            "source": rel,
            "rendered": None,
            "available": False,
            "diff": "No rendered mapping for this source file.",
        }

    rendered_file, err = resolve_path("rendered", rendered_rel)
    if err or rendered_file is None:
        return {"error": err or "Invalid rendered path"}

    src_lines = source_file.read_text(encoding="utf-8").splitlines(keepends=True)
    if rendered_file.exists() and rendered_file.is_file():
        dst_lines = rendered_file.read_text(encoding="utf-8").splitlines(keepends=True)
        available = True
    else:
        dst_lines = []
        available = False

    diff_text = "".join(
        difflib.unified_diff(
            src_lines,
            dst_lines,
            fromfile=f"source/{rel}",
            tofile=f"rendered/{rendered_rel}",
            lineterm="",
        )
    )
    if not diff_text:
        diff_text = "No differences."

    return {
        "source": rel,
        "rendered": rendered_rel,
        "available": available,
        "diff": diff_text,
    }


def tool_orkestra_init_project(args: dict) -> dict:
    template = str(args.get("template", "")).strip()
    agents = args.get("agents", [])

    if not template:
        return {"error": "Missing template"}
    if not safe_name(template):
        return {"error": "Invalid template"}
    if not (TEMPLATES_DIR / template).is_dir():
        return {"error": f"Unknown template: {template}"}
    if not isinstance(agents, list) or not agents:
        return {"error": "Select at least one agent"}

    valid_agents = set(list_agents())
    cleaned_agents: list[str] = []
    for agent in agents:
        if not isinstance(agent, str):
            continue
        candidate = agent.strip()
        if candidate in valid_agents:
            cleaned_agents.append(candidate)

    if not cleaned_agents:
        return {"error": "No valid agents selected"}

    ok, code, out, err = run_orkestra(
        [
            "init",
            "--template",
            template,
            "--agents",
            ",".join(cleaned_agents),
            "--here",
            "-y",
        ]
    )
    return {
        "ok": ok,
        "returncode": code,
        "stdout": out,
        "stderr": err,
    }


def tool_orkestra_render_project(_args: dict) -> dict:
    ok, code, out, err = run_orkestra(["render"])
    return {
        "ok": ok,
        "returncode": code,
        "stdout": out,
        "stderr": err,
    }


TOOLS = {
    "orkestra_status": tool_orkestra_status,
    "orkestra_list_sources": tool_orkestra_list_sources,
    "orkestra_get_instruction": tool_orkestra_get_instruction,
    "orkestra_update_instruction": tool_orkestra_update_instruction,
    "orkestra_diff_source_rendered": tool_orkestra_diff_source_rendered,
    "orkestra_init_project": tool_orkestra_init_project,
    "orkestra_render_project": tool_orkestra_render_project,
}


TOOL_SCHEMAS = [
    {
        "name": "orkestra_status",
        "description": "Get Orkestra distribution/project status and available agents.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "orkestra_list_sources",
        "description": "List editable source instruction files/templates and available agents.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "orkestra_get_instruction",
        "description": "Read one instruction file from source or rendered mode.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "mode": {"type": "string", "enum": ["source", "rendered"]},
            },
            "required": ["path"],
        },
    },
    {
        "name": "orkestra_update_instruction",
        "description": "Update one source instruction file/template file.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "orkestra_diff_source_rendered",
        "description": "Show unified diff between source instruction and rendered project file.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "sourcePath": {"type": "string"},
            },
            "required": ["sourcePath"],
        },
    },
    {
        "name": "orkestra_init_project",
        "description": "Run 'orkestra init' in current project directory.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "template": {"type": "string"},
                "agents": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["template", "agents"],
        },
    },
    {
        "name": "orkestra_render_project",
        "description": "Run 'orkestra render' in current project directory.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def mcp_ok(msg_id: int | str | None, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}


def mcp_err(msg_id: int | str | None, code: int, message: str) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": msg_id,
        "error": {
            "code": code,
            "message": message,
        },
    }


def read_message() -> dict | None:
    headers: dict[str, str] = {}
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        if line in (b"\r\n", b"\n"):
            break
        text = line.decode("utf-8").strip()
        if ":" in text:
            key, value = text.split(":", 1)
            headers[key.lower().strip()] = value.strip()

    length = int(headers.get("content-length", "0"))
    if length <= 0:
        return None

    body = sys.stdin.buffer.read(length)
    if not body:
        return None
    return json.loads(body.decode("utf-8"))


def write_message(payload: dict) -> None:
    raw = json.dumps(payload, ensure_ascii=True).encode("utf-8")
    sys.stdout.buffer.write(f"Content-Length: {len(raw)}\r\n\r\n".encode("ascii"))
    sys.stdout.buffer.write(raw)
    sys.stdout.buffer.flush()


def handle_request(req: dict) -> dict | None:
    method = req.get("method")
    msg_id = req.get("id")

    if method == "initialize":
        return mcp_ok(
            msg_id,
            {
                "protocolVersion": "2024-11-05",
                "serverInfo": {"name": "orkestra-mcp", "version": "0.1.0"},
                "capabilities": {"tools": {}},
            },
        )

    if method == "notifications/initialized":
        return None

    if method == "tools/list":
        return mcp_ok(msg_id, {"tools": TOOL_SCHEMAS})

    if method == "tools/call":
        params = req.get("params", {})
        name = params.get("name")
        arguments = params.get("arguments", {})

        if name not in TOOLS:
            return mcp_err(msg_id, -32601, f"Unknown tool: {name}")

        try:
            result = TOOLS[name](arguments if isinstance(arguments, dict) else {})
        except Exception as exc:  # noqa: BLE001
            return mcp_err(msg_id, -32000, f"Tool error: {exc}")

        return mcp_ok(msg_id, {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=True, indent=2)}]})

    return mcp_err(msg_id, -32601, f"Method not found: {method}")


def main() -> None:
    while True:
        req = read_message()
        if req is None:
            break
        resp = handle_request(req)
        if resp is not None and req.get("id") is not None:
            write_message(resp)


if __name__ == "__main__":
    main()
