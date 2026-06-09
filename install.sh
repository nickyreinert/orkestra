#!/bin/bash
set -euo pipefail

REPO_URL="https://github.com/nickyreinert/orkestra.git"
DEFAULT_INSTALL_DIR="$HOME/.orkestra"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

INSTALL_DIR="$DEFAULT_INSTALL_DIR"
SOURCE_MODE="github"

usage() {
    cat <<EOF
Usage: ./install.sh [options]

Default behavior:
  - Install/update Orkestra in ~/.orkestra from GitHub.

Options:
  --target <dir>   Install directory (default: ~/.orkestra)
  --from-local     Install/update from the current local checkout
  -h, --help       Show this help
EOF
}

ensure_local_git_repo() {
    local dir="$1"
    if [ -d "$dir/.git" ]; then
        return 0
    fi

    echo "Initializing local git repository in $dir..."
    git -C "$dir" init >/dev/null 2>&1
}

commit_local_snapshot_if_needed() {
    local dir="$1"

    if ! git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        return 0
    fi

    # Snapshot only when there are real changes.
    if [ -z "$(git -C "$dir" status --porcelain)" ]; then
        return 0
    fi

    git -C "$dir" add -A
    if git -C "$dir" commit -m "chore(install): sync local Orkestra snapshot" >/dev/null 2>&1; then
        echo "Committed local install snapshot."
    else
        echo "Warning: could not create git commit (likely missing git user.name/user.email)."
    fi
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target)
            INSTALL_DIR="$2"
            shift 2
            ;;
        --from-local)
            SOURCE_MODE="local"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

echo "Installing to $INSTALL_DIR..."

if [[ "$SOURCE_MODE" == "github" ]]; then
    if [ -d "$INSTALL_DIR/.git" ]; then
        echo "Directory $INSTALL_DIR already exists. Updating from GitHub..."
        git -C "$INSTALL_DIR" fetch --prune
        if git -C "$INSTALL_DIR" rev-parse --verify origin/main >/dev/null 2>&1; then
            git -C "$INSTALL_DIR" checkout main >/dev/null 2>&1 || true
            git -C "$INSTALL_DIR" pull --ff-only origin main
        else
            git -C "$INSTALL_DIR" pull --ff-only
        fi
    else
        if [ -d "$INSTALL_DIR" ]; then
            echo "Error: $INSTALL_DIR exists but is not a git checkout."
            echo "Please remove it or choose another target via --target <dir>."
            exit 1
        fi
        echo "Cloning Orkestra..."
        git clone "$REPO_URL" "$INSTALL_DIR"
    fi
else
    if [ ! -f "$SCRIPT_DIR/bin/orkestra" ]; then
        echo "Error: --from-local requires running inside the Orkestra repo"
        echo "(missing $SCRIPT_DIR/bin/orkestra)."
        exit 1
    fi

    echo "Installing from local checkout: $SCRIPT_DIR"
    mkdir -p "$INSTALL_DIR"

    if command -v rsync >/dev/null 2>&1; then
        rsync -a --delete --exclude ".git" "$SCRIPT_DIR/" "$INSTALL_DIR/"
    else
        # Fallback without rsync
        rm -rf "$INSTALL_DIR"
        mkdir -p "$INSTALL_DIR"
        cp -R "$SCRIPT_DIR/." "$INSTALL_DIR/"
        rm -rf "$INSTALL_DIR/.git"
    fi

    # Keep local installs versioned so update/adjust cycles are traceable.
    ensure_local_git_repo "$INSTALL_DIR"
    commit_local_snapshot_if_needed "$INSTALL_DIR"
fi

BIN_DIR="$INSTALL_DIR/bin"
ENTRYPOINT="$BIN_DIR/orkestra"

# Ensure a callable 'orkestra' entrypoint exists.
# If the checkout is still on legacy layout, bootstrap a thin wrapper.
if [ ! -f "$BIN_DIR/orkestra" ]; then
    if [ -f "$BIN_DIR/init-orkestra" ] || [ -f "$BIN_DIR/init-orkestra.sh" ]; then
        echo "No v2 entrypoint found; creating compatibility wrapper '$BIN_DIR/orkestra'."
        cat > "$BIN_DIR/orkestra" <<'EOF'
