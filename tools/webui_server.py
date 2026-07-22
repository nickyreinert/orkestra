#!/usr/bin/env python3
from __future__ import annotations

import json
import errno
import os
import re
import shutil
import subprocess
import difflib
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False

ROOT = Path(__file__).resolve().parent.parent
WEBUI_DIR = ROOT / "webui"
TEMPLATES_DIR = ROOT / "content" / "templates"
ADAPTERS_DIR = ROOT / "adapters"
PROJECT_DIR = Path.cwd()
HOME_DIR = Path.home()
DEFAULT_GLOBAL_SETTINGS_PATH = ROOT / "content" / "settings" / "global-locations.yaml"
USER_GLOBAL_SETTINGS_PATH = HOME_DIR / ".config" / "orkestra" / "settings.yaml"
DEFAULT_AGENTS_CONFIG_PATH = ROOT / "content" / "settings" / "agents-config.yaml"
USER_AGENTS_CONFIG_PATH = HOME_DIR / ".config" / "orkestra" / "agents-config.yaml"
HOST = os.environ.get("ORKESTRA_WEBUI_HOST", "127.0.0.1")
PORT = int(os.environ.get("ORKESTRA_WEBUI_PORT", "8732"))
PORT_SCAN_LIMIT = int(os.environ.get("ORKESTRA_WEBUI_PORT_SCAN_LIMIT", "50"))
AUTO_RELOAD_SERVER = os.environ.get("ORKESTRA_WEBUI_AUTO_RELOAD_SERVER", "1") == "1"

WEBUI_WATCH_FILES = [
    WEBUI_DIR / "index.html",
    WEBUI_DIR / "app.js",
    WEBUI_DIR / "styles.css",
    ROOT / "orkestra.png",
]
SERVER_WATCH_FILES = [Path(__file__).resolve()]


def watch_signature(paths: list[Path]) -> str:
    chunks: list[str] = []
    for p in paths:
        if p.exists() and p.is_file():
            chunks.append(f"{p}:{p.stat().st_mtime_ns}")
        else:
            chunks.append(f"{p}:missing")
    return "|".join(chunks)


SERVER_SIGNATURE = watch_signature(SERVER_WATCH_FILES)
ENTITY_CATEGORY_TREE = [
    ("topology", "TOPOLOGY", []),
    ("standards", "STANDARDS", [
        ("standards.code", "code"),
        ("standards.design", "design"),
        ("standards.persona", "persona"),
    ]),
    ("workflow", "WORKFLOW", []),
    ("tooling", "TOOLING", []),
    ("meta", "META", []),
]
DOMAIN_META = {
    "guidance": {"label": "Guidance", "indicator": "◇"},
    "enforcement": {"label": "Enforcement", "indicator": "◈"},
    "automation": {"label": "Automation", "indicator": "▶"},
}
CUSTOM_CATEGORY_REGISTRY = ROOT / "content" / "source" / ".orkestra-plugin-categories.json"
PLUGIN_TYPES = {"markdown", "yaml", "shell"}


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug[:64]


