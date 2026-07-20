#!/usr/bin/env python3
from __future__ import annotations

import json
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
AUTO_RELOAD_SERVER = os.environ.get("ORKESTRA_WEBUI_AUTO_RELOAD_SERVER", "1") == "1"

WEBUI_WATCH_FILES = [
    WEBUI_DIR / "index.html",
    WEBUI_DIR / "app.js",
    WEBUI_DIR / "styles.css",
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
ENTITY_CATEGORY_ORDER = ["style", "topology", "skill", "workflow", "hook", "agent-style", "general"]


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
        "styles": "style",
        "topologies": "topology",
        "skills": "skill",
        "workflows": "workflow",
        "hooks": "hook",
        "agent-styles": "agent-style",
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

    category = normalize_entity_category(str(data.get("category") or entity_id.split(".", 1)[0]))
    rel_path = path.relative_to(ROOT).as_posix()
    content = str(data.get("content") or "")
    compatibility = data.get("compatibility") if isinstance(data.get("compatibility"), dict) else {}

    def list_value(value) -> list[str]:
        if isinstance(value, list):
            return [str(v) for v in value]
        if isinstance(value, str):
            return [v.strip() for v in value.strip("[]").split(",") if v.strip()]
        return []

    return {
        "id": entity_id,
        "name": str(data.get("name") or entity_id),
        "category": category,
        "version": str(data.get("version") or ""),
        "author": str(data.get("author") or ""),
        "description": str(data.get("description") or "").strip(),
        "agents": list_value(compatibility.get("agents")),
        "scopes": list_value(compatibility.get("scopes")),
        "conflictsWith": list_value(data.get("conflicts_with")),
        "requires": list_value(data.get("requires")),
        "tags": list_value(data.get("tags")),
        "content": content,
        "path": rel_path,
    }


def entity_installed_path(scope: str, entity_id: str) -> Path:
    rel = Path(*entity_id.split(".")).with_suffix(".md")
    if scope == "global":
        if sys.platform == "darwin":
            base = HOME_DIR / "Library" / "Application Support" / "orkestra"
        elif os.name == "nt":
            base = Path(os.environ.get("APPDATA", str(HOME_DIR / "AppData" / "Roaming"))) / "orkestra"
        else:
            base = HOME_DIR / ".orkestra"
    else:
        base = PROJECT_DIR / ".orkestra"
    return base / "entities" / rel


def collect_entities_index() -> dict:
    source_dir = ROOT / "content" / "source"
    entities: list[dict] = []
    if source_dir.exists():
        for path in sorted(source_dir.rglob("*.y*ml")):
            entity = parse_entity_file(path)
            if not entity:
                continue
            installed = {
                "project": entity_installed_path("project", entity["id"]).exists(),
                "global": entity_installed_path("global", entity["id"]).exists(),
            }
            entity["installed"] = installed
            entities.append(entity)

    categories: dict[str, list[dict]] = {}
    for entity in entities:
        categories.setdefault(entity["category"], []).append(entity)

    ordered_categories = [
        {"id": cat, "label": cat.replace("-", " ").title(), "entities": categories[cat]}
        for cat in ENTITY_CATEGORY_ORDER
        if cat in categories
    ]
    for cat in sorted(set(categories) - set(ENTITY_CATEGORY_ORDER)):
        ordered_categories.append({"id": cat, "label": cat.replace("-", " ").title(), "entities": categories[cat]})

    return {
        "entities": entities,
        "categories": ordered_categories,
        "agents": list_agents(),
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


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Orkestra WebUI: http://{HOST}:{PORT}")
    print(f"Distribution root: {ROOT}")
    print(f"Project cwd: {PROJECT_DIR}")
    server.serve_forever()


if __name__ == "__main__":
    main()
