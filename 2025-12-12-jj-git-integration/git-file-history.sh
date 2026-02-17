#!/bin/bash

# Script to show all commits that modified a file or specific lines in a file
# with fzf preview showing the diff
# Usage:
#   ./git-file-history.sh <file_path>
#   ./git-file-history.sh <file_path> <start_line>[,<end_line>]
#   ./git-file-history.sh -g <text>          # search all history for text (diff)
#   ./git-file-history.sh -t <text>          # search all history for text (commit message)

set -e

# Force fzf to use bash for execute/preview commands (not the user's login shell, e.g. fish)
export SHELL=/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

script_name=$(basename "$0")
# Function to display usage
usage() {
    echo "Usage: $script_name [options] [file_path] [line_range]"
    echo ""
    echo "Options:"
    echo "  -g, --grep, --text <text>   Only show commits where the DIFF contains <text>"
    echo "  -t, --title <text>          Only show commits where the COMMIT MESSAGE contains <text>"
    echo "                              If no file_path is given, searches all files"
    echo ""
    echo "Examples:"
    echo "  $script_name src/main.py                    # Show all commits for the file"
    echo "  $script_name -g 'fix bug'                   # Show commits with 'fix bug' in diff (any file)"
    echo "  $script_name -t 'fix bug'                   # Show commits with 'fix bug' in message"
    echo "  $script_name -t 'fix bug' src/main.py       # Show commits with 'fix bug' in message for file"
    echo "  $script_name src/main.py 42                 # Show commits affecting line 42"
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
TITLE_TEXT=""

# Manual argument parsing
while [[ $# -gt 0 ]]; do
    case $1 in
    -g | --grep | --text)
        if [ -n "$2" ]; then
            GREP_TEXT="$2"
            shift 2
        else
            echo -e "${RED}Error: $1 requires an argument${NC}"
            exit 1
        fi
        ;;
    -t | --title)
        if [ -n "$2" ]; then
            TITLE_TEXT="$2"
            shift 2
        else
            echo -e "${RED}Error: --title requires an argument${NC}"
            exit 1
        fi
        ;;
    -h | --help)
        usage
        ;;
    -*)
        echo -e "${RED}Error: Unknown option '$1'${NC}"
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

if [ -z "$FILE_PATH" ] && [ -z "$GREP_TEXT" ] && [ -z "$TITLE_TEXT" ]; then
    usage
fi

if [ -n "$FILE_PATH" ]; then
    # Verify file exists in history (even if deleted in working tree)
    if [ ! -f "$FILE_PATH" ] && ! git log --oneline -1 -- "$FILE_PATH" >/dev/null 2>&1 || [ -z "$(git log --oneline -1 -- "$FILE_PATH" 2>/dev/null)" ]; then
        echo -e "${RED}Error: File '$FILE_PATH' not found in repository history${NC}"
        exit 1
    fi
fi

# Function to show commits for entire file with fzf
show_file_commits_fzf() {
    local file="$1"
    local filter_args=()
    [ -n "$GREP_TEXT" ] && filter_args+=("-G$GREP_TEXT")
    [ -n "$TITLE_TEXT" ] && filter_args+=("--grep=$TITLE_TEXT")

    echo -e "${GREEN}Loading commits for: ${BLUE}$file${NC}"
    [ -n "$GREP_TEXT" ] && echo -e "${GREEN}Filtering by diff containing: ${YELLOW}$GREP_TEXT${NC}"
    [ -n "$TITLE_TEXT" ] && echo -e "${GREEN}Filtering by message containing: ${YELLOW}$TITLE_TEXT${NC}"
    echo -e "${YELLOW}Use arrow keys to navigate, Enter to view full commit, Esc to exit${NC}\n"

    local grep_binds=()
    local header="$file | Enter: full commit"
    if [ -n "$GREP_TEXT" ]; then
        grep_binds+=(--bind "ctrl-g:preview(git show --no-ext-diff --color=always {1} -- \"{5}\" | grep -C5 --color=always '$GREP_TEXT')")
        header="$file | Enter: full commit | ctrl-g: diff context | ctrl-d/u: scroll"
    fi

    # Use --name-only with --follow to track renames and get the filename at each commit
    # We include a plain hash as the first column for fzf to use in commands
    git log --follow "${filter_args[@]}" --name-only --format="%h|%C(yellow)%h%C(reset)|%C(cyan)%an%C(reset)|%C(green)%ar%C(reset)" -- "$file" |
        awk 'NR%3==1{h=$0;next} NR%3==0{f=$0; print h "|" f}' |
        fzf --ansi \
            --no-sort \
            --reverse \
            --tiebreak=index \
            --delimiter "|" \
            --with-nth "2,3,4" \
            --preview "export GIT_EXTERNAL_DIFF='difft --color=always'; export DFT_WIDTH=\$FZF_PREVIEW_COLUMNS; git show --color=always --ext-diff {1} -- {5}" \
            --preview-window=right:80%:wrap \
            --bind "ctrl-d:preview-half-page-down,ctrl-u:preview-half-page-up" \
            "${grep_binds[@]}" \
            --bind "enter:execute(commit={1}; fpath={5}; echo \"Running: gh br \$fpath --commit=\$commit\"; gh br \$fpath --commit=\$commit)" \
            --header="$header"
}