def custom_categories() -> list[dict]:
    if not CUSTOM_CATEGORY_REGISTRY.exists():
        return []
    try:
        data = json.loads(CUSTOM_CATEGORY_REGISTRY.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [item for item in data if isinstance(item, dict) and item.get("id") and item.get("main")]


def save_custom_categories(categories: list[dict]) -> None:
    CUSTOM_CATEGORY_REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    CUSTOM_CATEGORY_REGISTRY.write_text(json.dumps(categories, indent=2) + "\n", encoding="utf-8")


def known_main_categories() -> set[str]:
    return {item[0] for item in ENTITY_CATEGORY_TREE}


def yaml_inline_list(values: object) -> str:
    if not isinstance(values, list):
        values = []
    return "[" + ", ".join(str(item).strip() for item in values if str(item).strip()) + "]"


def maybe_restart_on_server_change() -> None:
    global SERVER_SIGNATURE
    if not AUTO_RELOAD_SERVER:
        return

    current = watch_signature(SERVER_WATCH_FILES)
    if current == SERVER_SIGNATURE:
        return

    SERVER_SIGNATURE = current
    print("Orkestra WebUI: server source changed, restarting...")
    os.execv(sys.executable, [sys.executable, *sys.argv])


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


def bucket_instruction(name: str) -> str:
    lname = name.lower()
    if lname.startswith("planning"):
        return "Planning"
    if lname.startswith("coding"):
        return "Coding"
    if lname.startswith("review"):
        return "Review"
    return "Other"


def collect_templates(base: Path) -> list[dict]:
    items: list[dict] = []
    if not base.exists():
        return items
    for d in sorted(base.iterdir()):
        if not d.is_dir():
            continue
        categories: dict[str, list[str]] = {}
        instructions_dir = d / "instructions"
        if instructions_dir.exists():
            for p in sorted(instructions_dir.glob("*.md")):
                if not p.is_file():
                    continue
                cat = bucket_instruction(p.name)
                categories.setdefault(cat, []).append(p.name)
        items.append(
            {
                "name": d.name,
                "templateYaml": str((d / "template.yaml").relative_to(ROOT)),
                "instructionsByCategory": categories,
            }
        )
    return items


def collect_rendered_template() -> dict:
    template_dir = PROJECT_DIR / ".orkestra" / "instructions" / "template"
    categories: dict[str, list[str]] = {}
    if template_dir.exists():
        for p in sorted(template_dir.glob("*.md")):
            if not p.is_file():
                continue
            cat = bucket_instruction(p.name)
            categories.setdefault(cat, []).append(p.name)
    return {
        "name": "current-project",
        "instructionsByCategory": categories,
    }


def collect_global_files(base: Path) -> list[str]:
    if not base.exists():
        return []
    return sorted(p.name for p in base.glob("*.md") if p.is_file())


def collect_extras() -> list[dict]:
    roots = [
        (ROOT / "content" / "source", "entities"),
        (ROOT / "content" / "skills", "skills"),
        (ROOT / "content" / "mcp", "mcp"),
        (ROOT / "content" / "workflows", "workflows"),
    ]
    out: list[dict] = []
    allowed_ext = {".md", ".txt", ".json", ".yaml", ".yml", ".sh"}

    for base, label in roots:
        if not base.exists() or not base.is_dir():
            continue
        for p in sorted(base.rglob("*")):
            if not p.is_file():
                continue
            if p.suffix.lower() not in allowed_ext:
                continue
            out.append(
                {
                    "category": label,
                    "path": str(p.relative_to(ROOT)),
                }
            )
    return out


def normalize_entity_category(category: str) -> str:
    aliases = {
        "style": "standards.code",
        "styles": "standards.code",
        "topologies": "topology",
        "skill": "standards.design",
        "skills": "standards.design",
        "workflows": "workflow",
        "hook": "workflow",
        "hooks": "workflow",
        "agent-style": "standards.persona",
        "agent-styles": "standards.persona",
        "general": "standards.code",
        "agent.profiles": "standards.persona",
        "agent.tooling": "tooling",
        "projects.blueprints": "topology",
        "coding.standards": "standards.code",
        "coding.architecture": "standards.design",
        "coding.domain": "standards.design",
        "enforcement.policies": "standards.code",
        "enforcement.hooks": "workflow",
        "automation.scripts": "workflow",
        "automation.workflows": "workflow",
        "workflow.automation": "workflow",
    }
    return aliases.get(category, category)


def parse_entity_file(path: Path) -> dict | None:
    if not path.exists() or not path.is_file():
        return None

    raw = path.read_text(encoding="utf-8")
    data: dict = {}
    if HAS_YAML:
        try:
            loaded = yaml.safe_load(raw)
            if isinstance(loaded, dict):
                data = loaded
        except Exception as exc:
            print(f"Warning: failed to parse entity {path}: {exc}", file=sys.stderr)

    if not data:
        block_key = None
        block_lines: list[str] = []
        nested_key = ""
        for line in raw.splitlines():
            if block_key:
                if line and not line.startswith(" "):
                    if block_key == "description":
                        data[block_key] = " ".join(part.strip() for part in block_lines if part.strip())
                    else:
                        data[block_key] = "\n".join(block_lines).rstrip() + "\n"
                    block_key = None
                    block_lines = []
                else:
                    block_lines.append(line[2:] if line.startswith("  ") else line)
                    continue
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            key = key.strip()
            value = value.strip()
            if not line.startswith(" ") and value == "":
                data.setdefault(key, {})
                nested_key = key
            elif line.startswith("  ") and nested_key:
                child_key = key
                if value.startswith("[") and value.endswith("]"):
                    data.setdefault(nested_key, {})[child_key] = [
                        item.strip().strip("\"'") for item in value[1:-1].split(",") if item.strip()
                    ]
                else:
                    data.setdefault(nested_key, {})[child_key] = value.strip("\"'")
            elif value in {"|", ">"}:
                block_key = key
                block_lines = []
                nested_key = ""
            elif value.startswith("[") and value.endswith("]"):
                data[key] = [item.strip().strip("\"'") for item in value[1:-1].split(",") if item.strip()]
                nested_key = ""
            else:
                data[key] = value.strip("\"'")
                nested_key = ""
        if block_key:
            if block_key == "description":
                data[block_key] = " ".join(part.strip() for part in block_lines if part.strip())
            else:
                data[block_key] = "\n".join(block_lines).rstrip() + "\n"

    entity_id = str(data.get("id") or "").strip()
    if not entity_id:
        return None

    plugin_dir = path.parent if path.name == "manifest.yaml" else None
    instruction_file = plugin_dir / "instructions.md" if plugin_dir else None
    category = normalize_entity_category(str(data.get("category") or entity_id.rsplit(".", 1)[0]))
    rel_path = path.relative_to(ROOT).as_posix()
    content = instruction_file.read_text(encoding="utf-8") if instruction_file and instruction_file.is_file() else str(data.get("content") or "")
    compatibility_raw = data.get("compatibility")
    compatibility = compatibility_raw if isinstance(compatibility_raw, dict) else {}

    def list_value(value) -> list[str]:
        if isinstance(value, list):
            return [str(v) for v in value]
        if isinstance(value, str):
            return [v.strip() for v in value.strip("[]").split(",") if v.strip()]
        return []

    editable_files = [
        {
            "path": rel_path,
            "label": path.name,
            "role": "manifest" if path.name == "manifest.yaml" else "legacy",
            "type": "yaml",
            "content": raw,
        }
    ]
    if instruction_file and instruction_file.is_file():
        editable_files.append(
            {
                "path": instruction_file.relative_to(ROOT).as_posix(),
                "label": "instructions.md",
                "role": "instructions",
                "type": "markdown",
                "content": instruction_file.read_text(encoding="utf-8"),
            }
        )
    plugin_scripts = sorted((plugin_dir / "bin").glob("*.sh")) if plugin_dir and (plugin_dir / "bin").is_dir() else []
    plugin_configs = []
    if plugin_dir:
        plugin_configs.extend(item.name for item in (plugin_dir / "config.json", plugin_dir / "config.yaml", plugin_dir / "config.yml") if item.is_file())
        if (plugin_dir / "config").is_dir():
            plugin_configs.extend(item.relative_to(plugin_dir).as_posix() for item in sorted((plugin_dir / "config").rglob("*")) if item.is_file())
        for rel_config in plugin_configs:
            config_path = plugin_dir / rel_config
            editable_files.append(
                {
                    "path": config_path.relative_to(ROOT).as_posix(),
                    "label": rel_config,
                    "role": "config",
                    "type": "json" if config_path.suffix == ".json" else "yaml",
                    "content": config_path.read_text(encoding="utf-8"),
                }
            )
        docs_dir = plugin_dir / "docs"
        if docs_dir.is_dir():
            for doc_path in sorted(docs_dir.rglob("*.md")):
                editable_files.append(
                    {
                        "path": doc_path.relative_to(ROOT).as_posix(),
                        "label": doc_path.relative_to(plugin_dir).as_posix(),
                        "role": "document",
                        "type": "markdown",
                        "content": doc_path.read_text(encoding="utf-8"),
                    }
                )
    elif data.get("entrypoint"):
        sibling_script = path.parent / str(data.get("entrypoint"))
        if sibling_script.is_file():
            plugin_scripts.append(sibling_script)
    for script_path in plugin_scripts:
        editable_files.append(
            {
                "path": script_path.relative_to(ROOT).as_posix(),
                "label": script_path.relative_to(plugin_dir).as_posix() if plugin_dir else script_path.name,
                "role": "script",
                "type": "shell",
                "content": script_path.read_text(encoding="utf-8"),
            }
        )
    agents = list_value(compatibility.get("agents")) if compatibility else list_value(compatibility_raw)
    plugin_type = str(data.get("type") or ("shell" if plugin_scripts else "markdown"))
    return {
        "id": entity_id,
        "name": str(data.get("name") or entity_id),
        "category": category,
        "categoryMain": category.split(".", 1)[0] if "." in category else category,
        "categorySub": category.split(".", 1)[1] if "." in category else "",
        "domain": str(data.get("domain") or "guidance"),
        "type": plugin_type,
        "executable": bool(plugin_scripts or data.get("executable") is True or str(data.get("executable")).lower() == "true"),
        "runtime": str(data.get("runtime") or ""),
        "entrypoint": str(data.get("entrypoint") or (plugin_scripts[0].name if plugin_scripts else "")),
        "version": str(data.get("version") or ""),
        "author": str(data.get("author") or ""),
        "description": str(data.get("description") or "").strip(),
        "descriptionShort": str(data.get("description_short") or data.get("description") or "").strip(),
        "agents": agents,
        "scopes": list_value(compatibility.get("scopes")),
        "os": list_value(compatibility.get("os")),
        "requiresTools": list_value(data.get("requires_tools")),
        "conflictsWith": list_value(data.get("conflicts_with")),
        "requires": list_value(data.get("requires")),
        "tags": list_value(data.get("tags")),
        "content": content,
        "path": rel_path,
        "pluginFormat": "directory" if plugin_dir else "legacy-file",
        "configAssets": plugin_configs,
        "scriptAssets": [item.name for item in plugin_scripts],
        "editableFiles": editable_files,
    }


def find_entity_source_file(entity_id: str) -> Path | None:
    source_dir = ROOT / "content" / "source"
    if not source_dir.exists():
        return None
    for path in sorted(source_dir.rglob("*.y*ml")):
        entity = parse_entity_file(path)
        if entity and entity.get("id") == entity_id:
            return path
    return None


def replace_yaml_block(raw: str, key: str, value: str) -> str:
    lines = raw.splitlines()
    start = None
    for idx, line in enumerate(lines):
        if re.fullmatch(rf"{re.escape(key)}\s*:\s*[|>]?.*", line):
            start = idx
            break

    block = [f"{key}: |"]
    block.extend(f"  {line}" if line else "" for line in value.splitlines())

    if start is None:
        prefix = raw.rstrip("\n")
        suffix = "\n" if prefix else ""
        return f"{prefix}{suffix}{chr(10).join(block)}\n"

    end = start + 1
    while end < len(lines):
        line = lines[end]
        if line and not line.startswith((" ", "\t")):
            break
        end += 1

    updated = lines[:start] + block + lines[end:]
    return "\n".join(updated).rstrip("\n") + "\n"


def replace_yaml_value(raw: str, key: str, value: str) -> str:
    lines = raw.splitlines()
    line = f"{key}: {value}"
    for index, existing in enumerate(lines):
        if re.fullmatch(rf"{re.escape(key)}\s*:\s*.*", existing):
            lines[index] = line
            return "\n".join(lines).rstrip("\n") + "\n"
    return raw.rstrip("\n") + "\n" + line + "\n"


def replace_yaml_compatibility(raw: str, agents: list[str], scopes: list[str], os_values: list[str]) -> str:
    lines = raw.splitlines()
    start = next((index for index, line in enumerate(lines) if re.fullmatch(r"compatibility\s*:\s*", line)), None)
    block = ["compatibility:", f"  agents: {yaml_inline_list(agents)}", f"  scopes: {yaml_inline_list(scopes)}"]
    if os_values:
        block.append(f"  os: {yaml_inline_list(os_values)}")
    if start is None:
        return raw.rstrip("\n") + "\n" + "\n".join(block) + "\n"
    end = start + 1
    while end < len(lines) and (not lines[end] or lines[end].startswith((" ", "\t"))):
        end += 1
    return "\n".join(lines[:start] + block + lines[end:]).rstrip("\n") + "\n"


def write_plugin_metadata(source_file: Path, data: dict) -> None:
    raw = source_file.read_text(encoding="utf-8")
    scalar_keys = ("name", "version", "author", "category", "domain", "type", "runtime", "entrypoint")
    for key in scalar_keys:
        if key in data:
            raw = replace_yaml_value(raw, key, str(data[key]).strip())
    if "executable" in data:
        raw = replace_yaml_value(raw, "executable", "true" if data["executable"] else "false")
    for key, payload_key in (("tags", "tags"), ("conflicts_with", "conflictsWith"), ("requires", "requires"), ("requires_tools", "requiresTools")):
        if payload_key in data:
            raw = replace_yaml_value(raw, key, yaml_inline_list(data[payload_key]))
    if any(key in data for key in ("agents", "scopes", "os")):
        raw = replace_yaml_compatibility(raw, data.get("agents", []), data.get("scopes", []), data.get("os", []))
    raw = replace_yaml_block(raw, "description", str(data.get("description", "")))
    if source_file.name == "manifest.yaml":
        (source_file.parent / "instructions.md").write_text(str(data.get("content", "")), encoding="utf-8")
    else:
        raw = replace_yaml_block(raw, "content", str(data.get("content", "")))
    source_file.write_text(raw, encoding="utf-8")


def write_plugin_editable_file(entity_id: str, rel_path: str, content: str) -> None:
    source_file = find_entity_source_file(entity_id)
    if source_file is None:
        raise ValueError("Plugin not found")
    entity = parse_entity_file(source_file)
    if entity is None:
        raise ValueError("Plugin source could not be parsed")
    allowed = {str(item.get("path")) for item in entity.get("editableFiles", [])}
    if rel_path not in allowed:
        raise ValueError("Editable plugin file not found")
    target = (ROOT / rel_path).resolve()
    source_root = (ROOT / "content" / "source").resolve()
    if source_root not in target.parents:
        raise ValueError("Editable plugin path must stay below content/source")
    target.write_text(content, encoding="utf-8")
    if target.name.endswith(".sh"):
        target.chmod(0o755)


def add_plugin_asset(entity_id: str, name: str, asset_type: str) -> dict:
    source_file = find_entity_source_file(entity_id)
    if source_file is None or source_file.name != "manifest.yaml":
        raise ValueError("Additional files require a directory-format plugin")
    slug = slugify(name)
    if not slug or asset_type not in {"shell", "yaml", "markdown"}:
        raise ValueError("Choose a valid file name and type")
    plugin_dir = source_file.parent
    if asset_type == "shell":
        target = plugin_dir / "bin" / f"{slug}.sh"
        content = "#!/usr/bin/env bash\nset -euo pipefail\n\n# Add deterministic automation here.\n"
    elif asset_type == "yaml":
        target = plugin_dir / "config" / f"{slug}.yaml"
        content = "# Plugin configuration\nkey: value\n"
    else:
        target = plugin_dir / "docs" / f"{slug}.md"
        content = f"# {name.strip()}\n\nDescribe this plugin asset.\n"
    if target.exists():
        raise ValueError("A file with this name already exists")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    if asset_type == "shell":
        target.chmod(0o755)
    return parse_entity_file(source_file) or {}


def remove_plugin_asset(entity_id: str, rel_path: str) -> None:
    source_file = find_entity_source_file(entity_id)
    if source_file is None or source_file.name != "manifest.yaml":
        raise ValueError("Plugin file not found")
    entity = parse_entity_file(source_file)
    if entity is None:
        raise ValueError("Plugin source could not be parsed")
    removable = {
        str(item.get("path")) for item in entity.get("editableFiles", [])
        if item.get("role") in {"script", "config", "document"}
    }
    if rel_path not in removable:
        raise ValueError("This plugin file cannot be removed")
    target = (ROOT / rel_path).resolve()
    plugin_root = source_file.parent.resolve()
    if plugin_root not in target.parents:
        raise ValueError("Plugin file must stay inside its plugin directory")
    target.unlink()
    for parent in (target.parent, target.parent.parent):
        if parent != plugin_root and parent.exists() and not any(parent.iterdir()):
            parent.rmdir()


def remove_plugin_source(entity_id: str) -> None:
    source_file = find_entity_source_file(entity_id)
    if source_file is None:
        raise ValueError("Plugin not found")
    if source_file.name == "manifest.yaml":
        shutil.rmtree(source_file.parent)
        return
    entry = parse_entity_file(source_file)
    sibling = source_file.parent / str(entry.get("entrypoint") or "") if entry else None
    source_file.unlink()
    if sibling and sibling.is_file():
        sibling.unlink()


def create_plugin_source(category: str, name: str, plugin_type: str) -> dict:
    main, _, sub = category.partition(".")
    if main not in known_main_categories() or (sub and not safe_name(sub)):
        raise ValueError("Invalid plugin category")
    if plugin_type not in PLUGIN_TYPES:
        raise ValueError("Plugin type must be markdown, yaml, or shell")
    slug = slugify(name)
    if not slug:
        raise ValueError("Plugin name must contain letters or numbers")
    entity_id = f"{category}.{slug}"
    if find_entity_source_file(entity_id):
        raise ValueError("A plugin with this id already exists")
    category_dir = ROOT / "content" / "source" / main
    if sub:
        category_dir /= sub
    plugin_dir = category_dir / slug
    source_file = plugin_dir / "manifest.yaml"
    plugin_dir.mkdir(parents=True, exist_ok=True)
    executable = plugin_type == "shell"
    runtime = "bash" if executable else ""
    entrypoint = f"{slug}.sh" if executable else ""
    content = "#!/usr/bin/env bash\nset -euo pipefail\n\n# Add deterministic automation here.\n" if executable else (
        "key: value\n" if plugin_type == "yaml" else "# New Plugin\n\nDescribe the instructions this plugin gives to coding agents.\n"
    )
    raw = "\n".join([
        f"id: {entity_id}",
        f"name: {name.strip()}",
        f"category: {category}",
        "domain: automation" if executable else "domain: guidance",
        "version: 0.1.0",
        "author: local",
        "description: |",
        "  Add a concise description for this plugin.",
        f"type: {plugin_type}",
        f"executable: {'true' if executable else 'false'}",
        *( [f"runtime: {runtime}", f"entrypoint: {entrypoint}"] if executable else [] ),
        "compatibility:",
        "  agents: [claude, codex, copilot, cursor, cline, aider]",
        "  scopes: [global, project]",
        "conflicts_with: []",
        "requires: []",
        "requires_tools: []",
        "tags: [custom]",
        "",
    ])
    source_file.write_text(raw, encoding="utf-8")
    (plugin_dir / "instructions.md").write_text(content, encoding="utf-8")
    if executable:
        script_dir = plugin_dir / "bin"
        script_dir.mkdir(exist_ok=True)
        script_path = script_dir / entrypoint
        script_path.write_text(content, encoding="utf-8")
        script_path.chmod(0o755)
    return parse_entity_file(source_file) or {}


def entity_installed_path(scope: str, entity_id: str) -> Path:
    rel = Path(*entity_id.split(".")).with_suffix(".md")
    if scope == "global":
        if sys.platform == "darwin":
            base = HOME_DIR / "Library" / "Application Support" / "orkestra"
        elif os.name == "nt":
            base = Path(os.environ.get("APPDATA", str(HOME_DIR / "AppData" / "Roaming"))) / "orkestra"
        else:
            base = HOME_DIR / ".config" / "orkestra"
    else:
        base = PROJECT_DIR / ".orkestra"
    return base / "entities" / rel


def entity_scope_dir(scope: str) -> Path:
    if scope == "global":
        if sys.platform == "darwin":
            return HOME_DIR / "Library" / "Application Support" / "orkestra"
        if os.name == "nt":
            return Path(os.environ.get("APPDATA", str(HOME_DIR / "AppData" / "Roaming"))) / "orkestra"
        return HOME_DIR / ".config" / "orkestra"
    return PROJECT_DIR / ".orkestra"


def rendered_plugin_content(entity: dict, source_file: Path) -> str:
    source_rel = source_file.relative_to(ROOT).as_posix()
    content = str(entity.get("content") or "").rstrip()
    lines = [f"<!-- orkestra:entity id={entity['id']} source={source_rel} -->", content]
    if entity.get("type") == "shell" and entity.get("entrypoint"):
        lines.extend(["", f"Tool: `bin/{entity['entrypoint']}`"])
    return "\n".join(lines).rstrip() + "\n"


def strip_rendered_entity_header(content: str) -> str:
    lines = content.splitlines()
    if lines and lines[0].startswith("<!-- orkestra:entity "):
        lines = lines[1:]
    return "\n".join(lines).strip() + "\n"


def installed_file_target(scope: str, entity: dict, source_file: Path, editable_file: dict) -> Path | None:
    role = str(editable_file.get("role") or "")
    rel_path = str(editable_file.get("path") or "")
    label = str(editable_file.get("label") or "")
    if role in {"instructions", "legacy"}:
        return entity_installed_path(scope, entity["id"])
    if role == "script":
        return entity_scope_dir(scope) / "bin" / Path(label or rel_path).name
    if role == "config" and source_file.name == "manifest.yaml":
        plugin_dir = source_file.parent
        try:
            asset_rel = (ROOT / rel_path).resolve().relative_to(plugin_dir.resolve())
        except ValueError:
            return None
        return entity_scope_dir(scope) / "config" / plugin_dir.name / asset_rel
    return None


def expected_installed_file_content(entity: dict, source_file: Path, editable_file: dict) -> str:
    role = str(editable_file.get("role") or "")
    if role in {"instructions", "legacy"}:
        return rendered_plugin_content(entity, source_file)
    return str(editable_file.get("content") or "")


def editable_file_scope_status(scope: str, entity: dict, source_file: Path, editable_file: dict) -> dict:
    target = installed_file_target(scope, entity, source_file, editable_file)
    if target is None:
        return {"installable": False, "installed": False, "modified": False, "path": ""}
    installed = target.exists()
    modified = False
    if installed:
        try:
            modified = target.read_text(encoding="utf-8") != expected_installed_file_content(entity, source_file, editable_file)
        except OSError:
            modified = True
    return {
        "installable": True,
        "installed": installed,
        "modified": modified,
        "path": str(target),
    }


def scope_plugin_is_modified(scope: str, entity: dict, source_file: Path) -> bool:
    destination = entity_installed_path(scope, entity["id"])
    if not destination.exists():
        return False
    try:
        if destination.read_text(encoding="utf-8") != rendered_plugin_content(entity, source_file):
            return True
    except OSError:
        return True

    source_plugin_dir = source_file.parent if source_file.name == "manifest.yaml" else None
    if source_plugin_dir:
        scripts_dir = source_plugin_dir / "bin"
        scripts = sorted(scripts_dir.glob("*.sh")) if scripts_dir.is_dir() else []
        for script_source in scripts:
            deployed = entity_scope_dir(scope) / "bin" / script_source.name
            if not deployed.exists() or deployed.read_text(encoding="utf-8") != script_source.read_text(encoding="utf-8"):
                return True
        config_sources = [source_plugin_dir / name for name in ("config.json", "config.yaml", "config.yml")]
        configs_dir = source_plugin_dir / "config"
        if configs_dir.is_dir():
            config_sources.extend(item for item in sorted(configs_dir.rglob("*")) if item.is_file())
        for config_source in config_sources:
            if not config_source.is_file():
                continue
            rel_config = config_source.relative_to(source_plugin_dir)
            deployed = entity_scope_dir(scope) / "config" / source_plugin_dir.name / rel_config
            if not deployed.exists() or deployed.read_text(encoding="utf-8") != config_source.read_text(encoding="utf-8"):
                return True
    elif entity.get("type") == "shell" and entity.get("entrypoint"):
        script_source = source_file.parent / str(entity["entrypoint"])
        deployed = entity_scope_dir(scope) / "bin" / str(entity["entrypoint"])
        expected = script_source.read_text(encoding="utf-8") if script_source.is_file() else str(entity.get("content") or "")
        if not deployed.exists() or deployed.read_text(encoding="utf-8") != expected:
            return True
    return False


def sync_editable_file_source_to_scope(scope: str, entity: dict, source_file: Path, editable_file: dict) -> None:
    role = str(editable_file.get("role") or "")
    rel_path = str(editable_file.get("path") or "")
    content = str(editable_file.get("content") or "")
    if role in {"instructions", "legacy"}:
        write_installed_plugin(scope, entity, source_file)
        return
    if not entity_installed_path(scope, entity["id"]).exists():
        write_installed_plugin(scope, entity, source_file)
    write_installed_plugin_asset(scope, entity, source_file, rel_path, content)


def sync_editable_file_scope_to_source(scope: str, entity: dict, source_file: Path, editable_file: dict) -> None:
    target = installed_file_target(scope, entity, source_file, editable_file)
    if target is None or not target.exists():
        raise ValueError("Installed file does not exist in selected scope")
    role = str(editable_file.get("role") or "")
    content = target.read_text(encoding="utf-8")
    if role in {"instructions", "legacy"}:
        content = strip_rendered_entity_header(content)
    rel_path = str(editable_file.get("path") or "")
    if role == "legacy":
        raw = source_file.read_text(encoding="utf-8")
        source_file.write_text(replace_yaml_block(raw, "content", content.rstrip("\n")), encoding="utf-8")
        return
    write_plugin_editable_file(str(entity["id"]), rel_path, content)


def write_installed_plugin(scope: str, entity: dict, source_file: Path) -> None:
    destination = entity_installed_path(scope, entity["id"])
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(rendered_plugin_content(entity, source_file), encoding="utf-8")
    source_plugin_dir = source_file.parent if source_file.name == "manifest.yaml" else None
    if source_plugin_dir:
        bin_dir = source_plugin_dir / "bin"
        if bin_dir.is_dir():
            for script_source in sorted(bin_dir.glob("*.sh")):
                script_path = entity_scope_dir(scope) / "bin" / script_source.name
                script_path.parent.mkdir(parents=True, exist_ok=True)
                script_path.write_text(script_source.read_text(encoding="utf-8"), encoding="utf-8")
                script_path.chmod(0o755)
        config_targets = [source_plugin_dir / name for name in ("config.json", "config.yaml", "config.yml")]
        if (source_plugin_dir / "config").is_dir():
            config_targets.extend(item for item in sorted((source_plugin_dir / "config").rglob("*")) if item.is_file())
        for config_source in config_targets:
            if not config_source.is_file():
                continue
            rel_config = config_source.relative_to(source_plugin_dir).as_posix()
            config_path = entity_scope_dir(scope) / "config" / source_plugin_dir.name / rel_config
            config_path.parent.mkdir(parents=True, exist_ok=True)
            config_path.write_text(config_source.read_text(encoding="utf-8"), encoding="utf-8")
    elif entity.get("type") == "shell" and entity.get("entrypoint"):
        script_source = source_file.parent / str(entity["entrypoint"])
        script_content = script_source.read_text(encoding="utf-8") if script_source.is_file() else str(entity.get("content") or "")
        script_path = entity_scope_dir(scope) / "bin" / str(entity["entrypoint"])
        script_path.parent.mkdir(parents=True, exist_ok=True)
        script_path.write_text(script_content, encoding="utf-8")
        script_path.chmod(0o755)


def write_installed_plugin_asset(scope: str, entity: dict, source_file: Path, rel_path: str, content: str) -> None:
    target_rel = Path(rel_path)
    if source_file.name == "manifest.yaml":
        plugin_dir = source_file.parent
        try:
            asset_rel = (ROOT / rel_path).resolve().relative_to(plugin_dir.resolve())
        except ValueError:
            return
        if asset_rel.parts and asset_rel.parts[0] == "bin":
            destination = entity_scope_dir(scope) / "bin" / asset_rel.name
        elif asset_rel.parts and (asset_rel.parts[0].startswith("config.") or asset_rel.parts[0] == "config"):
            destination = entity_scope_dir(scope) / "config" / plugin_dir.name / asset_rel
        else:
            return
    elif target_rel.name == str(entity.get("entrypoint") or ""):
        destination = entity_scope_dir(scope) / "bin" / target_rel.name
    else:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(content, encoding="utf-8")
    if destination.name.endswith(".sh"):
        destination.chmod(0o755)


def collect_entities_index() -> dict:
    source_dir = ROOT / "content" / "source"
    entities: list[dict] = []
    scope_changes = {"project": False, "global": False}
    if source_dir.exists():
        for path in sorted(source_dir.rglob("*.y*ml")):
            entity = parse_entity_file(path)
            if not entity:
                continue
            installed = {
                "project": entity_installed_path("project", entity["id"]).exists(),
                "global": entity_installed_path("global", entity["id"]).exists(),
            }
            project_install_path = entity_installed_path("project", entity["id"])
            install_paths = {
                "project": str(project_install_path.relative_to(PROJECT_DIR)),
                "global": str(entity_installed_path("global", entity["id"])),
            }
            install_roots = {
                "project": str(entity_scope_dir("project").relative_to(PROJECT_DIR)),
                "global": str(entity_scope_dir("global")),
            }
            entity["installed"] = installed
            entity["modified"] = {
                scope: scope_plugin_is_modified(scope, entity, path)
                for scope, is_installed in installed.items()
                if is_installed
            }
            for editable_file in entity.get("editableFiles", []):
                editable_file["scopeStatus"] = {
                    scope: editable_file_scope_status(scope, entity, path, editable_file)
                    for scope in ("global", "project")
                }
            for scope in scope_changes:
                scope_changes[scope] = scope_changes[scope] or bool(entity["modified"].get(scope))
            entity["installPaths"] = install_paths
            entity["installRoots"] = install_roots
            entities.append(entity)

    categories: dict[str, list[dict]] = {}
    domain_counts = {domain: 0 for domain in DOMAIN_META}
    for entity in entities:
        categories.setdefault(entity["category"], []).append(entity)
        domain_counts.setdefault(entity["domain"], 0)
        domain_counts[entity["domain"]] += 1

    category_tree = []
    known_subcategories = set()
    for main_id, main_label, subcategories in ENTITY_CATEGORY_TREE:
        sub_out = []
        for sub_id, sub_label in subcategories:
            known_subcategories.add(sub_id)
            sub_out.append({"id": sub_id, "label": sub_label, "entities": categories.get(sub_id, [])})
        category_tree.append({
            "id": main_id,
            "label": main_label,
            "entities": categories.get(main_id, []),
            "subcategories": sub_out,
        })

    for category in custom_categories():
        category_id = str(category["id"])
        main_id = str(category["main"])
        if main_id not in known_main_categories() or category_id in known_subcategories:
            continue
        target = next((item for item in category_tree if item["id"] == main_id), None)
        if target is None:
            continue
        target["subcategories"].append(
            {"id": category_id, "label": str(category.get("label") or category_id.split(".", 1)[-1]), "entities": categories.get(category_id, [])}
        )
        known_subcategories.add(category_id)

    for cat in sorted(set(categories) - known_subcategories):
        main = cat.split(".", 1)[0]
        label = cat.split(".", 1)[1] if "." in cat else cat
        target = next((item for item in category_tree if item["id"] == main), None)
        if target is None:
            target = {"id": main, "label": main.upper(), "entities": categories.get(main, []), "subcategories": []}
            category_tree.append(target)
        if cat == main:
            target["entities"] = categories[cat]
        else:
            target["subcategories"].append({"id": cat, "label": label, "entities": categories[cat]})

    ordered_categories = [
        {"id": main["id"], "label": main["label"], "entities": main["entities"]}
        for main in category_tree
    ] + [
        {"id": sub["id"], "label": sub["label"], "entities": sub["entities"]}
        for main in category_tree
        for sub in main["subcategories"]
    ]

    return {
        "entities": entities,
        "categories": ordered_categories,
        "categoryTree": category_tree,
        "domains": [
            {
                "id": domain,
                "label": meta["label"],
                "indicator": meta["indicator"],
                "count": domain_counts.get(domain, 0),
            }
            for domain, meta in DOMAIN_META.items()
        ],
        "scopeChanges": scope_changes,
        "agents": list_agents(),
        "source": {
            "path": str(source_dir),
        },
        "scopes": {
            "global": {"root": str(entity_scope_dir("global"))},
            "project": {"root": str(entity_scope_dir("project"))},
        },
        "project": {
            "path": str(PROJECT_DIR),
            "initialized": (PROJECT_DIR / ".orkestra").is_dir(),
        },
    }


def collect_project_items_with_status() -> dict:
    """
    Collect project-rendered items with git status information.
    Returns items categorized by type and git status.
    """
    items: dict = {
        "instructions": {"tracked": [], "gitignored": []},
        "skills": {"tracked": [], "gitignored": []},
        "mcp": {"tracked": [], "gitignored": []},
        "workflows": {"tracked": [], "gitignored": []},
        "plugins": {"tracked": [], "gitignored": []},
    }
    
    if not (PROJECT_DIR / ".orkestra").is_dir():
        return items
    
    # Collect instructions
    instruction_bases = [
        (PROJECT_DIR / ".orkestra" / "instructions" / "global", "global"),
        (PROJECT_DIR / ".orkestra" / "instructions" / "template", "template"),
    ]
    for base, source_type in instruction_bases:
        if base.exists():
            for file in base.glob("*.md"):
                if file.is_file():
                    rel_path = str(file.relative_to(PROJECT_DIR))
                    git_status = get_file_git_status(rel_path)
                    item = {
                        "path": rel_path,
                        "name": file.name,
                        "source": source_type,
                        **git_status
                    }
                    category = "gitignored" if git_status["gitignored"] else "tracked"
                    items["instructions"][category].append(item)
    
    # Collect agent-specific files (CLAUDE.md, AGENTS.md, etc.)
    agent_files = [
        "CLAUDE.md",
        "AGENTS.md",
        ".github/copilot-instructions.md",
    ]
    for agent_file in agent_files:
        file_path = PROJECT_DIR / agent_file
        if file_path.exists():
            rel_path = agent_file
            git_status = get_file_git_status(rel_path)
            item = {
                "path": rel_path,
                "name": file_path.name,
                "source": "agent",
                **git_status
            }
            category = "gitignored" if git_status["gitignored"] else "tracked"
            items["instructions"][category].append(item)
    
    # Collect .github/instructions/ files
    github_instructions = PROJECT_DIR / ".github" / "instructions"
    if github_instructions.exists():
        for file in github_instructions.glob("*.md"):
            if file.is_file():
                rel_path = str(file.relative_to(PROJECT_DIR))
                git_status = get_file_git_status(rel_path)
                item = {
                    "path": rel_path,
                    "name": file.name,
                    "source": "copilot",
                    **git_status
                }
                category = "gitignored" if git_status["gitignored"] else "tracked"
                items["instructions"][category].append(item)
    
    # Collect skills
    skills_base = PROJECT_DIR / ".claude" / "skills"
    if skills_base.exists():
        for item_path in skills_base.iterdir():
            if item_path.is_dir() or item_path.suffix == ".md":
                rel_path = str(item_path.relative_to(PROJECT_DIR))
                git_status = get_file_git_status(rel_path)
                item = {
                    "path": rel_path,
                    "name": item_path.name,
                    "isDir": item_path.is_dir(),
                    **git_status
                }
                category = "gitignored" if git_status["gitignored"] else "tracked"
                items["skills"][category].append(item)
    
    # Collect MCP configs
    mcp_base = PROJECT_DIR / ".orkestra" / "mcp"
    if mcp_base.exists():
        for file in mcp_base.glob("*.json"):
            if file.is_file():
                rel_path = str(file.relative_to(PROJECT_DIR))
                git_status = get_file_git_status(rel_path)
                item = {
                    "path": rel_path,
                    "name": file.name,
                    **git_status
                }
                category = "gitignored" if git_status["gitignored"] else "tracked"
                items["mcp"][category].append(item)
    
    # Collect workflows
    workflows_base = PROJECT_DIR / ".orkestra" / "workflows"
    if workflows_base.exists():
        for file in workflows_base.glob("*.yaml"):
            if file.is_file():
                rel_path = str(file.relative_to(PROJECT_DIR))
                git_status = get_file_git_status(rel_path)
                item = {
                    "path": rel_path,
                    "name": file.name,
                    **git_status
                }
                category = "gitignored" if git_status["gitignored"] else "tracked"
                items["workflows"][category].append(item)
    
    return items


def parse_simple_yaml_lists(file_path: Path) -> dict[str, dict[str, list[str]]]:
    data: dict[str, dict[str, list[str]]] = {
        "global_locations": {},
        "global_files": {},
    }
    if not file_path.exists() or not file_path.is_file():
        return data

    section = ""
    agent = ""
    for raw in file_path.read_text(encoding="utf-8").splitlines():
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line.startswith(" ") and line.endswith(":"):
            key = line[:-1].strip()
            if key in data:
                section = key
                agent = ""
            continue
        if section and line.startswith("  ") and not line.startswith("    ") and line.strip().endswith(":"):
            agent = line.strip()[:-1]
            data[section].setdefault(agent, [])
            continue
        if section and agent and line.startswith("    - "):
            value = line[6:].strip().strip('"').strip("'")
            data[section][agent].append(value)

    return data


def load_global_location_settings() -> dict[str, dict[str, list[str]]]:
    defaults = parse_simple_yaml_lists(DEFAULT_GLOBAL_SETTINGS_PATH)
    user = parse_simple_yaml_lists(USER_GLOBAL_SETTINGS_PATH)

    merged: dict[str, dict[str, list[str]]] = {
        "global_locations": {},
        "global_files": {},
    }
    for section in ("global_locations", "global_files"):
        base = defaults.get(section, {})
        override = user.get(section, {})

        # Start with defaults, then allow full replacement per agent from user settings.
        for agent, values in base.items():
            merged[section][agent] = list(values)
        for agent, values in override.items():
            merged[section][agent] = list(values)

    return merged


def parse_agents_config_yaml(file_path: Path) -> dict:
    """
    Parse agents-config.yaml using PyYAML if available, otherwise return empty dict.
    """
    if not file_path.exists():
        return {}

    if not HAS_YAML:
        print("Warning: PyYAML not available, cannot parse agents-config.yaml", file=sys.stderr)
        return {}
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
            return config if isinstance(config, dict) else {}
    except Exception as e:
        print(f"Warning: Failed to parse {file_path}: {e}", file=sys.stderr)
        return {}


def validate_agents_config(config: dict) -> tuple[bool, list[str]]:
    """Validate agents-config structure and return (is_valid, errors)."""
    errors: list[str] = []
    
    if not config:
        errors.append("Empty config")
        return False, errors
    
    if "version" not in config or config["version"] < 1:
        errors.append("Missing or invalid version")
    
    # Check agents
    agents = config.get("agents", [])
    if not agents:
        errors.append("No agents defined")
    else:
        agent_ids = set()
        for i, agent in enumerate(agents):
            if not isinstance(agent, dict):
                errors.append(f"Agent {i}: not a dict")
                continue
            if "id" not in agent:
                errors.append(f"Agent {i}: missing 'id'")
            elif agent["id"] in agent_ids:
                errors.append(f"Agent {i}: duplicate id '{agent['id']}'")
            else:
                agent_ids.add(agent["id"])
    
    # Check item_types
    item_types = config.get("item_types", [])
    if not item_types:
        errors.append("No item_types defined")
    else:
        item_type_ids = set()
        for i, item_type in enumerate(item_types):
            if not isinstance(item_type, dict):
                errors.append(f"Item type {i}: not a dict")
                continue
            if "id" not in item_type:
                errors.append(f"Item type {i}: missing 'id'")
            elif item_type["id"] in item_type_ids:
                errors.append(f"Item type {i}: duplicate id '{item_type['id']}'")
            else:
                item_type_ids.add(item_type["id"])
    
    # Check deployments
    deployments = config.get("deployments", [])
    if deployments:
        deployment_ids = set()
        valid_agents = {a.get("id") for a in agents if isinstance(a, dict) and "id" in a}
        valid_agents.add("all")  # Special agent for agent-agnostic deployments
        valid_item_types = {it.get("id") for it in item_types if isinstance(it, dict) and "id" in it}
        
        for i, deployment in enumerate(deployments):
            if not isinstance(deployment, dict):
                errors.append(f"Deployment {i}: not a dict")
                continue
            
            dep_id = deployment.get("id")
            if not dep_id:
                errors.append(f"Deployment {i}: missing 'id'")
            elif dep_id in deployment_ids:
                errors.append(f"Deployment {i}: duplicate id '{dep_id}'")
            else:
                deployment_ids.add(dep_id)
            
            agent = deployment.get("agent")
            if not agent:
                errors.append(f"Deployment {dep_id}: missing 'agent'")
            elif agent not in valid_agents:
                errors.append(f"Deployment {dep_id}: invalid agent '{agent}'")
            
            item_type = deployment.get("item_type")
            if not item_type:
                errors.append(f"Deployment {dep_id}: missing 'item_type'")
            elif item_type not in valid_item_types:
                errors.append(f"Deployment {dep_id}: invalid item_type '{item_type}'")
            
            scope = deployment.get("scope")
            if scope not in ("global", "project"):
                errors.append(f"Deployment {dep_id}: invalid scope '{scope}'")
            
            strategy = deployment.get("strategy")
            if strategy not in ("bundle", "copy_file", "copy_tree", "merge_json"):
                errors.append(f"Deployment {dep_id}: unknown strategy '{strategy}'")
    
    return len(errors) == 0, errors


def load_agents_config() -> dict:
    """
    Load agents config from default location, with optional user override.
    Returns validated config or default minimal config on error.
    """
    # Try default config first
    config = parse_agents_config_yaml(DEFAULT_AGENTS_CONFIG_PATH)
    
    # Apply user overrides if they exist
    if USER_AGENTS_CONFIG_PATH.exists():
        user_config = parse_agents_config_yaml(USER_AGENTS_CONFIG_PATH)
        if user_config:
            # For simplicity, user config completely replaces default
            # (more sophisticated merge logic could be added later)
            config = user_config
    
    # Validate
    is_valid, errors = validate_agents_config(config)
    if not is_valid:
        print(f"Warning: agents-config validation failed: {errors}", file=sys.stderr)
        # Return minimal fallback
        return {
            "version": 1,
            "agents": [
                {"id": "claude", "label": "Claude", "enabled": True},
                {"id": "copilot", "label": "Copilot", "enabled": True},
                {"id": "codex", "label": "Codex", "enabled": True},
            ],
            "item_types": [
                {"id": "instructions", "label": "Instructions", "default_strategy": "bundle"},
            ],
            "deployments": []
        }
    
    return config


def build_global_agent_file_map() -> dict[str, dict[str, Path]]:
    # key format: global/<agent>/<relative-path-from-root>
    # Values are absolute, resolved paths under HOME_DIR only.
    allowed_ext = {".md", ".txt", ".json", ".yaml", ".yml", ".toml"}

    settings = load_global_location_settings()
    roots: dict[str, list[Path]] = {}
    exact_files: dict[str, list[Path]] = {}

    for agent, values in settings.get("global_locations", {}).items():
        roots[agent] = [Path(os.path.expanduser(v)) for v in values]
    for agent, values in settings.get("global_files", {}).items():
        exact_files[agent] = [Path(os.path.expanduser(v)) for v in values]

    out: dict[str, dict[str, Path]] = {agent: {} for agent in sorted(set(roots.keys()) | set(exact_files.keys()))}
    max_per_agent = 60

    def add_entry(agent: str, key: str, path: Path) -> None:
        resolved = path.resolve()
        if not str(resolved).startswith(str(HOME_DIR.resolve())):
            return
        out.setdefault(agent, {})[key] = resolved

    for agent, files in exact_files.items():
        for file_path in files:
            if not str(file_path.resolve()).startswith(str(HOME_DIR.resolve())):
                continue
            rel = file_path.resolve().relative_to(HOME_DIR.resolve())
            key = f"global/{agent}/{rel.as_posix()}"
            add_entry(agent, key, file_path)

    for agent, bases in roots.items():
        if len(out.get(agent, {})) >= max_per_agent:
            continue
        for base in bases:
            if len(out.get(agent, {})) >= max_per_agent:
                break
            if not base.exists() or not base.is_dir():
                continue

            # Only include direct files in configured common folders.
            # This avoids expensive and noisy recursive scans of entire agent homes.
            for p in sorted(base.iterdir()):
                if len(out.get(agent, {})) >= max_per_agent:
                    break
                if not p.is_file():
                    continue
                if p.suffix.lower() not in allowed_ext:
                    continue
                try:
                    rel = p.relative_to(HOME_DIR)
                except ValueError:
                    continue
                key = f"global/{agent}/{rel.as_posix()}"
                add_entry(agent, key, p)

    # Always expose user settings file for customization in global mode.
    settings_key = "global/orkestra/.config/orkestra/settings.yaml"
    out.setdefault("orkestra", {})[settings_key] = USER_GLOBAL_SETTINGS_PATH

    return out


def flatten_global_map(by_agent: dict[str, dict[str, Path]]) -> dict[str, Path]:
    flat: dict[str, Path] = {}
    for files in by_agent.values():
        flat.update(files)
    return flat


def global_target_for_agent(agent: str) -> Path:
    defaults = {
        "claude": HOME_DIR / "CLAUDE.md",
        "codex": HOME_DIR / "AGENTS.md",
        "copilot": HOME_DIR / ".github" / "copilot-instructions.md",
    }

    settings = load_global_location_settings()
    candidates = settings.get("global_files", {}).get(agent, [])
    for raw in candidates:
        expanded = Path(os.path.expanduser(raw))
        resolved_parent = expanded.parent.resolve() if expanded.parent.exists() else expanded.parent
        if str(resolved_parent).startswith(str(HOME_DIR.resolve())):
            return expanded

    return defaults.get(agent, HOME_DIR / f"{agent.upper()}.md")


def resolve_path(mode: str, rel: str) -> tuple[Path | None, str | None]:
    if mode == "global":
        by_agent = build_global_agent_file_map()
        flat = flatten_global_map(by_agent)
        candidate = flat.get(rel)
        if candidate is None:
            return None, "Unknown global path"
        return candidate, None

    if mode == "rendered":
        base = PROJECT_DIR
    else:
        base = ROOT

    candidate = (base / rel).resolve()
    if not str(candidate).startswith(str(base)):
        return None, "Invalid path"
    return candidate, None


def can_write_path(mode: str, rel: str, candidate: Path) -> tuple[bool, str | None]:
    if mode == "rendered":
        return False, "Rendered files are read-only in this UI"

    if mode == "global":
        return True, None

    try:
        parts = candidate.relative_to(ROOT).parts
    except ValueError:
        return False, "Write path not allowed"

    if not is_source_write_allowed(parts):
        return False, "Write path not allowed"
    return True, None


def is_source_write_allowed(parts: tuple[str, ...]) -> bool:
    if len(parts) >= 4 and parts[0] == "content" and parts[1] == "templates" and safe_name(parts[2]):
        return True
    if len(parts) >= 4 and parts[0] == "content" and parts[1] == "instructions" and parts[2] == "global":
        return True
    if len(parts) >= 2 and parts[0] == "content" and parts[1] in {"skills", "mcp", "workflows"}:
        return True
    return False


def is_rendered_read_allowed(rel: str) -> bool:
    allowed_prefixes = [
        ".orkestra/instructions/global/",
        ".orkestra/instructions/template/",
        ".github/instructions/",
    ]
    allowed_exact = {".github/copilot-instructions.md", "CLAUDE.md", "AGENTS.md"}
    if rel in allowed_exact:
        return True
    return any(rel.startswith(prefix) for prefix in allowed_prefixes)


def map_source_to_rendered(rel: str) -> str | None:
    if rel.startswith("content/instructions/global/"):
        name = rel.split("/", 2)[2]
        return f".orkestra/instructions/global/{name}"

    m = re.fullmatch(r"content/templates/[^/]+/instructions/(.+)", rel)
    if m:
        return f".orkestra/instructions/template/{m.group(1)}"

    return None


def compose_template_instruction_bundle(template: str) -> str:
    global_dir = ROOT / "content" / "instructions" / "global"
    template_dir = ROOT / "content" / "templates" / template / "instructions"

    sections: list[str] = []

    global_parts: list[str] = []
    if global_dir.exists():
        for p in sorted(global_dir.glob("*.md")):
            if p.is_file():
                global_parts.append(f"## Global: {p.stem}\n\n" + p.read_text(encoding="utf-8").strip())
    if global_parts:
        sections.append("# Global Instructions\n\n" + "\n\n".join(global_parts))

    template_parts: list[str] = []
    if template_dir.exists():
        for p in sorted(template_dir.glob("*.md")):
            if p.is_file():
                template_parts.append(f"## Template: {p.stem}\n\n" + p.read_text(encoding="utf-8").strip())
    if template_parts:
        sections.append(f"# Template: {template}\n\n" + "\n\n".join(template_parts))

    return ("\n\n---\n\n".join(sections)).strip() + "\n"


def compose_selected_sources_bundle(source_paths: list[str]) -> str:
    sections: list[str] = []

    for rel in source_paths:
        candidate = (ROOT / rel).resolve()
        if not str(candidate).startswith(str(ROOT)):
            continue
        if not candidate.exists() or not candidate.is_file():
            continue

        try:
            parts = candidate.relative_to(ROOT).parts
        except ValueError:
            continue
        if not is_source_write_allowed(parts):
            continue

        title = rel.replace("_", " ")
        body = candidate.read_text(encoding="utf-8").strip()
        sections.append(f"## Source: {title}\n\n{body}")

    if not sections:
        return ""
    return ("\n\n---\n\n".join(sections)).strip() + "\n"


def compose_selected_global_bundle(source_paths: list[str], agent: str) -> str:
    global_map = build_global_agent_file_map()
    flat = flatten_global_map(global_map)
    prefix = f"global/{agent}/"

    sections: list[str] = []
    for rel in source_paths:
        if not rel.startswith(prefix):
            continue
        candidate = flat.get(rel)
        if candidate is None or not candidate.exists() or not candidate.is_file():
            continue

        title = rel[len(prefix):]
        body = candidate.read_text(encoding="utf-8").strip()
        sections.append(f"## Global: {title}\n\n{body}")

    if not sections:
        return ""
    return ("\n\n---\n\n".join(sections)).strip() + "\n"


def project_target_for_agent(agent: str) -> Path | None:
    mapping = {
        "claude": PROJECT_DIR / "CLAUDE.md",
        "codex": PROJECT_DIR / "AGENTS.md",
        "copilot": PROJECT_DIR / ".github" / "copilot-instructions.md",
    }
    return mapping.get(agent)


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


def is_git_repository() -> bool:
    """Check if PROJECT_DIR is inside a git repository."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--git-dir"],
            cwd=str(PROJECT_DIR),
            capture_output=True,
            check=False,
            timeout=2,
        )
        return result.returncode == 0
    except:
        return False


def is_tracked_by_git(rel_path: str) -> bool:
    """
    Check if a file is tracked by git.
    Returns False if not in a git repo or file is not tracked.
    """
    if not is_git_repository():
        return False
    
    try:
        result = subprocess.run(
            ["git", "ls-files", "--error-unmatch", rel_path],
            cwd=str(PROJECT_DIR),
            capture_output=True,
            check=False,
            timeout=2,
        )
        return result.returncode == 0
    except:
        return False


def is_gitignored(rel_path: str) -> bool:
    """
    Check if a path is gitignored.
    Returns False if not in a git repo or path is not ignored.
    """
    if not is_git_repository():
        # Fallback: check if path matches common gitignore patterns
        path_str = rel_path.lower()
        common_ignores = [".orkestra/tmp", "__pycache__", ".pyc", ".DS_Store", "node_modules"]
        return any(pattern in path_str for pattern in common_ignores)
    
    try:
        result = subprocess.run(
            ["git", "check-ignore", rel_path],
            cwd=str(PROJECT_DIR),
            capture_output=True,
            check=False,
            timeout=2,
        )
        return result.returncode == 0
    except:
        return False


def get_file_git_status(rel_path: str) -> dict:
    """
    Get git status information for a file.
    Returns: {"tracked": bool, "gitignored": bool, "exists": bool}
    """
    full_path = PROJECT_DIR / rel_path
    
    return {
        "tracked": is_tracked_by_git(rel_path),
        "gitignored": is_gitignored(rel_path),
        "exists": full_path.exists(),
    }


def expand_source_globs(globs: list[str], template: str = "") -> list[Path]:
    """
    Expand glob patterns from deployment config into actual file paths.
    Supports {template} placeholder.
    """
    paths: list[Path] = []
    for pattern in globs:
        # Expand {template} placeholder
        expanded_pattern = pattern.replace("{template}", template) if template else pattern
        
        # Handle home directory expansion
        if expanded_pattern.startswith("~/"):
            base = HOME_DIR
            rel_pattern = expanded_pattern[2:]
        else:
            base = ROOT
            rel_pattern = expanded_pattern
        
        # Simple glob expansion
        pattern_parts = rel_pattern.split("/")
        if "*" in rel_pattern:
            # Use glob
            matches = base.glob(rel_pattern)
            paths.extend([p for p in matches if p.is_file()])
        else:
            # Direct path
            candidate = base / rel_pattern
            if candidate.exists() and candidate.is_file():
                paths.append(candidate)
    
    return paths


def deploy_bundle_strategy(sources: list[Path], target: Path, agent: str) -> tuple[bool, str]:
    """
    Bundle multiple source files into a single target file.
    Used for agent instruction files like CLAUDE.md, AGENTS.md, copilot-instructions.md
    """
    try:
        # Ensure target directory exists
        target.parent.mkdir(parents=True, exist_ok=True)
        
        # Compose bundle
        sections: list[str] = []
        for source_file in sources:
            if source_file.exists() and source_file.is_file():
                content = source_file.read_text(encoding="utf-8")
                sections.append(f"<!-- source: {source_file.name} -->\n\n{content}")
        
        if not sections:
            return False, "No source files found to bundle"
        
        bundle_content = "\n\n---\n\n".join(sections)
        target.write_text(bundle_content, encoding="utf-8")
        
        return True, f"Bundled {len(sources)} files to {target}"
    except Exception as e:
        return False, f"Bundle failed: {e}"


def deploy_copy_file_strategy(sources: list[Path], target: Path, agent: str) -> tuple[bool, str]:
    """
    Copy source files individually to target directory.
    Used for workflows, individual MCP configs, individual instructions.
    """
    try:
        # Target should be a directory
        target.mkdir(parents=True, exist_ok=True)
        
        copied = 0
        for source_file in sources:
            if source_file.exists() and source_file.is_file():
                dest_file = target / source_file.name
                shutil.copy2(source_file, dest_file)
                copied += 1
        
        if copied == 0:
            return False, "No files found to copy"
        
        return True, f"Copied {copied} files to {target}"
    except Exception as e:
        return False, f"Copy failed: {e}"


def deploy_copy_tree_strategy(sources: list[Path], target: Path, agent: str) -> tuple[bool, str]:
    """
    Copy entire directory trees.
    Used for skills, plugins.
    """
    try:
        target.mkdir(parents=True, exist_ok=True)
        
        copied = 0
        for source_path in sources:
            if source_path.is_dir():
                # Copy entire directory
                dest_dir = target / source_path.name
                if dest_dir.exists():
                    shutil.rmtree(dest_dir)
                shutil.copytree(source_path, dest_dir)
                copied += 1
            elif source_path.is_file():
                # Individual file - copy to target
                shutil.copy2(source_path, target / source_path.name)
                copied += 1
        
        if copied == 0:
            return False, "No directories or files found to copy"
        
        return True, f"Copied {copied} items to {target}"
    except Exception as e:
        return False, f"Copy tree failed: {e}"


def execute_deployment(deployment: dict, template: str = "") -> tuple[bool, str]:
    """
    Execute a single deployment based on config and strategy.
    Returns (success, message)
    """
    strategy = deployment.get("strategy", "")
    source_globs = deployment.get("source", [])
    target_str = deployment.get("target", "")
    agent = deployment.get("agent", "")
    scope = deployment.get("scope", "")
    
    # Expand target path
    target_expanded = target_str.replace("{template}", template) if template else target_str
    if target_expanded.startswith("~/"):
        target = HOME_DIR / target_expanded[2:]
    elif scope == "project":
        target = PROJECT_DIR / target_expanded
    else:
        target = Path(target_expanded).expanduser()
    
    # Expand source globs
    sources = expand_source_globs(source_globs, template)
    
    if not sources:
        return False, f"No source files matched patterns: {source_globs}"
    
    # Execute strategy
    if strategy == "bundle":
        return deploy_bundle_strategy(sources, target, agent)
    elif strategy == "copy_file":
        return deploy_copy_file_strategy(sources, target, agent)
    elif strategy == "copy_tree":
        return deploy_copy_tree_strategy(sources, target, agent)
    else:
        return False, f"Unknown deployment strategy: {strategy}"


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, payload: dict | list, status: int = 200) -> None:
        raw = json.dumps(payload, ensure_ascii=True, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _send_file(self, path: Path, content_type: str = "text/plain; charset=utf-8") -> None:
        if not path.exists() or not path.is_file():
            self.send_error(404, "Not found")
            return
        raw = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def log_message(self, format: str, *args) -> None:
        return

    def do_GET(self) -> None:
        maybe_restart_on_server_change()

        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/":
            return self._send_file(WEBUI_DIR / "index.html", "text/html; charset=utf-8")
        if path == "/app.js":
            return self._send_file(WEBUI_DIR / "app.js", "application/javascript; charset=utf-8")
        if path == "/styles.css":
            return self._send_file(WEBUI_DIR / "styles.css", "text/css; charset=utf-8")
        if path == "/orkestra.png":
            return self._send_file(ROOT / "orkestra.png", "image/png")

        if path == "/api/templates":
            rendered_global_dir = PROJECT_DIR / ".orkestra" / "instructions" / "global"
            global_map = build_global_agent_file_map()
            global_by_agent = {
                agent: sorted(files.keys())
                for agent, files in global_map.items()
            }
            return self._send_json(
                {
                    "templatesSource": collect_templates(TEMPLATES_DIR),
                    "templateRendered": collect_rendered_template(),
                    "globalSource": collect_global_files(ROOT / "content" / "instructions" / "global"),
                    "globalRendered": collect_global_files(rendered_global_dir),
                    "globalByAgent": global_by_agent,
                    "extras": collect_extras(),
                    "agents": list_agents(),
                    "renderedAvailable": (PROJECT_DIR / ".orkestra").is_dir(),
                }
            )

        if path == "/api/context":
            return self._send_json(
                {
                    "projectDir": str(PROJECT_DIR),
                    "initialized": (PROJECT_DIR / ".orkestra").is_dir(),
                }
            )

        if path == "/api/entities":
            return self._send_json(collect_entities_index())

        if path in {"/api/meta", "/api/agent-context"}:
            return self._send_json(
                {
                    "name": "Orkestra local agent API",
                    "version": "0.1",
                    "baseUrl": f"http://{HOST}:{PORT}",
                    "skill": {
                        "name": "orkestra-api",
                        "purpose": "Inspect, create, edit, organize, and deploy Orkestra plugins through the local API.",
                        "instructions": [
                            "GET /api/entities lists plugins, hierarchy, installed state, and agent availability.",
                            "POST /api/entities/create creates a markdown, yaml, or shell plugin in a category.",
                            "POST /api/entities/update writes editable plugin metadata, description, and content.",
                            "POST /api/entities/move moves a plugin to another section or subsection.",
                            "POST /api/entities/enable and /disable deploy or remove a plugin for a scope.",
                        ],
                    },
                    "endpoints": [
                        {"method": "GET", "path": "/api/entities", "purpose": "Plugin catalog and current deployment state"},
                        {"method": "POST", "path": "/api/entities/create", "purpose": "Create a custom plugin"},
                        {"method": "POST", "path": "/api/entities/update", "purpose": "Update a plugin"},
                        {"method": "POST", "path": "/api/entities/move", "purpose": "Move a plugin between categories"},
                    ],
                }
            )

        if path == "/api/dev-hash":
            return self._send_json(
                {
                    "hash": watch_signature(WEBUI_WATCH_FILES),
                }
            )

        if path == "/api/file":
            query = parse_qs(parsed.query)
            rel = query.get("path", [""])[0]
            mode = query.get("mode", ["source"])[0]
            if not rel:
                return self._send_json({"error": "Missing path"}, status=400)
            candidate, err = resolve_path(mode, rel)
            if err or candidate is None:
                return self._send_json({"error": err or "Invalid path"}, status=400)

            if mode == "rendered" and not is_rendered_read_allowed(rel):
                return self._send_json({"error": "Read path not allowed in rendered mode"}, status=403)

            if not candidate.exists() or not candidate.is_file():
                # In global mode we expose editable settings stubs even before file exists.
                if mode == "global":
                    return self._send_json(
                        {
                            "path": rel,
                            "mode": mode,
                            "readOnly": False,
                            "content": "# User override settings for global agent locations\n# Example:\n# global_locations:\n#   claude:\n#     - ~/.claude\n",
                        }
                    )
                return self._send_json({"error": "File not found"}, status=404)
            return self._send_json(
                {
                    "path": rel,
                    "mode": mode,
                    "readOnly": mode == "rendered",
                    "content": candidate.read_text(encoding="utf-8"),
                }
            )

        if path == "/api/diff":
            query = parse_qs(parsed.query)
            rel = query.get("source", [""])[0]
            if not rel:
                return self._send_json({"error": "Missing source"}, status=400)

            source_file, err = resolve_path("source", rel)
            if err or source_file is None:
                return self._send_json({"error": err or "Invalid source"}, status=400)
            if not source_file.exists() or not source_file.is_file():
                return self._send_json({"error": "Source file not found"}, status=404)

            rendered_rel = map_source_to_rendered(rel)
            if rendered_rel is None:
                return self._send_json(
                    {
                        "source": rel,
                        "rendered": None,
                        "available": False,
                        "diff": "No rendered mapping for this source file.",
                    }
                )

            rendered_file, err = resolve_path("rendered", rendered_rel)
            if err or rendered_file is None:
                return self._send_json({"error": err or "Invalid rendered path"}, status=400)

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

            return self._send_json(
                {
                    "source": rel,
                    "rendered": rendered_rel,
                    "available": available,
                    "diff": diff_text,
                }
            )

        if path == "/api/agents-config":
            config = load_agents_config()
            return self._send_json(config)

        if path == "/api/settings":
            content = USER_AGENTS_CONFIG_PATH.read_text(encoding="utf-8") if USER_AGENTS_CONFIG_PATH.exists() else DEFAULT_AGENTS_CONFIG_PATH.read_text(encoding="utf-8")
            return self._send_json({"path": str(USER_AGENTS_CONFIG_PATH), "content": content})

        if path == "/api/deploy-index":
            # Collect everything needed for config-driven deployment UI
            config = load_agents_config()
            rendered_global_dir = PROJECT_DIR / ".orkestra" / "instructions" / "global"
            global_map = build_global_agent_file_map()
            
            # Determine current project template if initialized
            current_template = ""
            manifest_file = PROJECT_DIR / ".orkestra" / "manifest.yaml"
            if manifest_file.exists():
                # Simple parse for template field
                for line in manifest_file.read_text(encoding="utf-8").splitlines():
                    if line.startswith("template:"):
                        current_template = line.split(":", 1)[1].strip()
                        break
            
            # Collect project items with git status
            project_items = collect_project_items_with_status()
            
            return self._send_json(
                {
                    "agents": config.get("agents", []),
                    "itemTypes": config.get("item_types", []),
                    "deployments": config.get("deployments", []),
                    "project": {
                        "path": str(PROJECT_DIR),
                        "initialized": (PROJECT_DIR / ".orkestra").is_dir(),
                        "template": current_template,
                        "isGitRepo": is_git_repository(),
                    },
                    "projectItems": project_items,
                    # Legacy compatibility - keep these for now
                    "templatesSource": collect_templates(TEMPLATES_DIR),
                    "templateRendered": collect_rendered_template(),
                    "globalSource": collect_global_files(ROOT / "content" / "instructions" / "global"),
                    "globalRendered": collect_global_files(rendered_global_dir),
                    "globalByAgent": {
                        agent: sorted(files.keys())
                        for agent, files in global_map.items()
                    },
                    "extras": collect_extras(),
                    "renderedAvailable": (PROJECT_DIR / ".orkestra").is_dir(),
                }
            )

        self.send_error(404, "Not found")

    def do_POST(self) -> None:
        maybe_restart_on_server_change()

        parsed = urlparse(self.path)
        if parsed.path == "/api/save":
            data = self._read_json()
            rel = data.get("path", "")
            content = data.get("content", "")
            mode = str(data.get("mode", "source"))

            if not rel or not isinstance(rel, str):
                return self._send_json({"error": "Missing path"}, status=400)

            candidate, err = resolve_path(mode, rel)
            if err or candidate is None:
                return self._send_json({"error": err or "Invalid path"}, status=400)

            writable, reason = can_write_path(mode, rel, candidate)
            if not writable:
                return self._send_json({"error": reason or "Write path not allowed"}, status=403)

            candidate.parent.mkdir(parents=True, exist_ok=True)
            candidate.write_text(content, encoding="utf-8")
            return self._send_json({"ok": True, "path": rel})

        if parsed.path == "/api/entities/save-content":
            data = self._read_json()
            entity_id = str(data.get("id") or "").strip()
            description = str(data.get("description") or "")
            content = str(data.get("content") or "")

            if not entity_id:
                return self._send_json({"error": "Missing entity id"}, status=400)
            if not safe_name(entity_id):
                return self._send_json({"error": "Invalid entity id"}, status=400)

            source_file = find_entity_source_file(entity_id)
            if source_file is None:
                return self._send_json({"error": "Plugin not found"}, status=404)

            raw = source_file.read_text(encoding="utf-8")
            raw = replace_yaml_block(raw, "description", description)
            source_file.write_text(replace_yaml_block(raw, "content", content), encoding="utf-8")
            return self._send_json({"ok": True, "entities": collect_entities_index()})

        if parsed.path == "/api/entities/update":
            data = self._read_json()
            entity_id = str(data.get("id") or "").strip()
            targets = data.get("targets") if isinstance(data.get("targets"), list) else ["source"]
            targets = [str(target).strip() for target in targets]
            file_contents = data.get("fileContents") if isinstance(data.get("fileContents"), dict) else {}
            file_contents = {str(path): str(content) for path, content in file_contents.items()}
            if not entity_id or not safe_name(entity_id):
                return self._send_json({"error": "Invalid plugin id"}, status=400)
            if not targets or any(target not in {"source", "user", "project"} for target in targets):
                return self._send_json({"error": "Select at least one valid save target"}, status=400)
            source_file = find_entity_source_file(entity_id)
            if source_file is None:
                return self._send_json({"error": "Plugin not found"}, status=404)
            source_entity = parse_entity_file(source_file)
            if source_entity is None:
                return self._send_json({"error": "Plugin source could not be parsed"}, status=500)
            editable_files = source_entity.get("editableFiles", [])
            instruction_file = next((item for item in editable_files if item.get("role") in {"instructions", "legacy"}), None)
            if instruction_file and str(instruction_file.get("path")) in file_contents:
                data["content"] = file_contents[str(instruction_file["path"])]
            plugin_type = str(data.get("type") or "markdown")
            if plugin_type not in PLUGIN_TYPES:
                return self._send_json({"error": "Invalid plugin type"}, status=400)
            data["executable"] = plugin_type == "shell"
            if plugin_type == "shell":
                data["runtime"] = str(data.get("runtime") or "bash")
                data["entrypoint"] = str(data.get("entrypoint") or f"{entity_id.rsplit('.', 1)[-1]}.sh")
            else:
                data["runtime"] = ""
                data["entrypoint"] = ""
            if "source" in targets:
                write_plugin_metadata(source_file, data)
                for rel_path, content in file_contents.items():
                    try:
                        write_plugin_editable_file(entity_id, rel_path, content)
                    except ValueError as exc:
                        return self._send_json({"error": str(exc)}, status=400)

            entity = parse_entity_file(source_file)
            if entity is None:
                return self._send_json({"error": "Updated plugin could not be parsed"}, status=500)
            if "source" not in targets:
                entity["content"] = str(data.get("content") or "")
                entity["type"] = plugin_type
                entity["entrypoint"] = str(data.get("entrypoint") or entity.get("entrypoint") or "")
            # User and project targets are intentional overrides of generated plugin files.
            # If absent, enable once to create the index before replacing its content.
            for target in targets:
                if target == "source":
                    continue
                scope = "global" if target == "user" else "project"
                destination = entity_installed_path(scope, entity_id)
                if not destination.exists():
                    ok, code, stdout, stderr = run_orkestra(["enable", entity_id, "--scope", scope])
                    if not ok:
                        return self._send_json(
                            {"error": stderr.strip() or stdout.strip() or f"Could not enable {target} scope", "code": code},
                            status=500,
                        )
                write_installed_plugin(scope, entity, source_file)
                for rel_path, content in file_contents.items():
                    write_installed_plugin_asset(scope, entity, source_file, rel_path, content)
            return self._send_json({"ok": True, "targets": targets, "entities": collect_entities_index()})

        if parsed.path == "/api/entities/sync":
            data = self._read_json()
            entity_id = str(data.get("id") or "").strip()
            scope = str(data.get("scope") or "").strip()
            direction = str(data.get("direction") or "").strip()
            rel_path = str(data.get("path") or "").strip()
            if not entity_id or scope not in {"global", "project"} or direction not in {"source-to-scope", "scope-to-source"}:
                return self._send_json({"error": "Choose a plugin, scope, and sync direction"}, status=400)
            source_file = find_entity_source_file(entity_id)
            if source_file is None:
                return self._send_json({"error": "Plugin not found"}, status=404)
            entity = parse_entity_file(source_file)
            if entity is None:
                return self._send_json({"error": "Plugin source could not be parsed"}, status=500)
            files = entity.get("editableFiles", [])
            editable_file = next((item for item in files if str(item.get("path") or "") == rel_path), None)
            if editable_file is None:
                return self._send_json({"error": "Editable plugin file not found"}, status=404)
            try:
                if direction == "source-to-scope":
                    sync_editable_file_source_to_scope(scope, entity, source_file, editable_file)
                else:
                    sync_editable_file_scope_to_source(scope, entity, source_file, editable_file)
            except ValueError as exc:
                return self._send_json({"error": str(exc)}, status=400)
            return self._send_json({"ok": True, "entities": collect_entities_index()})

        if parsed.path == "/api/categories/create":
            data = self._read_json()
            main = str(data.get("main") or "").strip()
            label = str(data.get("label") or "").strip()
            slug = slugify(str(data.get("slug") or label))
            if main not in known_main_categories() or not slug:
                return self._send_json({"error": "Choose a top-level category and a valid name"}, status=400)
            category_id = f"{main}.{slug}"
            categories = custom_categories()
            built_in = {sub_id for _, _, subs in ENTITY_CATEGORY_TREE for sub_id, _ in subs}
            if category_id in built_in or any(item.get("id") == category_id for item in categories):
                return self._send_json({"error": "This category already exists"}, status=409)
            categories.append({"id": category_id, "main": main, "label": label})
            save_custom_categories(categories)
            return self._send_json({"ok": True, "category": category_id, "entities": collect_entities_index()})

        if parsed.path == "/api/entities/create":
            data = self._read_json()
            try:
                entity = create_plugin_source(
                    str(data.get("category") or "").strip(),
                    str(data.get("name") or "").strip(),
                    str(data.get("type") or "markdown").strip(),
                )
            except ValueError as exc:
                return self._send_json({"error": str(exc)}, status=400)
            return self._send_json({"ok": True, "entity": entity, "entities": collect_entities_index()})

        if parsed.path == "/api/entities/assets/create":
            data = self._read_json()
            try:
                entity = add_plugin_asset(
                    str(data.get("id") or "").strip(),
                    str(data.get("name") or "").strip(),
                    str(data.get("type") or "").strip(),
                )
            except ValueError as exc:
                return self._send_json({"error": str(exc)}, status=400)
            return self._send_json({"ok": True, "entity": entity, "entities": collect_entities_index()})

        if parsed.path == "/api/entities/assets/remove":
            data = self._read_json()
            try:
                remove_plugin_asset(str(data.get("id") or "").strip(), str(data.get("path") or "").strip())
            except ValueError as exc:
                return self._send_json({"error": str(exc)}, status=400)
            return self._send_json({"ok": True, "entities": collect_entities_index()})

        if parsed.path == "/api/entities/remove":
            data = self._read_json()
            entity_id = str(data.get("id") or "").strip()
            if not safe_name(entity_id):
                return self._send_json({"error": "Invalid plugin id"}, status=400)
            source_file = find_entity_source_file(entity_id)
            if source_file is None:
                return self._send_json({"error": "Plugin not found"}, status=404)
            for scope in ("global", "project"):
                if entity_installed_path(scope, entity_id).exists():
                    run_orkestra(["disable", entity_id, "--scope", scope])
            try:
                remove_plugin_source(entity_id)
            except ValueError as exc:
                return self._send_json({"error": str(exc)}, status=400)
            return self._send_json({"ok": True, "entities": collect_entities_index()})

        if parsed.path == "/api/entities/move":
            data = self._read_json()
            entity_id = str(data.get("id") or "").strip()
            category = str(data.get("category") or "").strip()
            source_file = find_entity_source_file(entity_id) if safe_name(entity_id) else None
            known_categories = known_main_categories()
            known_categories.update(sub_id for _, _, subs in ENTITY_CATEGORY_TREE for sub_id, _ in subs)
            known_categories.update(str(item.get("id")) for item in custom_categories())
            if source_file is None or category not in known_categories:
                return self._send_json({"error": "Invalid plugin or destination category"}, status=400)
            source_entity = parse_entity_file(source_file)
            if source_entity is None:
                return self._send_json({"error": "Plugin source could not be parsed"}, status=400)
            if source_entity.get("category") == category:
                return self._send_json({"ok": True, "entities": collect_entities_index()})
            main, _, sub = category.partition(".")
            destination_parent = ROOT / "content" / "source" / main
            if sub:
                destination_parent /= sub
            if source_file.name == "manifest.yaml":
                destination_dir = destination_parent / source_file.parent.name
                if destination_dir.exists():
                    return self._send_json({"error": "A plugin with that directory already exists in the destination"}, status=409)
                raw = replace_yaml_value(source_file.read_text(encoding="utf-8"), "category", category)
                source_file.write_text(raw, encoding="utf-8")
                destination_dir.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(source_file.parent), str(destination_dir))
                return self._send_json({"ok": True, "entities": collect_entities_index()})
            destination = destination_parent / source_file.name
            if destination != source_file and destination.exists():
                return self._send_json({"error": "A plugin with that filename already exists in the destination"}, status=409)
            raw = replace_yaml_value(source_file.read_text(encoding="utf-8"), "category", category)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(raw, encoding="utf-8")
            for sibling in source_file.parent.iterdir():
                if sibling.is_file() and sibling.name != source_file.name and sibling.suffix == ".sh" and sibling.name == source_entity.get("entrypoint", ""):
                    shutil.move(str(sibling), str(destination.parent / sibling.name))
            if destination != source_file:
                source_file.unlink()
            return self._send_json({"ok": True, "entities": collect_entities_index()})

        if parsed.path == "/api/settings/save":
            data = self._read_json()
            content = str(data.get("content") or "")
            if HAS_YAML:
                try:
                    parsed_config = yaml.safe_load(content) or {}
                except Exception as exc:
                    return self._send_json({"error": f"Invalid YAML: {exc}"}, status=400)
                if not isinstance(parsed_config, dict):
                    return self._send_json({"error": "Settings must be a YAML mapping"}, status=400)
            USER_AGENTS_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
            USER_AGENTS_CONFIG_PATH.write_text(content.rstrip() + "\n", encoding="utf-8")
            return self._send_json({"ok": True, "path": str(USER_AGENTS_CONFIG_PATH)})

        if parsed.path in {"/api/entities/enable", "/api/entities/disable"}:
            data = self._read_json()
            entity_id = str(data.get("id") or "").strip()
            scope = str(data.get("scope") or "project").strip()
            agents = data.get("agents") if isinstance(data.get("agents"), list) else []

            if not entity_id:
                return self._send_json({"error": "Missing entity id"}, status=400)
            if scope not in {"project", "global"}:
                return self._send_json({"error": "Invalid scope"}, status=400)

            command = "enable" if parsed.path.endswith("/enable") else "disable"
            args = [command, entity_id, "--scope", scope]
            if command == "enable" and agents:
                args.extend(["--agents", ",".join(str(agent) for agent in agents)])

            ok, code, stdout, stderr = run_orkestra(args)
            if not ok:
                return self._send_json(
                    {"error": stderr.strip() or stdout.strip() or f"orkestra {command} failed", "code": code},
                    status=500,
                )
            return self._send_json({"ok": True, "stdout": stdout, "entities": collect_entities_index()})

        if parsed.path == "/api/compare-files":
            data = self._read_json()
            left = data.get("left") or {}
            right = data.get("right") or {}

            left_mode = str(left.get("mode", "")).strip()
            left_path = str(left.get("path", "")).strip()
            right_mode = str(right.get("mode", "")).strip()
            right_path = str(right.get("path", "")).strip()

            if left_mode not in {"source", "global", "rendered"} or right_mode not in {"source", "global", "rendered"}:
                return self._send_json({"error": "Invalid compare mode"}, status=400)
            if not left_path or not right_path:
                return self._send_json({"error": "Missing compare path"}, status=400)

            left_file, err = resolve_path(left_mode, left_path)
            if err or left_file is None:
                return self._send_json({"error": err or "Invalid left path"}, status=400)
            right_file, err = resolve_path(right_mode, right_path)
            if err or right_file is None:
                return self._send_json({"error": err or "Invalid right path"}, status=400)

            left_lines = []
            right_lines = []
            if left_file.exists() and left_file.is_file():
                left_lines = left_file.read_text(encoding="utf-8").splitlines(keepends=True)
            if right_file.exists() and right_file.is_file():
                right_lines = right_file.read_text(encoding="utf-8").splitlines(keepends=True)

            diff_text = "".join(
                difflib.unified_diff(
                    left_lines,
                    right_lines,
                    fromfile=f"{left_mode}/{left_path}",
                    tofile=f"{right_mode}/{right_path}",
                    lineterm="",
                )
            )
            if not diff_text:
                diff_text = "No differences."

            return self._send_json(
                {
                    "left": {"mode": left_mode, "path": left_path},
                    "right": {"mode": right_mode, "path": right_path},
                    "diff": diff_text,
                }
            )

        if parsed.path == "/api/compare-text":
            data = self._read_json()

            left_label = str(data.get("leftLabel", "left")).strip() or "left"
            right_label = str(data.get("rightLabel", "right")).strip() or "right"
            left_content = str(data.get("leftContent", ""))
            right_content = str(data.get("rightContent", ""))

            left_lines = left_content.splitlines(keepends=True)
            right_lines = right_content.splitlines(keepends=True)

            diff_text = "".join(
                difflib.unified_diff(
                    left_lines,
                    right_lines,
                    fromfile=left_label,
                    tofile=right_label,
                    lineterm="",
                )
            )
            if not diff_text:
                diff_text = "No differences."

            return self._send_json({"diff": diff_text})

        if parsed.path == "/api/compare-structured":
            data = self._read_json()

            left_label = str(data.get("leftLabel", "left")).strip() or "left"
            right_label = str(data.get("rightLabel", "right")).strip() or "right"
            left_content = str(data.get("leftContent", ""))
            right_content = str(data.get("rightContent", ""))

            left_lines = left_content.splitlines()
            right_lines = right_content.splitlines()

            matcher = difflib.SequenceMatcher(a=left_lines, b=right_lines)
            blocks: list[dict] = []
            hunk_id = 1
            for tag, i1, i2, j1, j2 in matcher.get_opcodes():
                if tag == "equal":
                    continue
                blocks.append(
                    {
                        "id": hunk_id,
                        "tag": tag,
                        "leftStart": i1,
                        "leftEnd": i2,
                        "rightStart": j1,
                        "rightEnd": j2,
                        "leftLines": left_lines[i1:i2],
                        "rightLines": right_lines[j1:j2],
                    }
                )
                hunk_id += 1

            unified = "".join(
                difflib.unified_diff(
                    left_content.splitlines(keepends=True),
                    right_content.splitlines(keepends=True),
                    fromfile=left_label,
                    tofile=right_label,
                    lineterm="",
                )
            )
            if not unified:
                unified = "No differences."

            return self._send_json(
                {
                    "leftLabel": left_label,
                    "rightLabel": right_label,
                    "blocks": blocks,
                    "diff": unified,
                }
            )

        if parsed.path == "/api/apply-file-copy":
            data = self._read_json()
            source = data.get("source") or {}
            target = data.get("target") or {}

            source_mode = str(source.get("mode", "")).strip()
            source_path = str(source.get("path", "")).strip()
            target_mode = str(target.get("mode", "")).strip()
            target_path = str(target.get("path", "")).strip()

            if source_mode not in {"source", "global", "rendered"} or target_mode not in {"source", "global", "rendered"}:
                return self._send_json({"error": "Invalid apply mode"}, status=400)
            if not source_path or not target_path:
                return self._send_json({"error": "Missing source/target path"}, status=400)

            source_file, err = resolve_path(source_mode, source_path)
            if err or source_file is None:
                return self._send_json({"error": err or "Invalid source path"}, status=400)
            target_file, err = resolve_path(target_mode, target_path)
            if err or target_file is None:
                return self._send_json({"error": err or "Invalid target path"}, status=400)

            if not source_file.exists() or not source_file.is_file():
                return self._send_json({"error": "Source file not found"}, status=404)

            writable, reason = can_write_path(target_mode, target_path, target_file)
            if not writable:
                return self._send_json({"error": reason or "Target is read-only"}, status=403)

            content = source_file.read_text(encoding="utf-8")
            target_file.parent.mkdir(parents=True, exist_ok=True)
            target_file.write_text(content, encoding="utf-8")

            return self._send_json(
                {
                    "ok": True,
                    "source": {"mode": source_mode, "path": source_path},
                    "target": {"mode": target_mode, "path": target_path},
                    "stdout": f"Copied {source_mode}/{source_path} -> {target_mode}/{target_path}",
                    "stderr": "",
                }
            )

        if parsed.path == "/api/init":
            data = self._read_json()
            template = str(data.get("template", "")).strip()
            agents = data.get("agents", [])

            if not template:
                return self._send_json({"error": "Missing template"}, status=400)
            if not safe_name(template):
                return self._send_json({"error": "Invalid template"}, status=400)
            if not (TEMPLATES_DIR / template).is_dir():
                return self._send_json({"error": f"Unknown template: {template}"}, status=400)
            if not isinstance(agents, list) or not agents:
                return self._send_json({"error": "Select at least one agent"}, status=400)

            valid_agents = set(list_agents())
            cleaned_agents: list[str] = []
            for agent in agents:
                if not isinstance(agent, str):
                    continue
                agent = agent.strip()
                if agent in valid_agents:
                    cleaned_agents.append(agent)

            if not cleaned_agents:
                return self._send_json({"error": "No valid agents selected"}, status=400)

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
            return self._send_json(
                {
                    "ok": ok,
                    "returncode": code,
                    "stdout": out,
                    "stderr": err,
                    "projectDir": str(PROJECT_DIR),
                    "initialized": (PROJECT_DIR / ".orkestra").is_dir(),
                },
                status=200 if ok else 500,
            )

        if parsed.path == "/api/deploy-template":
            data = self._read_json()
            template = str(data.get("template", "")).strip()
            agents = data.get("agents", [])
            target = str(data.get("target", "project")).strip()

            if not template:
                return self._send_json({"error": "Missing template"}, status=400)
            if not safe_name(template):
                return self._send_json({"error": "Invalid template"}, status=400)
            if not (TEMPLATES_DIR / template).is_dir():
                return self._send_json({"error": f"Unknown template: {template}"}, status=400)
            if target not in {"project", "global"}:
                return self._send_json({"error": "Invalid target"}, status=400)
            if not isinstance(agents, list) or not agents:
                return self._send_json({"error": "Select at least one agent"}, status=400)

            valid_agents = set(list_agents())
            cleaned_agents: list[str] = []
            for agent in agents:
                if not isinstance(agent, str):
                    continue
                candidate = agent.strip()
                if candidate in valid_agents:
                    cleaned_agents.append(candidate)

            if not cleaned_agents:
                return self._send_json({"error": "No valid agents selected"}, status=400)

            if target == "project":
                ok_init, code_init, out_init, err_init = run_orkestra(
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
                ok_render, code_render, out_render, err_render = run_orkestra(["render"])

                ok = ok_init and ok_render
                return self._send_json(
                    {
                        "ok": ok,
                        "target": target,
                        "template": template,
                        "agents": cleaned_agents,
                        "returncode": code_render if not ok_render else code_init,
                        "stdout": ((out_init or "") + "\n" + (out_render or "")).strip(),
                        "stderr": ((err_init or "") + "\n" + (err_render or "")).strip(),
                    },
                    status=200 if ok else 500,
                )

            bundle = compose_template_instruction_bundle(template)
            written: list[str] = []
            for agent in cleaned_agents:
                target_file = global_target_for_agent(agent)
                target_file.parent.mkdir(parents=True, exist_ok=True)
                target_file.write_text(bundle, encoding="utf-8")
                written.append(str(target_file))

            return self._send_json(
                {
                    "ok": True,
                    "target": target,
                    "template": template,
                    "agents": cleaned_agents,
                    "written": written,
                    "stdout": "Wrote global instruction bundle for selected agents.",
                    "stderr": "",
                }
            )

        if parsed.path == "/api/deploy-section":
            data = self._read_json()
            destination = str(data.get("destination", "")).strip()
            source_paths = data.get("sourcePaths", [])
            agents = data.get("agents", [])

            if destination not in {"global", "project"}:
                return self._send_json({"error": "Invalid destination"}, status=400)
            if not isinstance(source_paths, list) or not source_paths:
                return self._send_json({"error": "Select at least one source file"}, status=400)
            if not isinstance(agents, list) or not agents:
                return self._send_json({"error": "Select at least one target"}, status=400)

            valid_agents = set(list_agents())
            cleaned_agents = [a.strip() for a in agents if isinstance(a, str) and a.strip() in valid_agents]
            if not cleaned_agents:
                return self._send_json({"error": "No valid target selected"}, status=400)

            cleaned_paths = [p.strip() for p in source_paths if isinstance(p, str) and p.strip()]
            bundle = compose_selected_sources_bundle(cleaned_paths)
            if not bundle:
                return self._send_json({"error": "No valid source files selected"}, status=400)

            written: list[str] = []

            if destination == "global":
                for agent in cleaned_agents:
                    target_file = global_target_for_agent(agent)
                    target_file.parent.mkdir(parents=True, exist_ok=True)
                    target_file.write_text(bundle, encoding="utf-8")
                    written.append(str(target_file))
            else:
                for agent in cleaned_agents:
                    target_file = project_target_for_agent(agent)
                    if target_file is None:
                        continue
                    target_file.parent.mkdir(parents=True, exist_ok=True)
                    target_file.write_text(bundle, encoding="utf-8")
                    written.append(str(target_file))

            if not written:
                return self._send_json({"error": "No writable targets for selection"}, status=400)

            return self._send_json(
                {
                    "ok": True,
                    "destination": destination,
                    "agents": cleaned_agents,
                    "written": written,
                    "stdout": f"Deployed selected section to {destination} targets.",
                    "stderr": "",
                }
            )

        if parsed.path == "/api/apply-global-selection":
            data = self._read_json()
            destination = str(data.get("destination", "")).strip()
            agent = str(data.get("agent", "")).strip()
            source_paths = data.get("sourcePaths", [])

            if destination not in {"global", "project"}:
                return self._send_json({"error": "Invalid destination"}, status=400)
            if not safe_name(agent):
                return self._send_json({"error": "Invalid agent"}, status=400)
            if not isinstance(source_paths, list) or not source_paths:
                return self._send_json({"error": "Select at least one global item"}, status=400)

            valid_agents = set(list_agents())
            if agent not in valid_agents:
                return self._send_json({"error": "Unknown agent"}, status=400)

            cleaned_paths = [p.strip() for p in source_paths if isinstance(p, str) and p.strip()]
            bundle = compose_selected_global_bundle(cleaned_paths, agent)
            if not bundle:
                return self._send_json({"error": "No valid global items selected for this agent"}, status=400)

            if destination == "global":
                target_file = global_target_for_agent(agent)
            else:
                target_file = project_target_for_agent(agent)
                if target_file is None:
                    return self._send_json({"error": "No writable project target for agent"}, status=400)

            target_file.parent.mkdir(parents=True, exist_ok=True)
            target_file.write_text(bundle, encoding="utf-8")

            return self._send_json(
                {
                    "ok": True,
                    "destination": destination,
                    "agent": agent,
                    "written": [str(target_file)],
                    "stdout": f"Applied selected GLOBAL items to {destination} scope for {agent}.",
                    "stderr": "",
                }
            )

        if parsed.path == "/api/render":
            ok, code, out, err = run_orkestra(["render"])
            return self._send_json(
                {
                    "ok": ok,
                    "returncode": code,
                    "stdout": out,
                    "stderr": err,
                },
                status=200 if ok else 500,
            )

        if parsed.path == "/api/apply-source":
            data = self._read_json()
            rel = str(data.get("source", "")).strip()
            if not rel:
                return self._send_json({"error": "Missing source"}, status=400)

            source_file, err = resolve_path("source", rel)
            if err or source_file is None:
                return self._send_json({"error": err or "Invalid source"}, status=400)
            if not source_file.exists() or not source_file.is_file():
                return self._send_json({"error": "Source file not found"}, status=404)

            parts = source_file.relative_to(ROOT).parts
            if not is_source_write_allowed(parts):
                return self._send_json({"error": "Source path not allowed"}, status=403)

            rendered_rel = map_source_to_rendered(rel)
            ok, code, out, err = run_orkestra(["render"])
            return self._send_json(
                {
                    "ok": ok,
                    "returncode": code,
                    "stdout": out,
                    "stderr": err,
                    "source": rel,
                    "rendered": rendered_rel,
                },
                status=200 if ok else 500,
            )

        if parsed.path == "/api/deploy":
            """
            Config-driven deployment endpoint.
            POST /api/deploy
            {
                "agent": "claude",
                "scope": "project"|"global",
                "template": "python-flask",  // optional, for {template} expansion
                "deploymentIds": ["claude-project-instructions", "claude-project-skills"]
            }
            """
            data = self._read_json()
            agent = str(data.get("agent", "")).strip()
            scope = str(data.get("scope", "")).strip()
            template = str(data.get("template", "")).strip()
            deployment_ids = data.get("deploymentIds", [])
            
            if not agent:
                return self._send_json({"error": "Missing agent"}, status=400)
            if scope not in ("global", "project"):
                return self._send_json({"error": "Invalid scope (must be 'global' or 'project')"}, status=400)
            if not deployment_ids:
                return self._send_json({"error": "No deploymentIds specified"}, status=400)
            
            # Load config
            config = load_agents_config()
            deployments = config.get("deployments", [])
            
            # Filter deployments by agent, scope, and requested IDs
            to_execute = []
            for deployment in deployments:
                dep_id = deployment.get("id", "")
                dep_agent = deployment.get("agent", "")
                dep_scope = deployment.get("scope", "")
                
                # Match criteria
                if dep_id in deployment_ids:
                    # Agent must match or be "all"
                    if dep_agent == agent or dep_agent == "all":
                        # Scope must match
                        if dep_scope == scope:
                            to_execute.append(deployment)
            
            if not to_execute:
                return self._send_json({
                    "error": f"No matching deployments found for agent={agent}, scope={scope}, ids={deployment_ids}"
                }, status=400)
            
            # Execute deployments
            results = []
            overall_success = True
            for deployment in to_execute:
                dep_id = deployment.get("id", "unknown")
                success, message = execute_deployment(deployment, template)
                results.append({
                    "id": dep_id,
                    "success": success,
                    "message": message
                })
                if not success:
                    overall_success = False
            
            return self._send_json({
                "ok": overall_success,
                "agent": agent,
                "scope": scope,
                "template": template,
                "executed": len(results),
                "results": results
            }, status=200 if overall_success else 500)

        else:
            self.send_error(404, "Not found")
            return


def bind_server(host: str, requested_port: int) -> tuple[ThreadingHTTPServer, int]:
    last_error: OSError | None = None
    max_port = min(65535, requested_port + max(0, PORT_SCAN_LIMIT))
    for candidate_port in range(requested_port, max_port + 1):
        try:
            return ThreadingHTTPServer((host, candidate_port), Handler), candidate_port
        except OSError as exc:
            last_error = exc
            if exc.errno != errno.EADDRINUSE:
                raise
            if candidate_port == requested_port:
                print(f"Port {requested_port} is already in use; trying the next available port...")
    raise last_error or OSError(f"Could not bind {host}:{requested_port}")


def main() -> None:
    global PORT
    server, bound_port = bind_server(HOST, PORT)
    PORT = bound_port
    print(f"Orkestra WebUI: http://{HOST}:{PORT}")
    print(f"Distribution root: {ROOT}")
    print(f"Project cwd: {PROJECT_DIR}")
    print(f"Press ESC or Ctrl+C to exit.")
    server.serve_forever()


if __name__ == "__main__":
    main()
