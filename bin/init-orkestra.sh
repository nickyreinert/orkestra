#!/bin/bash
set -e

# --- Colors & Formatting ---
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# --- Helper Functions ---

# Interactive Menu
# Usage: menu "Prompt Text" "OutputVariable" "Option1" "Option2" ...
function menu {
    local prompt="$1"
    local outvar="$2"
    shift
    shift
    local options=("$@")
    local cur=0
    local count=${#options[@]}
    local index=0
    local esc=$(printf "\033")
    local key=""

    # Hide cursor
    printf "\033[?25l"

    # Print prompt
    printf "${GREEN}${BOLD}$prompt${NC}\n"

    while true; do
        index=0 
        for o in "${options[@]}"; do
            if [ "$index" == "$cur" ]; then
                printf "  ${CYAN}${BOLD}> $o${NC}\033[K\n"
            else
                printf "    $o\033[K\n"
            fi
            index=$((index + 1))
        done

        # Read input
        read -rsn1 key
        if [[ "$key" == "$esc" ]]; then
            read -rsn2 key
            if [[ "$key" == "[A" ]]; then # Up
                cur=$((cur - 1))
                [ "$cur" -lt 0 ] && cur=$((count - 1))
            elif [[ "$key" == "[B" ]]; then # Down
                cur=$((cur + 1))
                [ "$cur" -ge "$count" ] && cur=0
            fi
        elif [[ "$key" == "" ]]; then # Enter
            break
        fi
        
        # Move cursor up to redraw
        printf "\033[${count}A"
    done

    # Show cursor
    printf "\033[?25h"
    
    # Return selected value
    eval "$outvar='${options[$cur]}'"
}

# --- Main Script ---

# Determine source directory
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo -e "${BLUE}${BOLD}"
echo "   ___       _             _             "
echo "  / _ \ _ __| | _____  ___| |_ _ __ __ _ "
echo " | | | | '__| |/ / _ \/ __| __| '__/ _\` |"
echo " | |_| | |  |   <  __/\__ \ |_| | | (_| |"
echo "  \___/|_|  |_|\_\___||___/\__|_|  \__,_|"
echo -e "${NC}"
echo -e "${YELLOW}  Orchestration Framework for VS Code Copilot${NC}"
echo ""

# 1. Select Installation Location
menu "Where would you like to initialize the project?" LOCATION_OPT "Current Directory" "New Directory"

if [ "$LOCATION_OPT" == "New Directory" ]; then
    echo ""
    echo -e "${GREEN}Enter the name of the new directory:${NC}"
    read -r PROJECT_NAME
    if [ -z "$PROJECT_NAME" ]; then
        echo -e "${RED}Error: Project name cannot be empty.${NC}"
        exit 1
    fi
    TARGET_DIR="$(pwd)/$PROJECT_NAME"
    
    if [ -d "$TARGET_DIR" ]; then
        echo -e "${RED}Error: Directory '$PROJECT_NAME' already exists.${NC}"
        exit 1
    fi
    mkdir -p "$TARGET_DIR"
    echo -e "${CYAN}Created directory: $TARGET_DIR${NC}"
else
    TARGET_DIR="$(pwd)"
fi

echo ""

# 2. Select Flavor
# Get available flavors
FLAVORS=($(ls "$SOURCE_DIR/.orkestra/flavors"))

if [ ${#FLAVORS[@]} -eq 0 ]; then
    echo -e "${RED}Error: No flavors found in $SOURCE_DIR/.orkestra/flavors${NC}"
    exit 1
fi

menu "Select a project flavor:" SELECTED_FLAVOR "${FLAVORS[@]}"

FLAVOR_DIR="$SOURCE_DIR/.orkestra/flavors/$SELECTED_FLAVOR"
echo ""
echo -e "Initializing with flavor: ${CYAN}$SELECTED_FLAVOR${NC}..."

# 3. Copy Files
# Use rsync if available
if command -v rsync >/dev/null 2>&1; then
    # 1. Copy flavor-specific files
    mkdir -p "$TARGET_DIR/.orkestra"
    rsync -av --exclude='.DS_Store' "$FLAVOR_DIR/" "$TARGET_DIR/.orkestra/" > /dev/null
        
    # 2. Copy scripts (shared)
    mkdir -p "$TARGET_DIR/.orkestra/scripts"
    rsync -av --exclude='.DS_Store' "$SOURCE_DIR/.orkestra/scripts/" "$TARGET_DIR/.orkestra/scripts/" > /dev/null
else
    # Fallback
    mkdir -p "$TARGET_DIR/.orkestra"
    cp -r "$FLAVOR_DIR/"* "$TARGET_DIR/.orkestra/"
    mkdir -p "$TARGET_DIR/.orkestra/scripts"
    cp -r "$SOURCE_DIR/.orkestra/scripts/"* "$TARGET_DIR/.orkestra/scripts/"
fi

# 3. Copy .github/copilot-instructions.md (Shared)
mkdir -p "$TARGET_DIR/.github"
if [ ! -f "$TARGET_DIR/.github/copilot-instructions.md" ]; then
    cp "$SOURCE_DIR/.github/copilot-instructions.md" "$TARGET_DIR/.github/"
fi

# 4. Copy .vscode/tasks.json (Shared)
mkdir -p "$TARGET_DIR/.vscode"
if [ ! -f "$TARGET_DIR/.vscode/tasks.json" ]; then
    if [ -f "$SOURCE_DIR/.vscode/tasks.json" ]; then
        cp "$SOURCE_DIR/.vscode/tasks.json" "$TARGET_DIR/.vscode/"
    fi
fi

echo -e "${GREEN}✔ Files installed successfully.${NC}"
echo ""

# 4. Git Initialization
menu "Initialize a Git repository?" GIT_OPT "Yes" "No"

if [ "$GIT_OPT" == "Yes" ]; then
    echo ""
    if [ -d "$TARGET_DIR/.git" ]; then
        echo -e "${YELLOW}Git repository already exists.${NC}"
    else
        git init "$TARGET_DIR" > /dev/null
        echo -e "${GREEN}✔ Git repository initialized.${NC}"
        
        # Create .gitignore if it doesn't exist
        if [ ! -f "$TARGET_DIR/.gitignore" ]; then
            echo ".orkestra/state.json" >> "$TARGET_DIR/.gitignore"
            echo ".orkestra/outputs/" >> "$TARGET_DIR/.gitignore"
            echo ".orkestra/tmp/" >> "$TARGET_DIR/.gitignore"
            echo -e "${CYAN}Created default .gitignore${NC}"
        fi
    fi
fi

echo ""
echo -e "${BLUE}${BOLD}--- Next Steps ---${NC}"
echo ""
echo -e "1. ${BOLD}CLI Agents:${NC} If you plan to use external tools (Gemini, Mistral, etc.),"
echo -e "   edit ${YELLOW}.orkestra/config.yaml${NC} and ensure the CLI tools are installed in your PATH."
echo -e "   You can configure arguments and output parsers there."
echo ""
echo -e "2. ${BOLD}Start Workflow:${NC} Open the project in VS Code and run the task:"
echo -e "   ${CYAN}Orkestra: Start Workflow${NC}"
echo ""
if [ "$LOCATION_OPT" == "New Directory" ]; then
    echo -e "   ${YELLOW}cd $PROJECT_NAME${NC}"
fi
echo ""
echo -e "${GREEN}Happy Orchestrating!${NC}"