# Function to show commits for specific lines with fzf
show_line_commits_fzf() {
    local file="$1"
    local range="$2"
    local filter_args=()
    [ -n "$GREP_TEXT" ] && filter_args+=("-G$GREP_TEXT")
    [ -n "$TITLE_TEXT" ] && filter_args+=("--grep=$TITLE_TEXT")

    echo -e "${GREEN}Loading commits for lines ${BLUE}$range${GREEN} in: ${BLUE}$file${NC}"
    [ -n "$GREP_TEXT" ] && echo -e "${GREEN}Filtering by diff containing: ${YELLOW}$GREP_TEXT${NC}"
    [ -n "$TITLE_TEXT" ] && echo -e "${GREEN}Filtering by message containing: ${YELLOW}$TITLE_TEXT${NC}"
    echo -e "${YELLOW}Use arrow keys to navigate, Enter to view full commit, Esc to exit${NC}\n"

    local grep_binds=()
    local header="$range in $file | Enter: full commit"
    if [ -n "$GREP_TEXT" ]; then
        # Fallback to plain git show if -L fails (e.g. on old names after rename)
        grep_binds=(--bind "ctrl-g:preview(commit=\$(echo {} | grep -o '^[a-f0-9]\+' | head -1); (git show --no-ext-diff --color=always \$commit -L $range:$file 2>/dev/null || git show --no-ext-diff --color=always \$commit) | grep -C5 --color=always '$GREP_TEXT')")
        header="$range in $file | Enter: full commit | ctrl-g: diff context | ctrl-d/u: scroll"
    fi

    # Get commits that touched the line range
    git log "${filter_args[@]}" -L "$range":"$file" --format="%C(yellow)%h%C(reset) %C(cyan)%an%C(reset) %C(green)%ar%C(reset)" --no-patch 2>/dev/null |
        fzf --ansi \
            --no-sort \
            --reverse \
            --tiebreak=index \
            --preview "export GIT_EXTERNAL_DIFF='difft --color=always'; export DFT_WIDTH=\$FZF_PREVIEW_COLUMNS; commit=\$(echo {} | grep -o '^[a-f0-9]\+' | head -1); git show --ext-diff --color=always \$commit -- \"$file\" 2>/dev/null || git show --ext-diff --color=always \$commit" \
            --preview-window=right:60%:wrap \
            --bind "ctrl-d:preview-half-page-down,ctrl-u:preview-half-page-up" \
            "${grep_binds[@]}" \
            --bind "enter:execute(commit=\$(echo {} | grep -o '^[a-f0-9]\+' | head -1); echo \"Running: gh br $file --commit=\$commit\"; gh br $file --commit=\$commit || gh br --commit=\$commit)" \
            --header="$header"
}

show_grep_all_commits_fzf() {
    local filter_args=()
    local label=""
    if [ -n "$GREP_TEXT" ]; then
        filter_args+=("-G$GREP_TEXT")
        label="diff: $GREP_TEXT"
    fi
    if [ -n "$TITLE_TEXT" ]; then
        filter_args+=("--grep=$TITLE_TEXT")
        [ -n "$label" ] && label="$label, "
        label="${label}title: $TITLE_TEXT"
    fi

    echo -e "${GREEN}Searching all history for: ${YELLOW}$label${NC}"
    echo -e "${YELLOW}Use arrow keys to navigate, Enter to view full commit, Esc to exit${NC}\n"

    git log "${filter_args[@]}" --color=always --format="%C(yellow)%h%C(reset) %C(cyan)%an%C(reset) %C(green)%ar%C(reset) %s" |
        fzf --ansi \
            --no-sort \
            --reverse \
            --tiebreak=index \
            --preview "export GIT_EXTERNAL_DIFF='difft --color=always'; export DFT_WIDTH=\$FZF_PREVIEW_COLUMNS; echo {} | grep -o '^[a-f0-9]\+' | head -1 | xargs -I @ git show --color=always --ext-diff @" \
            --preview-window=right:80%:wrap \
            --bind "ctrl-d:preview-half-page-down,ctrl-u:preview-half-page-up" \
            --bind "ctrl-g:preview(echo {} | grep -o '^[a-f0-9]\+' | head -1 | xargs -I @ git show --no-ext-diff --color=always @ | grep -C5 --color=always '$GREP_TEXT')" \
            --bind "enter:execute(commit=\$(echo {} | grep -o '^[a-f0-9]\+' | head -1); git show --ext-diff \$commit)" \
            --header="grep: $label (all files) | Enter: full commit | ctrl-g: diff context | ctrl-d/u: scroll"
}

echo "if the commit history is not expected, maybe the local git is a shallow clone."
echo "run 'git rev-parse --is-shallow-repository' to check"
echo "and run Try 'git fetch --unshallow' to get full history."

# Main logic
if [ -z "$FILE_PATH" ] && ([ -n "$GREP_TEXT" ] || [ -n "$TITLE_TEXT" ]); then
    show_grep_all_commits_fzf
elif [ -z "$LINE_RANGE" ]; then
    show_file_commits_fzf "$FILE_PATH"
else
    show_line_commits_fzf "$FILE_PATH" "$LINE_RANGE"
fi
