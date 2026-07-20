# shellcheck shell=bash
# Minimal manifest helpers. Pure Bash; no yq/jq.
# The manifest lives at <project>/.orkestra/manifest.yaml and is mostly
# written by us, so we control its formatting.

ork_sha256() {
    local f="$1"
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$f" | awk '{print $1}'
    elif command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$f" | awk '{print $1}'
    else
        ork_die "Need shasum or sha256sum on PATH"
    fi
}

# ork_manifest_init <project_dir> <template> <agents-newline-separated>
ork_manifest_init() {
    local project="$1" tmpl="$2" agents="$3"
    local f="$project/.orkestra/manifest.yaml"
    {
        printf "orkestra_version: %s\n" "$ORK_VERSION"
        printf "template: %s\n" "$tmpl"
        printf "agents:\n"
        while IFS= read -r a; do
            [[ -z "$a" ]] && continue
            printf "  - %s\n" "$a"
        done <<< "$agents"
        printf "sources: []\n"
        printf "adapters: {}\n"
    } > "$f"
}

ork_manifest_path() {
    printf "%s\n" "$1/.orkestra/manifest.yaml"
}

# Append a "hooks_installed: true" marker to manifest.yaml after hook install.
ork_manifest_set_hooks_installed() {
    local project="$1"
    local mf; mf="$(ork_manifest_path "$project")"
    [[ -f "$mf" ]] || return 0
    if grep -q '^hooks_installed:' "$mf" 2>/dev/null; then
        sed -i.bak 's/^hooks_installed:.*/hooks_installed: true/' "$mf" && rm -f "${mf}.bak"
    else
        printf "hooks_installed: true\n" >> "$mf"
    fi
}
