# PRD: JJ Workspace Manager CLI Tool

## Overview

A CLI tool to streamline workspace management for jj-vcs by wrapping common workspace operations and eliminating manual steps like directory navigation and cleanup.

## Problem Statement

The current jj workspace workflow requires multiple manual steps:

- Manual `cd` commands to switch between workspaces
- Separate cleanup commands to remove workspace directories after `jj workspace forget`
- No easy way to see and jump between workspaces
- Repetitive commands for common workspace patterns

## Goals

- Reduce friction in creating, switching, and deleting workspaces
- Provide intelligent defaults for common workflows
- Maintain compatibility with native jj workspace commands
- Support advanced use cases (running commands in workspaces, bulk operations)

## Proposed Commands

### Core Workspace Management

#### `jjw add <name> [options]`

Create a new workspace with intelligent path defaults

- **Options:**
  - `-r, --revision <REVSETS>` - Parent revision(s) for the workspace
  - `-p, --path <PATH>` - Custom path (default: `../jj-workspace-<name>` or configurable root)
  - `--sparse <copy|full|empty>` - Sparse pattern handling (default: copy)
  - `--switch` - Automatically switch to the new workspace after creation (default: true)
  - `--no-switch` - Don't switch after creation
- **Example:** `jjw add feature-x -r main --switch`

#### `jjw switch <name>`

Switch to an existing workspace

- Resolves workspace name to path and changes directory
- **Options:**
  - `-l, --list` - Show available workspaces before switching (interactive picker)
- **Example:** `jjw switch feature-x`

#### `jjw rm <name> [names...]`

Remove workspace(s) and clean up directories

- Runs `jj workspace forget` + removes directory
- **Options:**
  - `--keep-files` - Only forget in jj, don't delete directory
  - `--force, -f` - Skip confirmation prompt
  - `--current` - Delete current workspace (and switch to default/main)
- **Example:** `jjw delete old-feature-1 old-feature-2 -f`

#### `jjw list [options]`

List all workspaces with enhanced information

- **Options:**
  - `-v, --verbose` - Show full paths, current commit, last modified
  - `--paths` - Output only paths (for scripting)
  - `--current` - Highlight or filter to current workspace
  - `-T, --template <TEMPLATE>` - Pass through to jj template
- **Output format:** Name, path, current revision, status indicator for current workspace
- **Example:** `jjw list -v`

### Workflow Commands

#### `jjw run <name> -- <command>`

Execute a command in a specific workspace without switching

- Useful for running tests/builds in background workspaces
- **Options:**
  - `-b, --background` - Run command in background
  - `--all` - Run command in all workspaces
  - `--exclude <names>` - Exclude specific workspaces when using --all
- **Example:** `jjw run ci-workspace -- cargo test`
- **Example:** `jjw run --all -- git pull`

#### `jjw current`

Display current workspace name and information

- Shows: name, path, working-copy commit, parent commit(s)
- **Options:**
  - `--name` - Output only the name
  - `--path` - Output only the path
- **Example:** `jjw current --name`

#### `jjw goto <name>`

Alias for `switch` (for user preference)

### Advanced Commands

#### `jjw clone <source-name> <new-name> [options]`

Clone an existing workspace configuration

- Creates new workspace with same revision/sparse patterns as source
- **Options:**
  - `-r, --revision <REVSETS>` - Override revision
  - `--switch` - Switch to new workspace after creation
- **Example:** `jjw clone feature-x feature-x-experiment`

#### `jjw clean [options]`

Clean up stale/forgotten workspaces

- Finds directories that were forgotten but not deleted
- **Options:**
  - `--dry-run` - Show what would be cleaned
  - `--auto` - Remove directories not tracked by jj
  - `--interactive, -i` - Prompt for each directory
- **Example:** `jjw clean --dry-run`

#### `jjw rename <old-name> <new-name>`

Rename workspace and optionally move directory

- Wraps `jj workspace rename` with directory management
- **Options:**
  - `--move-dir` - Also rename the directory
- **Example:** `jjw rename feat-x feature-complete`

#### `jjw archive <name> [options]`

Archive a workspace for later use

- Forgets workspace but moves directory to archive location
- **Options:**
  - `--archive-dir <PATH>` - Custom archive location (default: `~/.jj-workspaces-archive/`)
  - `--compress` - Create tarball instead of moving
- **Example:** `jjw archive old-experiment --compress`

### Configuration Commands

#### `jjw config set <key> <value>`

Set tool configuration

- **Configurable options:**
  - `workspace.root` - Default parent directory for workspaces
  - `workspace.auto_switch` - Auto-switch after creation (true/false)
  - `workspace.confirm_delete` - Confirm before deletion (true/false)
  - `workspace.archive_dir` - Archive directory path
- **Example:** `jjw config set workspace.root ~/jj-workspaces`

#### `jjw config get <key>`

Get configuration value

#### `jjw config list`

List all configuration

### Utility Commands

#### `jjw init`

Initialize jjw configuration for current repo

- Creates `.jjw.toml` config file
- Optionally scans for existing workspaces

#### `jjw status`

Show overview of all workspaces

- Current commits, dirty state, last activity
- **Example output:**

  ```
  main        /path/to/main         abc123  clean      (current)
  feature-x   /path/to/feature-x    def456  modified   2 hours ago
  ci          /path/to/ci           789abc  clean      running: cargo test
  ```

## Success Metrics

- Reduction in commands needed for common workflows (3-4 commands → 1)
- User adoption rate among jj workspace users
- Decreased errors from manual directory management

## Future Considerations

- Integration with terminal multiplexers (tmux/zellij sessions per workspace)
- Workspace templates (predefined configurations)
- Git worktree migration helper
- IDE integration hooks
