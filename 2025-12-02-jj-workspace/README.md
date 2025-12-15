# JJ Workspace Manager (jjw)

A simple CLI tool to manage jj workspaces with automatic directory management and metadata tracking.

## Installation

1. Copy `jj-ws.sh` to a directory in your PATH (e.g., `~/bin` or `/usr/local/bin`)
2. Rename it to `jjw` for convenience:
   ```bash
   cp jj-ws.sh ~/bin/jjw
   chmod +x ~/bin/jjw
   ```

## Features

- **Add workspaces**: Creates workspace directory and registers with jj in one command
- **Delete workspaces**: Forgets workspace in jj and removes directory completely
- **Metadata tracking**: Keeps track of workspaces in `~/.jj-ws/metadata.json`
- **Automatic directory management**: All workspaces stored in `~/.jj-ws/{workspace-name}`

## Usage

### Add a workspace

```bash
jjw add <name>
```

This will:
1. Create a directory at `~/.jj-ws/<name>`
2. Run `jj workspace add <name> ~/.jj-ws/<name>`
3. Save workspace metadata

Example:
```bash
jjw add feature-x
# Creates workspace at ~/.jj-ws/feature-x
```

### Delete a workspace

```bash
jjw delete <name>
```

This will:
1. Run `jj workspace forget <name>`
2. Remove the directory at `~/.jj-ws/<name>`
3. Remove workspace from metadata

Example:
```bash
jjw delete feature-x
# Removes workspace and deletes ~/.jj-ws/feature-x
```

Aliases: `delete`, `remove`, `rm`

### Get help

```bash
jjw help
```

## Requirements

- [jj (Jujutsu)](https://github.com/martinvonz/jj) installed and available in PATH
- `jq` for metadata management
- Bash shell

## Directory Structure

```
~/.jj-ws/
├── metadata.json          # Workspace metadata
├── feature-x/             # Workspace directory
├── feature-y/             # Another workspace
└── ...
```

## Metadata Format

The tool stores workspace information in `~/.jj-ws/metadata.json`:

```json
{
  "workspaces": {
    "feature-x": {
      "path": "/home/user/.jj-ws/feature-x",
      "created": "2025-12-15T10:30:00+00:00"
    }
  }
}
```

## Future Enhancements

See [PRD.md](PRD.md) for planned features including:
- List workspaces
- Switch between workspaces
- Run commands in workspaces
- Archive workspaces
- And more...
