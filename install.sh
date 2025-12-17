#!/bin/bash
set -e

REPO_URL="https://github.com/nickyreinert/orkestra.git"
DEFAULT_INSTALL_DIR="$HOME/.orkestra"

# Determine where we are installing from/to
if [ -d ".orkestra" ] && [ -f "bin/init-orkestra.sh" ]; then
    # We are running from inside the repo
    INSTALL_DIR="$(pwd)"
    echo "Installing from current directory: $INSTALL_DIR"
else
    # We are running as a standalone script (e.g. via curl) or outside the repo
    INSTALL_DIR="$DEFAULT_INSTALL_DIR"
    echo "Installing to $INSTALL_DIR..."
    
    if [ -d "$INSTALL_DIR" ]; then
        echo "Directory $INSTALL_DIR already exists. Updating..."
        cd "$INSTALL_DIR" && git pull
    else
        echo "Cloning Orkestra..."
        git clone "$REPO_URL" "$INSTALL_DIR"
    fi
fi

BIN_DIR="$INSTALL_DIR/bin"

# Make the init script executable
chmod +x "$BIN_DIR/init-orkestra.sh"

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

# Check if already in path
if grep -q "$BIN_DIR" "$SHELL_CONFIG"; then
    echo "Orkestra is already in your PATH in $SHELL_CONFIG"
else
    echo "" >> "$SHELL_CONFIG"
    echo "# Orkestra CLI" >> "$SHELL_CONFIG"
    echo "export PATH=\"\$PATH:$BIN_DIR\"" >> "$SHELL_CONFIG"
    echo "Added Orkestra to PATH in $SHELL_CONFIG"
fi

echo "Installation complete!"
echo "Please restart your terminal or run 'source $SHELL_CONFIG'"
echo "Then run 'init-orkestra.sh' in any project to set up the workflow."
