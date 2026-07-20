# shellcheck shell=bash
# Entity scope helpers for the AGENTS.md based orchestration model.

ORK_SOURCE_DIR="${ORK_SOURCE_DIR:-$ORK_HOME/content/source}"
export ORK_SOURCE_DIR

ork_global_scope_dir() {
    if [[ -n "${ORK_GLOBAL_SCOPE_DIR:-}" ]]; then
        printf "%s\n" "$ORK_GLOBAL_SCOPE_DIR"
        return 0
    fi

    case "$(uname -s 2>/dev/null || printf unknown)" in
        Darwin) printf "%s\n" "$HOME/Library/Application Support/orkestra" ;;
        MINGW*|MSYS*|CYGWIN*) printf "%s\n" "${APPDATA:-$HOME/AppData/Roaming}/orkestra" ;;
        *) printf "%s\n" "$HOME/.orkestra" ;;
    esac
}

ork_scope_dir() {
    local scope="${1:-project}" project="${2:-$(pwd)}"
    case "$scope" in
        source) printf "%s\n" "$ORK_SOURCE_DIR" ;;
        global) ork_global_scope_dir ;;
        project) printf "%s\n" "$project/.orkestra" ;;
        *) return 1 ;;
    esac
}

ork_agents_index_path() {
    local scope="${1:-project}" project="${2:-$(pwd)}"
    printf "%s/AGENTS.md\n" "$(ork_scope_dir "$scope" "$project")"
}

ork_entities_install_dir() {
    local scope="${1:-project}" project="${2:-$(pwd)}"
    printf "%s/entities\n" "$(ork_scope_dir "$scope" "$project")"
}

ork_entity_rel_path() {
    local id="$1"
    printf "entities/%s.md\n" "$(printf "%s" "$id" | tr "." "/")"
}

ork_entity_installed_path() {
    local scope="$1" project="$2" id="$3"
    printf "%s/%s.md\n" "$(ork_entities_install_dir "$scope" "$project")" "$(printf "%s" "$id" | tr "." "/")"
}

ork_entity_source_path() {
    local id="$1"
    local category="${id%%.*}"
    local name="${id#*.}"
    local plural="$category"
    case "$category" in
        style) plural="styles" ;;
        topology) plural="topologies" ;;
        skill) plural="skills" ;;
        workflow) plural="workflows" ;;
        hook) plural="hooks" ;;
        agent-style) plural="agent-styles" ;;
        general) plural="general" ;;
    esac

    local direct="$ORK_SOURCE_DIR/$plural/$name.yaml"
    local nested="$ORK_SOURCE_DIR/${id//./\/}.yaml"
    if [[ -f "$direct" ]]; then
        printf "%s\n" "$direct"
    elif [[ -f "$nested" ]]; then
        printf "%s\n" "$nested"
    else
        return 1
    fi
}

ork_entity_yaml_value() {
    local file="$1" key="$2"
    awk -v key="$key" '
        $0 ~ "^" key ":[[:space:]]*" {
            sub("^[^:]+:[[:space:]]*", "")
            gsub(/^["'\'']|["'\'']$/, "")
            print
            exit
        }
    ' "$file"
}

ork_entity_yaml_list_value() {
    local file="$1" key="$2"
    local value
    value="$(ork_entity_yaml_value "$file" "$key")"
    value="${value#[}"
    value="${value%]}"
    value="${value//,/ }"
    value="${value//\"/}"
    value="${value//\'/}"
    printf "%s\n" "$value"
}

ork_entity_yaml_block() {
    local file="$1" key="$2"
    awk -v key="$key" '
        $0 ~ "^" key ":[[:space:]]*\\|[[:space:]]*$" { in_block=1; next }
        in_block && /^[^[:space:]]/ { exit }
        in_block {
            sub(/^  /, "")
            print
        }
    ' "$file"
}

ork_list_entities() {
    [[ -d "$ORK_SOURCE_DIR" ]] || return 0
    find "$ORK_SOURCE_DIR" -mindepth 2 -maxdepth 2 -type f \( -name "*.yaml" -o -name "*.yml" \) | sort | while IFS= read -r f; do
        local id
        id="$(ork_entity_yaml_value "$f" "id")"
        [[ -n "$id" ]] && printf "%s\n" "$id"
    done
}

ork_entity_is_installed() {
    local scope="$1" project="$2" id="$3"
    [[ -f "$(ork_entity_installed_path "$scope" "$project" "$id")" ]]
}

ork_entity_conflict() {
    local scope="$1" project="$2" file="$3"
    local conflict
    for conflict in $(ork_entity_yaml_list_value "$file" "conflicts_with"); do
        [[ -z "$conflict" ]] && continue
        if ork_entity_is_installed "$scope" "$project" "$conflict"; then
            printf "%s\n" "$conflict"
            return 0
        fi
    done
    return 1
}

