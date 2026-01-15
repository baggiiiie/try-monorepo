#!/bin/bash

# Script to show all commits that modified a file with fzf preview showing the diff (jj-vcs version)
# Usage:
#   ./jj-file-history.sh <file_path>

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to display usage
usage() {
    echo "Usage: $0 <file_path>"
    echo ""
    echo "Example:"
    echo "  $0 src/main.py                    # Show all commits for the file"
    echo ""
    exit 1
}

# Check if fzf is installed
if ! command -v fzf &>/dev/null; then
    echo -e "${RED}Error: fzf is not installed${NC}"
    echo "Install it with: brew install fzf (macOS) or apt install fzf (Ubuntu)"
    exit 1
fi

# Check if jj is installed
if ! command -v jj &>/dev/null; then
    echo -e "${RED}Error: jj is not installed${NC}"
    echo "Install it with: brew install jj (macOS) or visit https://jj-vcs.github.io/jj/latest/install-and-setup/"
    exit 1
fi

# Check if jj repository
if ! jj root >/dev/null 2>&1; then
    echo -e "${RED}Error: Not a jj repository${NC}"
    exit 1
fi

# Check arguments
if [ $# -lt 1 ]; then
    usage
fi

FILE_PATH="$1"

# Check if file exists (by checking if it appears in any revision)
if [ -z "$(jj log --limit=1 "$FILE_PATH" 2>/dev/null)" ]; then
    echo -e "${RED}Error: File '$FILE_PATH' not found in repository${NC}"
    exit 1
fi

# Function to show commits for entire file with fzf
show_file_commits_fzf() {
    local file="$1"

    echo -e "${GREEN}Loading commits for: ${BLUE}$file${NC}"
    echo -e "${YELLOW}Use arrow keys to navigate, Enter to view full commit, Esc to exit${NC}\n"

    jj log --color=always --no-graph -T 'commit_id.short() ++ " " ++ author.name() ++ " " ++ committer.timestamp().ago() ++ "\n"' "$file" |
        fzf --ansi \
            --no-sort \
            --reverse \
            --tiebreak=index \
            --preview "commit_id=\$(echo {} | awk '{print \$1}'); jj show --color=always --tool=:git \$commit_id" \
            --preview-window=right:80%:wrap \
            --bind "ctrl-d:preview-half-page-down,ctrl-u:preview-half-page-up" \
            --bind "enter:execute(commit_id=\$(echo {} | awk '{print \$1}'); jj show --color=always --tool=:git \$commit_id | less -R)" \
            --header="$file | Enter: full commit"
}

# Show commits for file
show_file_commits_fzf "$FILE_PATH"
