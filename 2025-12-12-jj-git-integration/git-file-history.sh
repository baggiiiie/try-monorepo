#!/bin/bash

# Script to show all commits that modified a file or specific lines in a file
# with fzf preview showing the diff
# Usage:
#   ./git-file-history.sh <file_path>
#   ./git-file-history.sh <file_path> <start_line>[,<end_line>]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

script_name=$(basename "$0")
# Function to display usage
usage() {
    echo "Usage: $script_name [options] <file_path> [line_range]"
    echo ""
    echo "Options:"
    echo "  -g, --grep <text>           Only show commits where the diff contains <text>"
    echo ""
    echo "Examples:"
    echo "  $script_name src/main.py                    # Show all commits for the file"
    echo "  $script_name -g 'fix bug' src/main.py       # Show commits with 'fix bug' in diff"
    echo "  $script_name src/main.py 42                 # Show commits affecting line 42"
    echo "  $script_name src/main.py 42,50              # Show commits affecting lines 42-50"
    echo "  $script_name src/main.py :function_name     # Show commits affecting function_name"
    echo ""
    exit 1
}

# Check if fzf is installed
if ! command -v fzf &>/dev/null; then
    echo -e "${RED}Error: fzf is not installed${NC}"
    echo "Install it with: brew install fzf (macOS) or apt install fzf (Ubuntu)"
    exit 1
fi

# Check if git repository
if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo -e "${RED}Error: Not a git repository${NC}"
    exit 1
fi

# Check arguments
if [ $# -lt 1 ]; then
    usage
fi

FILE_PATH=""
LINE_RANGE=""
GREP_TEXT=""

# Manual argument parsing
while [[ $# -gt 0 ]]; do
    case $1 in
        -g|--grep)
            if [ -n "$2" ]; then
                GREP_TEXT="$2"
                shift 2
            else
                echo -e "${RED}Error: --grep requires an argument${NC}"
                exit 1
            fi
            ;;
        -h|--help)
            usage
            ;;
        *)
            if [ -z "$FILE_PATH" ]; then
                FILE_PATH="$1"
            elif [ -z "$LINE_RANGE" ]; then
                LINE_RANGE="$1"
            else
                echo -e "${RED}Error: Unknown argument '$1'${NC}"
                usage
            fi
            shift
            ;;
    esac
done

if [ -z "$FILE_PATH" ]; then
    usage
fi

# Check if file exists or existed in history
if [ ! -f "$FILE_PATH" ] && ! git log --oneline -1 -- "$FILE_PATH" >/dev/null 2>&1 || [ -z "$(git log --oneline -1 -- "$FILE_PATH" 2>/dev/null)" ]; then
    echo -e "${RED}Error: File '$FILE_PATH' not found in repository history${NC}"
    exit 1
fi

# Function to show commits for entire file with fzf
show_file_commits_fzf() {
    local file="$1"
    local grep_args=()
    if [ -n "$GREP_TEXT" ]; then
        grep_args=("-G$GREP_TEXT")
    fi

    echo -e "${GREEN}Loading commits for: ${BLUE}$file${NC}"
    [ -n "$GREP_TEXT" ] && echo -e "${GREEN}Filtering by diff containing: ${YELLOW}$GREP_TEXT${NC}"
    echo -e "${YELLOW}Use arrow keys to navigate, Enter to view full commit, Esc to exit${NC}\n"

    git log --follow "${grep_args[@]}" --color=always --format="%C(yellow)%h%C(reset) %C(cyan)%an%C(reset) %C(green)%ar%C(reset)" -- "$file" |
        fzf --ansi \
            --no-sort \
            --reverse \
            --tiebreak=index \
            --preview "export GIT_EXTERNAL_DIFF='difft --color=always'; export DFT_WIDTH=\$FZF_PREVIEW_COLUMNS; echo {} | grep -o '^[a-f0-9]\+' | head -1 | xargs -I @ git show --color=always --ext-diff @ -- \"$file\"" \
            --preview-window=right:80%:wrap \
            --bind "ctrl-d:preview-half-page-down,ctrl-u:preview-half-page-up" \
            --bind "enter:execute(commit=\$(echo {} | grep -o '^[a-f0-9]\+' | head -1); echo \"Running: gh br $file --commit=\$commit\"; gh br $file --commit=\$commit)" \
            --header="$file | Enter: full commit"
    # --bind "enter:become(echo {} | grep -o '^[a-f0-9]\+' | head -1 | xargs -I {} git show --ext-diff {} -- $file)"
}

# Function to show commits for specific lines with fzf
show_line_commits_fzf() {
    local file="$1"
    local range="$2"
    # TODO: mabey add a start line to `gh br $file:start_line` ?
    # if ! grep -q ',' <<<"$range"; then
    #     start_line=$(echo "$range" | cut -d',' -f1)
    # fi
    local grep_args=()
    if [ -n "$GREP_TEXT" ]; then
        grep_args=("-G$GREP_TEXT")
    fi

    echo -e "${GREEN}Loading commits for lines ${BLUE}$range${GREEN} in: ${BLUE}$file${NC}"
    [ -n "$GREP_TEXT" ] && echo -e "${GREEN}Filtering by diff containing: ${YELLOW}$GREP_TEXT${NC}"
    echo -e "${YELLOW}Use arrow keys to navigate, Enter to view full commit, Esc to exit${NC}\n"

    # Get commits that touched the line range
    git log "${grep_args[@]}" -L "$range":"$file" --format="%C(yellow)%h%C(reset) %C(cyan)%an%C(reset) %C(green)%ar%C(reset)" --no-patch 2>/dev/null |
        fzf --ansi \
            --no-sort \
            --reverse \
            --tiebreak=index \
            --preview "export GIT_EXTERNAL_DIFF='difft --color=always'; export DFT_WIDTH=\$FZF_PREVIEW_COLUMNS; echo {} | grep -o '^[a-f0-9]\+' | head -1 | xargs -I @ git show --ext-diff --color=always @ -L $range:$file" \
            --preview-window=right:60%:wrap \
            --bind "ctrl-d:preview-half-page-down,ctrl-u:preview-half-page-up" \
            --bind "enter:execute(commit=\$(echo {} | grep -o '^[a-f0-9]\+' | head -1); echo \"Running: gh br $file --commit=\$commit\"; gh br $file --commit=\$commit)" \
            --header="$range in $file | Enter: full commit"
}

echo "if the commit history is not expected, maybe the local git is a shallow clone."
echo "run 'git rev-parse --is-shallow-repository' to check"
echo "and run Try 'git fetch --unshallow' to get full history."

# Main logic
if [ -z "$LINE_RANGE" ]; then
    # No line range specified, show all commits for the file
    show_file_commits_fzf "$FILE_PATH"
else
    # Line range specified
    show_line_commits_fzf "$FILE_PATH" "$LINE_RANGE"
fi
