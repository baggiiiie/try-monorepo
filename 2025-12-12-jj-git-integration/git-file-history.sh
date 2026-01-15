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

# Function to display usage
usage() {
    echo "Usage: $0 <file_path> [line_range]"
    echo ""
    echo "Examples:"
    echo "  $0 src/main.py                    # Show all commits for the file"
    echo "  $0 src/main.py 42                 # Show commits affecting line 42"
    echo "  $0 src/main.py 42,50              # Show commits affecting lines 42-50"
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

FILE_PATH="$1"
LINE_RANGE="$2"

# Check if file exists or existed in history
if [ ! -f "$FILE_PATH" ] && ! git ls-files --error-unmatch "$FILE_PATH" >/dev/null 2>&1; then
    echo -e "${RED}Error: File '$FILE_PATH' not found in repository${NC}"
    exit 1
fi

# Function to show commits for entire file with fzf
show_file_commits_fzf() {
    local file="$1"

    echo -e "${GREEN}Loading commits for: ${BLUE}$file${NC}"
    echo -e "${YELLOW}Use arrow keys to navigate, Enter to view full commit, Esc to exit${NC}\n"

    git log --follow --color=always --format="%C(yellow)%h%C(reset) %C(cyan)%an%C(reset) %C(green)%ar%C(reset)" -- "$file" |
        fzf --ansi \
            --no-sort \
            --reverse \
            --tiebreak=index \
            --preview "export GIT_EXTERNAL_DIFF='difft --color=always'; export DFT_WIDTH=\$FZF_PREVIEW_COLUMNS; echo {} | grep -o '^[a-f0-9]\+' | head -1 | xargs -I @ git show --color=always --ext-diff @ \"$file\"" \
            --preview-window=right:80%:wrap \
            --bind "ctrl-d:preview-half-page-down,ctrl-u:preview-half-page-up" \
            --bind "enter:execute(echo {} | grep -o '^[a-f0-9]\+' | head -1 | xargs -I {} gh br $file --commit={})" \
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

    echo -e "${GREEN}Loading commits for lines ${BLUE}$range${GREEN} in: ${BLUE}$file${NC}"
    echo -e "${YELLOW}Use arrow keys to navigate, Enter to view full commit, Esc to exit${NC}\n"

    # Get commits that touched the line range
    git log -L "$range":"$file" --format="%C(yellow)%h%C(reset) %C(cyan)%an%C(reset) %C(green)%ar%C(reset)" --no-patch 2>/dev/null |
        fzf --ansi \
            --no-sort \
            --reverse \
            --tiebreak=index \
            --preview "export GIT_EXTERNAL_DIFF='difft --color=always'; export DFT_WIDTH=\$FZF_PREVIEW_COLUMNS; echo {} | grep -o '^[a-f0-9]\+' | head -1 | xargs -I @ git show --ext-diff --color=always @ -L $range:$file" \
            --preview-window=right:60%:wrap \
            --bind "ctrl-d:preview-half-page-down,ctrl-u:preview-half-page-up" \
            --bind "enter:execute(echo {} | grep -o '^[a-f0-9]\+' | head -1 | xargs -I {} gh br $file --commit={})" \
            --header="$range in $file | Enter: full commit"
}

# Main logic
if [ -z "$LINE_RANGE" ]; then
    # No line range specified, show all commits for the file
    show_file_commits_fzf "$FILE_PATH"
else
    # Line range specified
    show_line_commits_fzf "$FILE_PATH" "$LINE_RANGE"
fi
