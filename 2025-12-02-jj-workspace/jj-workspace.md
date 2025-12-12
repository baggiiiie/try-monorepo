## Workspaces Introduction

You can have multiple working copies backed by a single repo. Use jj workspace add to create a new working copy. The working copy will have a .jj/ directory linked to the main repo. The working copy and the .jj/ directory together is called a "workspace". Each workspace can have a different commit checked out.

Having multiple workspaces can be useful for running long-running tests in a one while you continue developing in another, for example. If needed, jj workspace root prints the root path of the current workspace.

When you're done using a workspace, use jj workspace forget to make the repo forget about it. The files can be deleted from disk separately (either before or after).

## Subcommand details

### jj workspace

Commands for working with workspaces

Workspaces let you add additional working copies attached to the same repo. A common use case is so you can run a slow build or test in one workspace while you're continuing to write code in another workspace.

Each workspace has its own working-copy commit. When you have more than one workspace attached to a repo, they are indicated by <workspace name>@ in jj log.

Each workspace also has own sparse patterns.

Usage: `jj workspace <COMMAND>`

Subcommands:
add — Add a workspace
forget — Stop tracking a workspace's working-copy commit in the repo
list — List workspaces
rename — Renames the current workspace
root — Show the current workspace root directory
update-stale — Update a workspace that has become stale

### jj workspace add

Add a workspace

By default, the new workspace inherits the sparse patterns of the current workspace. You can override this with the --sparse-patterns option.

Usage: `jj workspace add [OPTIONS] <DESTINATION>`

Arguments:
<DESTINATION> — Where to create the new workspace

Options:
--name <NAME> — A name for the workspace

To override the default, which is the basename of the destination directory.

-r, --revision <REVSETS> — A list of parent revisions for the working-copy commit of the newly created workspace. You may specify nothing, or any number of parents.

If no revisions are specified, the new workspace will be created, and its working-copy commit will exist on top of the parent(s) of the working-copy commit in the current workspace, i.e. they will share the same parent(s).

If any revisions are specified, the new workspace will be created, and the new working-copy commit will be created with all these revisions as parents, i.e. the working-copy commit will exist as if you had run jj new r1 r2 r3 ....

--sparse-patterns <SPARSE_PATTERNS> — How to handle sparse patterns when creating a new workspace

Default value: copy

Possible values:

copy: Copy all sparse patterns from the current workspace
full: Include all files in the new workspace
empty: Clear all files from the workspace (it will be empty)

### jj workspace forget

Stop tracking a workspace's working-copy commit in the repo

The workspace will not be touched on disk. It can be deleted from disk before or after running this command.

Usage: `jj workspace forget [WORKSPACES]...`

Arguments:
<WORKSPACES> — Names of the workspaces to forget. By default, forgets only the current workspace

### jj workspace list

List workspaces

Usage: `jj workspace list [OPTIONS]`

Options:
-T, --template <TEMPLATE> — Render each workspace using the given template

All 0-argument methods of the [WorkspaceRef type] are available as keywords in the template expression. See [jj help -k templates] for more information.

### jj workspace rename

Renames the current workspace

Usage: `jj workspace rename <NEW_WORKSPACE_NAME>`

Arguments:
<NEW_WORKSPACE_NAME> — The name of the workspace to update to

### jj workspace root

Show the current workspace root directory

Usage: `jj workspace root`
