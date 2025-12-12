#!/bin/bash

# Parse command line arguments
branch=""
pr_body=""
me="baggiiiie"
# GH_HOST is from env variables if set
# host=${GH_HOST:-"github.com"}
# me=$(gh auth status --jq '.hosts["github.com"][0].login' --json hosts)

# Check once if we're in SSH session
check_ssh() {
    [ -n "$SSH_CLIENT" ] || [ -n "$SSH_TTY" ] || [ -n "$SSH_CONNECTION" ] && return 0 || return 1
}
check_ssh && is_ssh=true || is_ssh=false

while [[ $# -gt 0 ]]; do
    case $1 in
    --branch)
        branch="$2"
        shift 2
        ;;
    --pr-body)
        pr_body="$2"
        shift 2
        ;;
    *)
        echo "Unknown option: $1"
        echo "Usage: $0 [--branch BRANCH] [--pr-body FILE]"
        exit 1
        ;;
    esac
done

# If branch not provided, use fzf to select
if [[ -z $branch ]]; then
    branch=$(git branch --column=never --no-color | fzf --prompt="Select branch to open PR with: " | xargs)

    if [[ "$branch" =~ "no branch" ]]; then
        branch=$(jj git push -c @ -N 2>&1 | grep -oE 'yc/test-\w' | head -n 1)
        echo "pushed bookmark is: $branch"
    fi
fi

# Read remotes into array (faster than multiple pipes)
mapfile -t remotes_array < <(git remote)

# Select remote if multiple exist
if [[ ${#remotes_array[@]} -gt 1 ]]; then
    selected_remote=$(printf '%s\n' "${remotes_array[@]}" | fzf --prompt="Select remote to open PR in: ")
else
    selected_remote="${remotes_array[0]}"
fi

# Extract user and repo from remote URL
remote_url=$(git remote get-url "$selected_remote")
if [[ $remote_url =~ git.*.com[:/]([^/]+)/([^/.]+) ]]; then
    user="${BASH_REMATCH[1]}"
    repo="${BASH_REMATCH[2]}"
    dash_r_option=(-R "$user/$repo")
else
    echo "Error: Could not parse GitHub user/repo from remote URL: $remote_url"
    exit 1
fi

if [[ $PWD == *"jjui"* && "$user" != "$me" ]]; then
    branch="$me:$branch"
fi

# Try to view existing PR first (faster than ls-remote)
if $is_ssh; then
    gh pr view "$branch" "${dash_r_option[@]}" 2>/dev/null && exit 0
else
    gh pr view "$branch" -w "${dash_r_option[@]}" 2>/dev/null && exit 0
fi

# Push branch if needed
if [[ -d .jj ]]; then
    if ! jj git push -b "${branch#"$me":}"; then
        echo "probably a private commit, push failed"
        exit 1
    fi
else
    git push -u "$selected_remote" "$branch" 2>/dev/null || true
fi

# Create PR
template=$(rg --files -i -g "*pull_request_template.md" | head -n 1)
template_option=()
[[ -n $template ]] && template_option=("--template" "$template")

# Build gh pr create command
gh_args=(-B main -H "$branch" "${dash_r_option[@]}")
$is_ssh || gh_args+=(-w)

if [[ -n $pr_body ]]; then
    gh pr create "${gh_args[@]}" -F "$pr_body"
else
    gh pr create "${gh_args[@]}" --fill "${template_option[@]}"
fi
