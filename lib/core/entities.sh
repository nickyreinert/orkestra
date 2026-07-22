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
        *) printf "%s\n" "$HOME/.config/orkestra" ;;
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

ork_plugin_assets_dir() {
    local scope="$1" project="$2"
    printf "%s\n" "$(ork_scope_dir "$scope" "$project")"
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

    local plugin_dir="$ORK_SOURCE_DIR/$(printf "%s" "$id" | tr "." "/")"
    local direct="$ORK_SOURCE_DIR/$plural/$name.yaml"
    local nested="$ORK_SOURCE_DIR/$(printf "%s" "$id" | tr "." "/").yaml"
    if [[ -f "$plugin_dir/manifest.yaml" ]]; then
        printf "%s\n" "$plugin_dir/manifest.yaml"
    elif [[ -f "$nested" ]]; then
        printf "%s\n" "$nested"
    elif [[ -f "$direct" ]]; then
        printf "%s\n" "$direct"
    else
        local candidate candidate_id
        while IFS= read -r candidate; do
            candidate_id="$(awk -F': *' '/^id:/{print $2; exit}' "$candidate")"
            if [[ "$candidate_id" == "$id" ]]; then
                printf "%s\n" "$candidate"
                return 0
            fi
        done < <(find "$ORK_SOURCE_DIR" -type f \( -name "manifest.yaml" -o -name "*.yaml" -o -name "*.yml" \) | sort)
        return 1
    fi
}

ork_entity_plugin_dir() {
    local file="$1"
    if [[ "$(basename "$file")" == "manifest.yaml" ]]; then
        dirname "$file"
    else
        dirname "$file"
    fi
}

ork_entity_instruction_path() {
    local file="$1" plugin_dir
    plugin_dir="$(ork_entity_plugin_dir "$file")"
    if [[ "$(basename "$file")" == "manifest.yaml" && -f "$plugin_dir/instructions.md" ]]; then
        printf "%s\n" "$plugin_dir/instructions.md"
        return 0
    fi
    return 1
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
    value="${value//\"/}"
    value="${value//\'/}"
    awk -v raw="$value" '
        BEGIN {
            n = split(raw, items, ",")
            for (i = 1; i <= n; i++) {
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", items[i])
                if (items[i] != "") print items[i]
            }
        }
    '
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
    find "$ORK_SOURCE_DIR" -mindepth 2 -type f \( -name "*.yaml" -o -name "*.yml" \) | sort | while IFS= read -r f; do
        [[ "$(basename "$f")" == "manifest.yaml" || "$f" != "$ORK_SOURCE_DIR/manifest.yaml" ]] || continue
        local id
        id="$(ork_entity_yaml_value "$f" "id")"
        [[ -n "$id" ]] && printf "%s\n" "$id"
    done
}

ork_entity_script_source_path() {
    local file="$1" entrypoint="$2"
    local local_script plugin_dir
    plugin_dir="$(ork_entity_plugin_dir "$file")"
    if [[ -f "$plugin_dir/bin/$entrypoint" ]]; then
        printf "%s\n" "$plugin_dir/bin/$entrypoint"
        return 0
    fi
    local_script="$(dirname "$file")/$entrypoint"
    if [[ -f "$local_script" ]]; then
        printf "%s\n" "$local_script"
        return 0
    fi
    if [[ -f "$ORK_HOME/content/hooks/common/$entrypoint" ]]; then
        printf "%s\n" "$ORK_HOME/content/hooks/common/$entrypoint"
        return 0
    fi
    return 1
}

ork_entity_install_script_if_needed() {
    local scope="$1" project="$2" file="$3"
    local typ executable entrypoint script_src scripts_dir script_dst
    typ="$(ork_entity_yaml_value "$file" "type")"
    executable="$(ork_entity_yaml_value "$file" "executable")"
    entrypoint="$(ork_entity_yaml_value "$file" "entrypoint")"

    [[ "$typ" == "shell" && "$executable" == "true" && -n "$entrypoint" ]] || return 0
    script_src="$(ork_entity_script_source_path "$file" "$entrypoint")" || ork_die "Script entrypoint not found: $entrypoint"
    scripts_dir="$(ork_scope_dir "$scope" "$project")/bin"
    script_dst="$scripts_dir/$entrypoint"
    mkdir -p "$scripts_dir"
    cp "$script_src" "$script_dst"
    chmod +x "$script_dst"
}