ork_entity_requirements_missing() {
    local scope="$1" project="$2" file="$3"
    local req missing=0
    for req in $(ork_entity_yaml_list_value "$file" "requires"); do
        [[ -z "$req" ]] && continue
        if ! ork_entity_is_installed "$scope" "$project" "$req"; then
            printf "%s\n" "$req"
            missing=1
        fi
    done
    return "$missing"
}

ork_write_agents_index() {
    local scope="$1" project="$2"
    local scope_dir index entities_dir
    scope_dir="$(ork_scope_dir "$scope" "$project")"
    index="$(ork_agents_index_path "$scope" "$project")"
    entities_dir="$(ork_entities_install_dir "$scope" "$project")"
    mkdir -p "$scope_dir" "$entities_dir"

    {
        printf "<!-- orkestra:generated scope=%s -->\n" "$scope"
        printf "# Orkestra Agents Index\n\n"
        printf "This file is managed by Orkestra. Installed entities live under \`entities/\`.\n\n"
        printf "## Installed Entities\n\n"
        if find "$entities_dir" -type f -name "*.md" | grep -q .; then
            while IFS= read -r f; do
                local rel id
                rel="${f#$scope_dir/}"
                id="${rel#entities/}"
                id="${id%.md}"
                id="${id//\//.}"
                printf -- "- \`%s\` -> \`%s\`\n" "$id" "$rel"
            done < <(find "$entities_dir" -type f -name "*.md" | sort)
            printf "\n## Imports\n\n"
            while IFS= read -r f; do
                local rel
                rel="${f#$scope_dir/}"
                printf "@import \"./%s\"\n" "$rel"
            done < <(find "$entities_dir" -type f -name "*.md" | sort)
        else
            printf "_No entities installed._\n"
        fi
    } > "$index"
}

ork_write_agent_hook() {
    local scope="$1" project="$2" agent="$3"
    local target import_path

    if [[ "$scope" == "global" ]]; then
        case "$agent" in
            claude) target="$HOME/CLAUDE.md"; import_path="$(ork_agents_index_path global "$project")" ;;
            codex) target="$HOME/AGENTS.md"; import_path="$(ork_agents_index_path global "$project")" ;;
            copilot) target="$HOME/.github/copilot-instructions.md"; import_path="$(ork_agents_index_path global "$project")" ;;
            cursor) target="$HOME/.cursorrules"; import_path="$(ork_agents_index_path global "$project")" ;;
            cline) target="$HOME/.clinerules"; import_path="$(ork_agents_index_path global "$project")" ;;
            aider) target="$HOME/.aider/CONVENTIONS.md"; import_path="$(ork_agents_index_path global "$project")" ;;
            *) return 0 ;;
        esac
    else
        case "$agent" in
            claude) target="$project/CLAUDE.md"; import_path="./.orkestra/AGENTS.md" ;;
            codex) target="$project/AGENTS.md"; import_path="./.orkestra/AGENTS.md" ;;
            copilot) target="$project/.github/copilot/instructions.md"; import_path="../../.orkestra/AGENTS.md" ;;
            cursor) target="$project/.cursorrules"; import_path="./.orkestra/AGENTS.md" ;;
            cline) target="$project/.clinerules"; import_path="./.orkestra/AGENTS.md" ;;
            aider) target="$project/CONVENTIONS.md"; import_path="./.orkestra/AGENTS.md" ;;
            *) return 0 ;;
        esac
    fi

    mkdir -p "$(dirname "$target")"
    {
        printf "<!-- orkestra:generated agent=%s scope=%s -->\n" "$agent" "$scope"
        printf "# Orkestra hook\n\n"
        printf "@import \"%s\"\n" "$import_path"
    } > "$target"
}

ork_write_agent_hooks() {
    local scope="$1" project="$2"; shift 2
    local agent
    for agent in "$@"; do
        [[ -n "$agent" ]] && ork_write_agent_hook "$scope" "$project" "$agent"
    done
}

ork_entity_enable() {
    local scope="$1" project="$2" id="$3"
    local file dst conflict missing
    file="$(ork_entity_source_path "$id")" || ork_die "Entity not found: $id"

    conflict="$(ork_entity_conflict "$scope" "$project" "$file" || true)"
    [[ -z "$conflict" ]] || ork_die "Entity $id conflicts with installed entity: $conflict"

    missing="$(ork_entity_requirements_missing "$scope" "$project" "$file" || true)"
    [[ -z "$missing" ]] || ork_die "Entity $id requires missing entity: $missing"

    dst="$(ork_entity_installed_path "$scope" "$project" "$id")"
    mkdir -p "$(dirname "$dst")"
    {
        printf "<!-- orkestra:entity id=%s source=%s -->\n" "$id" "${file#$ORK_HOME/}"
        ork_entity_yaml_block "$file" "content"
        printf "\n"
    } > "$dst"
    ork_write_agents_index "$scope" "$project"
}

ork_entity_disable() {
    local scope="$1" project="$2" id="$3"
    local dst
    dst="$(ork_entity_installed_path "$scope" "$project" "$id")"
    [[ -f "$dst" ]] && rm -f "$dst"
    ork_write_agents_index "$scope" "$project"
}
