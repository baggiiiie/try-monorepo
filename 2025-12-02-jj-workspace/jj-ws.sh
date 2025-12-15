#!/bin/bash

set -e

JJ_WS_DIR="$HOME/.jj-ws"
JJ_WS_METADATA="$JJ_WS_DIR/metadata.json"

# Initialize metadata file if it doesn't exist
init_metadata() {
    if [[ ! -d "$JJ_WS_DIR" ]]; then
        mkdir -p "$JJ_WS_DIR"
    fi

    if [[ ! -f "$JJ_WS_METADATA" ]]; then
        echo '{"workspaces":{}}' >"$JJ_WS_METADATA"
    fi
}

# Add workspace metadata
add_workspace_metadata() {
    local name=$1
    local path=$2
    local created=$(date -Iseconds)

    init_metadata

    # Use jq to update the metadata file
    tmp_file=$(mktemp)
    jq --arg name "$name" --arg path "$path" --arg created "$created" \
        '.workspaces[$name] = {path: $path, created: $created}' \
        "$JJ_WS_METADATA" >"$tmp_file"
    mv "$tmp_file" "$JJ_WS_METADATA"
}

# Remove workspace metadata
remove_workspace_metadata() {
    local name=$1

    if [[ ! -f "$JJ_WS_METADATA" ]]; then
        return
    fi

    tmp_file=$(mktemp)
    jq --arg name "$name" 'del(.workspaces[$name])' \
        "$JJ_WS_METADATA" >"$tmp_file"
    mv "$tmp_file" "$JJ_WS_METADATA"
}

# Add a workspace
add_workspace() {
    local name=$1

    if [[ -z "$name" ]]; then
        echo "Error: workspace name is required"
        echo "Usage: jjw add <name>"
        exit 1
    fi

    local workspace_path="$JJ_WS_DIR/$name"

    # Check if workspace directory already exists
    if [[ -d "$workspace_path" ]]; then
        echo "Error: workspace directory already exists at $workspace_path"
        exit 1
    fi

    # Add workspace with jj
    if jj workspace add --name "$name" "$workspace_path"; then
        echo "Added workspace '$name' to jj"

        # Save metadata
        add_workspace_metadata "$name" "$workspace_path"
        echo "Saved workspace metadata"

        echo "Successfully created workspace '$name' at $workspace_path"
    else
        # Clean up directory if jj command failed
        rm -rf "$workspace_path"
        echo "Error: failed to add workspace with jj, cleaned up directory"
        exit 1
    fi
}

# Delete a workspace
delete_workspace() {
    local name=$1

    if [[ -z "$name" ]]; then
        echo "Error: workspace name is required"
        echo "Usage: jjw delete <name>"
        exit 1
    fi

    local workspace_path="$JJ_WS_DIR/$name"

    # Forget the workspace with jj
    if jj workspace forget "$name"; then
        echo "Forgot workspace '$name' with jj"
    else
        echo "Warning: failed to forget workspace with jj (it may not exist)"
    fi

    # Remove the workspace directory
    if [[ -d "$workspace_path" ]]; then
        rm -rf "$workspace_path"
        echo "Removed workspace directory: $workspace_path"
    else
        echo "Warning: workspace directory not found at $workspace_path"
    fi

    # Remove from metadata
    remove_workspace_metadata "$name"
    echo "Removed workspace metadata"

    # Kill tmux window if it exists
    if [[ -n "$TMUX" ]] && tmux list-windows -F "#{window_name}" 2>/dev/null | grep -q "^${name}$"; then
        if tmux kill-window -t "$name" 2>/dev/null; then
            echo "Killed tmux window '$name'"
        else
            echo "Warning: failed to kill tmux window '$name'"
        fi
    fi

    echo "Successfully deleted workspace '$name'"
}

# Get workspace path from metadata
get_workspace_path() {
    local name=$1

    if [[ ! -f "$JJ_WS_METADATA" ]]; then
        return 1
    fi

    jq -r --arg name "$name" '.workspaces[$name].path // empty' "$JJ_WS_METADATA"
}

# Switch to a workspace
switch_workspace() {
    local name=""
    local tmux_flag=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --tmux)
                tmux_flag=true
                shift
                ;;
            -*)
                echo "Error: unknown option '$1'" >&2
                echo "Usage: jjw switch <name> [--tmux]" >&2
                exit 1
                ;;
            *)
                if [[ -z "$name" ]]; then
                    name="$1"
                else
                    echo "Error: unexpected argument '$1'" >&2
                    exit 1
                fi
                shift
                ;;
        esac
    done

    if [[ -z "$name" ]]; then
        echo "Error: workspace name is required" >&2
        echo "Usage: jjw switch <name> [--tmux]" >&2
        exit 1
    fi

    # Get workspace path from metadata
    local workspace_path=$(get_workspace_path "$name")

    if [[ -z "$workspace_path" ]]; then
        echo "Error: workspace '$name' not found in metadata" >&2
        echo "Run 'jjw list' to see available workspaces" >&2
        exit 1
    fi

    # Verify the directory exists
    if [[ ! -d "$workspace_path" ]]; then
        echo "Error: workspace directory not found at $workspace_path" >&2
        echo "The workspace may have been deleted manually" >&2
        exit 1
    fi

    # Handle --tmux flag
    if [[ "$tmux_flag" == true ]]; then
        # Check if we're in a tmux session
        if [[ -z "$TMUX" ]]; then
            echo "Error: --tmux flag requires running inside a tmux session" >&2
            echo "Please start tmux first, then run this command" >&2
            exit 1
        fi

        # Create a new tmux window with the workspace directory and name
        if tmux new-window -c "$workspace_path" -n "$name"; then
            echo "Created tmux window '$name' at $workspace_path" >&2
        else
            echo "Error: failed to create tmux window" >&2
            exit 1
        fi
    else
        # Output the path to stdout (for cd)
        echo "$workspace_path"

        # Print informational message to stderr
        echo "Switched to workspace '$name'" >&2
    fi
}

# Show usage
show_usage() {
    cat <<EOF
jjw - JJ Workspace Manager

Usage:
  jjw add <name>           Create a new workspace
  jjw switch <name>        Switch to a workspace directory
  jjw rm/del <name>        Remove a workspace
  jjw help                 Show this help message

Options for switch:
  --tmux                   Open workspace in new tmux window (requires tmux)

Examples:
  jjw add feature-x        # Creates workspace at ~/.jj-ws/feature-x
  jjw switch feature-x     # Outputs path to switch to workspace
  jjw switch feature-x --tmux  # Opens workspace in new tmux window
  jjw delete feature-x     # Removes workspace, directory, and tmux window

Note: To use switch without --tmux, create a shell function:
  jjw_switch() { cd "\$(jjw switch "\$@")"; }
  Then use: jjw_switch feature-x
EOF
}

# Main command dispatcher
main() {
    local command=$1
    shift || true

    case "$command" in
    add)
        add_workspace "$@"
        ;;
    del | rm)
        delete_workspace "$@"
        ;;
    switch)
        switch_workspace "$@"
        ;;
    help | --help | -h)
        show_usage
        ;;
    *)
        echo "Error: unknown command '$command'"
        echo ""
        show_usage
        exit 1
        ;;
    esac
}

# Run main function
main "$@"