#!/bin/bash
set -e

BIN_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -x "$BIN_DIR/init-orkestra" ]; then
    exec "$BIN_DIR/init-orkestra" "$@"
elif [ -x "$BIN_DIR/init-orkestra.sh" ]; then
    exec "$BIN_DIR/init-orkestra.sh" "$@"
else
    echo "Error: Neither init-orkestra nor init-orkestra.sh is available."
    exit 1
fi
EOF
    else
        echo "Error: Missing $BIN_DIR/orkestra"
        echo "No compatible entrypoint found in this checkout."
        exit 1
    fi
fi

chmod +x "$ENTRYPOINT"
chmod +x "$INSTALL_DIR"/lib/cli/*.sh           2>/dev/null || true
chmod +x "$INSTALL_DIR"/lib/scripts/*.sh       2>/dev/null || true
chmod +x "$INSTALL_DIR"/adapters/*/adapter.sh  2>/dev/null || true

# Create a real CLI command via symlink in a common bin location.
CLI_LINK_TARGET=""
for candidate in "$HOME/.local/bin" "$HOME/bin" "/usr/local/bin"; do
    parent_dir="$candidate"

    # Create user-local dirs automatically; system dirs only if they already exist.
    if [[ "$candidate" == "$HOME/.local/bin" ]] || [[ "$candidate" == "$HOME/bin" ]]; then
        mkdir -p "$candidate"
    elif [ ! -d "$candidate" ]; then
        continue
    fi

    if [ -w "$candidate" ] || { [ -e "$candidate/orkestra" ] && [ -w "$candidate/orkestra" ]; }; then
        ln -sfn "$ENTRYPOINT" "$candidate/orkestra"
        CLI_LINK_TARGET="$candidate"
        echo "Linked CLI command: $candidate/orkestra -> $ENTRYPOINT"
        break
    fi
done

# Detect shell config file
SHELL_CONFIG=""
case "$SHELL" in
*/zsh)
    SHELL_CONFIG="$HOME/.zshrc"
    ;;
*/bash)
    # Prefer .bashrc if it exists, otherwise .bash_profile, otherwise default based on OS
    if [ -f "$HOME/.bashrc" ]; then
        SHELL_CONFIG="$HOME/.bashrc"
    elif [ -f "$HOME/.bash_profile" ]; then
        SHELL_CONFIG="$HOME/.bash_profile"
    else
        if [[ "$OSTYPE" == "darwin"* ]]; then
            SHELL_CONFIG="$HOME/.bash_profile"
        else
            SHELL_CONFIG="$HOME/.bashrc"
        fi
    fi
    ;;
*)
    # Fallback for other shells or if SHELL is not set
    if [ -f "$HOME/.zshrc" ]; then
        SHELL_CONFIG="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then
        SHELL_CONFIG="$HOME/.bashrc"
    elif [ -f "$HOME/.bash_profile" ]; then
        SHELL_CONFIG="$HOME/.bash_profile"
    else
        # Default fallback
        SHELL_CONFIG="$HOME/.profile"
    fi
    ;;
esac

# Ensure config file exists to avoid grep errors
if [ ! -f "$SHELL_CONFIG" ]; then
    touch "$SHELL_CONFIG"
fi

# Ensure whichever location holds the callable command is on PATH.
PATH_ENTRY="$BIN_DIR"
if [ -n "$CLI_LINK_TARGET" ]; then
    PATH_ENTRY="$CLI_LINK_TARGET"
fi

if grep -q "$PATH_ENTRY" "$SHELL_CONFIG"; then
    echo "Orkestra command path is already in PATH in $SHELL_CONFIG"
else
    echo "" >> "$SHELL_CONFIG"
    echo "# Orkestra CLI" >> "$SHELL_CONFIG"
    echo "export PATH=\"\$PATH:$PATH_ENTRY\"" >> "$SHELL_CONFIG"
    echo "Added Orkestra command path to PATH in $SHELL_CONFIG"
fi

echo "Installation complete!"
echo "Please restart your terminal or run 'source $SHELL_CONFIG'"
echo "Then run 'orkestra' in any project to set up the workflow."
