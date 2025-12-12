### create PR from revision

Creates a GitHub PR from the current bookmark. Auto-fills title from the latest commit message on the bookmark, body from the description of the top `jj log` revision (or a given revision with `-r` flag), and automatically detects the base branch (usually main/master). Potentially, adds draft mode if bookmark name contains `draft/`.
Look at `jj-create-pr.sh` for a partial implementation.

### Sync Bookmarks with GitHub Branches

- Description: Automatically push jj bookmarks to GitHub as branches and pull remote branches into jj bookmarks. This could include options to resolve conflicts or prune stale ones.
- Example Command: `jg sync [--push|--pull|--all] [--remote <remote>]`
- Rationale: jj bookmarks don't always map 1:1 with Git branches, so this helps maintain consistency in collaborative repos. It's useful for teams using jj locally but GitHub for CI/CD or reviews.

### Checkout and Work on GitHub Pull Requests in jj

- Description: Fetch a GitHub PR and create/check out a corresponding jj bookmark for local editing, rebasing, or testing. Could include fetching PR metadata like title/description into jj logs.
- Example Command: `jg pr checkout <pr-number> [--bookmark <name>]`
- Rationale: Developers often need to review or fix PRs locally. This integrates gh's PR fetching with jj's immutable change model, making it easier to iterate without messing up Git history.

### go to github reference based on jj description

- when revision's description contains `fixes #123` keywords etc, run `jj visit/browse/etc` to go there

### List and Filter GitHub PRs by jj Bookmarks

- Description: Query open/closed PRs on GitHub and filter them based on associated jj bookmarks (e.g., by base/head branch matching bookmark names). Display in a jj-friendly format with change IDs.
- Example Command: `jg pr list [--status open|closed] [--bookmark <name>] [--author <user>]`
- Rationale: Visibility is key in large repos. This extends gh's pr list by tying it to jj's local state, helping users quickly see PR status for their bookmarks without switching tools.

### rebase current bookmark onto main

- when i have changes locally that's based on OldMain and NewMain comes in, i wanna run `jj new-base` to rebase a branch
- need to select remote, not always origin
- like `git pull --rebase`?

### sync deleted bookmarks

For every local bookmark that has a corresponding remote GitHub branch of the same name -> `git fetch && jj bookmark set <name> -r @git::<name>`. Deletes local bookmarks whose remote branch disappeared (--prune).
Keeps your `jj bookmark list` an exact mirror of what exists on GitHub.

### PR ready

`jg pr ready` Marks the current bookmark’s PR as “ready for review” (removes draft), pushes latest changes, requests specific reviewers/team from a config file, and posts “ready for review” comment.

### checkout PR branch

Checks out the PR head as a new bookmark (named `pr-<number>` or the original branch name), then immediately rebases it onto the latest target branch.

### switch to PR branch

instantly switch to the bookmark that has an open PR against main (run `gh pr list --json headRefName --jq '.[].headRefName' | fzf`). If multiple, offers a selector.

### create bookmark from issue
