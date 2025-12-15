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
        echo '{"workspaces":{}}' > "$JJ_WS_METADATA"
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
       "$JJ_WS_METADATA" > "$tmp_file"
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
       "$JJ_WS_METADATA" > "$tmp_file"
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

    # Create the workspace directory
    mkdir -p "$workspace_path"
    echo "Created workspace directory: $workspace_path"

    # Add workspace with jj
    if jj workspace add "$name" "$workspace_path"; then
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

    echo "Successfully deleted workspace '$name'"
}

# Show usage
show_usage() {
    cat << EOF
jjw - JJ Workspace Manager

Usage:
  jjw add <name>       Create a new workspace
  jjw delete <name>    Remove a workspace
  jjw help             Show this help message

Examples:
  jjw add feature-x       # Creates workspace at ~/.jj-ws/feature-x
  jjw delete feature-x    # Removes workspace and directory
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
        delete|remove|rm)
            delete_workspace "$@"
            ;;
        help|--help|-h)
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