ork_entity_remove_script_if_needed() {
    local scope="$1" project="$2" file="$3"
    local typ executable entrypoint script_dst
    typ="$(ork_entity_yaml_value "$file" "type")"
    executable="$(ork_entity_yaml_value "$file" "executable")"
    entrypoint="$(ork_entity_yaml_value "$file" "entrypoint")"

    [[ "$typ" == "shell" && "$executable" == "true" && -n "$entrypoint" ]] || return 0
    script_dst="$(ork_scope_dir "$scope" "$project")/bin/$entrypoint"
    [[ -f "$script_dst" ]] && rm -f "$script_dst"
}

ork_entity_install_config_if_needed() {
    local scope="$1" project="$2" file="$3" plugin_dir config_root config_file rel destination
    [[ "$(basename "$file")" == "manifest.yaml" ]] || return 0
    plugin_dir="$(ork_entity_plugin_dir "$file")"
    config_root="$(ork_scope_dir "$scope" "$project")/config"
    for config_file in "$plugin_dir"/config.json "$plugin_dir"/config.yaml "$plugin_dir"/config.yml; do
        [[ -f "$config_file" ]] || continue
        mkdir -p "$config_root/$(basename "$plugin_dir")"
        cp "$config_file" "$config_root/$(basename "$plugin_dir")/$(basename "$config_file")"
    done
    if [[ -d "$plugin_dir/config" ]]; then
        while IFS= read -r config_file; do
            rel="${config_file#$plugin_dir/config/}"
            destination="$config_root/$(basename "$plugin_dir")/$rel"
            mkdir -p "$(dirname "$destination")"
            cp "$config_file" "$destination"
        done < <(find "$plugin_dir/config" -type f | sort)
    fi
}

ork_entity_remove_config_if_needed() {
    local scope="$1" project="$2" file="$3" plugin_dir
    [[ "$(basename "$file")" == "manifest.yaml" ]] || return 0
    plugin_dir="$(ork_entity_plugin_dir "$file")"
    rm -rf "$(ork_scope_dir "$scope" "$project")/config/$(basename "$plugin_dir")"
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

ork_entity_install_dependencies() {
    local scope="$1" project="$2" file="$3" stack="${4:-}"
    local req req_file
    while IFS= read -r req; do
        [[ -n "$req" ]] || continue
        if [[ " $stack " == *" $req "* ]]; then
            ork_die "Circular plugin dependency detected: $stack $req"
        fi
        if ork_entity_is_installed "$scope" "$project" "$req"; then
            continue
        fi
        req_file="$(ork_entity_source_path "$req")" || ork_die "Entity $(ork_entity_yaml_value "$file" "id") requires missing entity: $req"
        ork_entity_enable "$scope" "$project" "$req" "$stack $req"
    done < <(ork_entity_yaml_list_value "$file" "requires")
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
        printf "This file is managed by Orkestra. Installed plugin instructions live under \`entities/\`; tools live under \`bin/\`.\n\n"
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
    local scope="$1" project="$2" id="$3" stack="${4:-$3}"
    local file dst conflict instruction
    file="$(ork_entity_source_path "$id")" || ork_die "Entity not found: $id"

    conflict="$(ork_entity_conflict "$scope" "$project" "$file" || true)"
    [[ -z "$conflict" ]] || ork_die "Entity $id conflicts with installed entity: $conflict"

    ork_entity_install_dependencies "$scope" "$project" "$file" "$stack"

    dst="$(ork_entity_installed_path "$scope" "$project" "$id")"
    mkdir -p "$(dirname "$dst")"
    {
        printf "<!-- orkestra:entity id=%s source=%s -->\n" "$id" "${file#$ORK_HOME/}"
        if instruction="$(ork_entity_instruction_path "$file" 2>/dev/null)"; then
            cat "$instruction"
        else
            ork_entity_yaml_block "$file" "content"
        fi
        if [[ "$(ork_entity_yaml_value "$file" "type")" == "shell" ]]; then
            local entrypoint
            entrypoint="$(ork_entity_yaml_value "$file" "entrypoint")"
            [[ -n "$entrypoint" ]] && printf "\nTool: \`bin/%s\`\n" "$entrypoint"
        fi
        printf "\n"
    } > "$dst"
    ork_entity_install_script_if_needed "$scope" "$project" "$file"
    ork_entity_install_config_if_needed "$scope" "$project" "$file"
    ork_write_agents_index "$scope" "$project"
}

ork_entity_disable() {
    local scope="$1" project="$2" id="$3"
    local dst file
    file="$(ork_entity_source_path "$id" 2>/dev/null || true)"
    dst="$(ork_entity_installed_path "$scope" "$project" "$id")"
    [[ -f "$dst" ]] && rm -f "$dst"
    [[ -n "$file" ]] && ork_entity_remove_script_if_needed "$scope" "$project" "$file"
    [[ -n "$file" ]] && ork_entity_remove_config_if_needed "$scope" "$project" "$file"
    ork_write_agents_index "$scope" "$project"
}
