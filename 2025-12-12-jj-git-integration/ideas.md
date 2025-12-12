### Create PR from Revision

**Description:** Creates a GitHub PR from the current bookmark, automatically extracting metadata from jj revision data. The title is derived from the latest commit message on the bookmark, the body from the revision description, and the base branch is auto-detected (usually main/master). If the bookmark name contains `draft/`, the PR is created in draft mode.

**Command Workflow:**
```bash
# 1. Ensure you're on the bookmark you want to create a PR from
jj log -r @

# 2. Create/move bookmark to current revision if needed
jj bookmark create my-feature -r @

# 3. Push the bookmark to GitHub
jj git push --bookmark my-feature

# 4. Extract commit message and description for PR metadata
TITLE=$(jj log -r @ --no-graph -T 'description.first_line()')
BODY=$(jj log -r @ --no-graph -T 'description')

# 5. Detect base branch (find the fork point)
BASE=$(jj log -r 'ancestors(@, 2) & bookmarks()' --no-graph -T 'bookmarks' | head -1)
BASE=${BASE:-main}  # Default to main if not detected

# 6. Create PR (draft if bookmark contains 'draft/')
if [[ "my-feature" == *"draft/"* ]]; then
  gh pr create --title "$TITLE" --body "$BODY" --base "$BASE" --head my-feature --draft
else
  gh pr create --title "$TITLE" --body "$BODY" --base "$BASE" --head my-feature
fi
```

**Reference:** Look at `jj-create-pr.sh` for a partial implementation.

### Sync Bookmarks with GitHub Branches

**Description:** Automatically synchronize jj bookmarks with GitHub branches in both directions. Push local bookmarks to GitHub as branches, and pull remote branches into jj bookmarks. Includes options to resolve conflicts and prune stale bookmarks.

**Example Command:** `jg sync [--push|--pull|--all] [--remote <remote>]`

**Rationale:** jj bookmarks don't always map 1:1 with Git branches, so this helps maintain consistency in collaborative repos. Essential for teams using jj locally but GitHub for CI/CD or reviews.

**Command Workflow:**

**Push mode (--push):**
```bash
# 1. List all local bookmarks
jj bookmark list

# 2. Push all bookmarks to remote
jj git push --all --remote origin

# Or push specific bookmark
jj git push --bookmark my-feature --remote origin
```

**Pull mode (--pull):**
```bash
# 1. Fetch all remote branches
jj git fetch --remote origin

# 2. List remote bookmarks
jj bookmark list --all

# 3. Track remote bookmarks locally
for branch in $(git branch -r | grep -v HEAD); do
  bookmark_name=$(echo $branch | sed 's/origin\///')
  jj bookmark track "${bookmark_name}@origin"
done

# 4. Update local bookmarks from tracked remotes
jj git fetch --remote origin
```

**Sync all mode (--all):**
```bash
# 1. Fetch from remote first
jj git fetch --remote origin

# 2. Push all local bookmarks
jj git push --all --remote origin

# 3. Prune deleted remote branches
jj bookmark list | while read bookmark; do
  if ! git ls-remote --heads origin "$bookmark" | grep -q "$bookmark"; then
    jj bookmark delete "$bookmark"
  fi
done
```

### Checkout and Work on GitHub Pull Requests in jj

**Description:** Fetch a GitHub PR and create a corresponding jj bookmark for local editing, rebasing, or testing. Optionally fetches PR metadata (title, description, author) and embeds it into jj revision descriptions.

**Example Command:** `jg pr checkout <pr-number> [--bookmark <name>]`

**Rationale:** Developers often need to review or fix PRs locally. This integrates gh's PR fetching with jj's immutable change model, making it easier to iterate without messing up Git history.

**Command Workflow:**
```bash
# 1. Get PR information from GitHub
PR_NUMBER=123
PR_INFO=$(gh pr view $PR_NUMBER --json number,title,body,headRefName,baseRefName,author)
PR_BRANCH=$(echo "$PR_INFO" | jq -r '.headRefName')
PR_TITLE=$(echo "$PR_INFO" | jq -r '.title')
PR_BODY=$(echo "$PR_INFO" | jq -r '.body')
PR_AUTHOR=$(echo "$PR_INFO" | jq -r '.author.login')

# 2. Fetch the PR branch from remote
gh pr checkout $PR_NUMBER  # This uses git underneath
jj git import  # Import the git refs into jj

# 3. Create a jj bookmark for the PR
BOOKMARK_NAME="${PR_BRANCH:-pr-$PR_NUMBER}"
jj bookmark create "$BOOKMARK_NAME" -r "$PR_BRANCH@origin"

# 4. Create a new working copy on the PR bookmark
jj new "$BOOKMARK_NAME"

# 5. Optionally, set the description with PR metadata
jj describe -m "$(cat <<EOF
$PR_TITLE

$PR_BODY

PR: #$PR_NUMBER
Author: @$PR_AUTHOR
EOF
)"

# 6. Show the current state
jj log -r @
```

### Go to GitHub Reference Based on jj Description

**Description:** Parse the current revision's description for GitHub references (issue/PR numbers) using keywords like `fixes #123`, `closes #456`, `refs #789`, etc., and open the corresponding GitHub page in a browser.

**Example Command:** `jg browse [--revision <rev>]`

**Rationale:** Streamlines navigation from local development to related GitHub issues/PRs without context switching or manual URL construction.

**Command Workflow:**
```bash
# 1. Get the current revision description
REV=${1:-@}  # Default to current revision
DESC=$(jj log -r "$REV" --no-graph -T 'description')

# 2. Extract GitHub references (supports: fixes, closes, resolves, refs, see, etc.)
ISSUE_NUM=$(echo "$DESC" | grep -oP '(?i)(fixes|closes|resolves|refs?|see)\s+#\K\d+' | head -1)

if [ -z "$ISSUE_NUM" ]; then
  echo "No GitHub reference found in revision description"
  exit 1
fi

# 3. Get the repository info
REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')

# 4. Determine if it's an issue or PR and open in browser
# First check if it's a PR
if gh pr view "$ISSUE_NUM" &>/dev/null; then
  gh pr view "$ISSUE_NUM" --web
else
  # Otherwise treat as issue
  gh issue view "$ISSUE_NUM" --web
fi

# Alternative: directly open URL
# open "https://github.com/$REPO/issues/$ISSUE_NUM"
```

### List and Filter GitHub PRs by jj Bookmarks

**Description:** Query open/closed PRs on GitHub and filter them based on associated jj bookmarks. Match PR head/base branches with local bookmark names and display in a jj-friendly format with change IDs and revision info.

**Example Command:** `jg pr list [--status open|closed] [--bookmark <name>] [--author <user>]`

**Rationale:** Visibility is key in large repos. This extends gh's pr list by tying it to jj's local state, helping users quickly see PR status for their bookmarks without switching tools.

**Command Workflow:**
```bash
# 1. Get all local bookmarks
LOCAL_BOOKMARKS=$(jj bookmark list --all | awk '{print $1}')

# 2. Query GitHub PRs
STATUS=${1:-open}  # Default to open PRs
gh pr list --state "$STATUS" --json number,title,headRefName,baseRefName,author,updatedAt

# 3. Filter PRs matching local bookmarks
gh pr list --state "$STATUS" --json number,title,headRefName,baseRefName,author,updatedAt | \
  jq --arg bookmarks "$LOCAL_BOOKMARKS" -r '
    .[] |
    select(.headRefName as $head | $bookmarks | contains($head)) |
    "\(.number)\t\(.headRefName)\t\(.title)\t@\(.author.login)\t\(.updatedAt)"
  '

# 4. For a specific bookmark, show detailed info with jj context
BOOKMARK="my-feature"
PR_NUM=$(gh pr list --head "$BOOKMARK" --json number -q '.[0].number')

if [ -n "$PR_NUM" ]; then
  echo "PR #$PR_NUM for bookmark: $BOOKMARK"
  gh pr view "$PR_NUM"

  # Show jj log for this bookmark
  echo -e "\n--- jj log for $BOOKMARK ---"
  jj log -r "$BOOKMARK"
fi

# 5. Show PRs with author filter
AUTHOR="username"
gh pr list --author "$AUTHOR" --json number,title,headRefName | \
  jq -r '.[] | "#\(.number) [\(.headRefName)] \(.title)"'
```

### Rebase Current Bookmark onto Main

**Description:** Update your local bookmark to be based on the latest main branch from the remote. This is equivalent to `git pull --rebase` - when you have local changes based on an old main and a new main comes in, you want to rebase your work on top of the new main.

**Example Command:** `jg rebase-onto main [--remote <remote>]`

**Rationale:** Common workflow when main branch advances while you're working on a feature. Keeps your changes up-to-date without merge commits.

**Command Workflow:**
```bash
# 1. Fetch the latest main from remote
REMOTE=${1:-origin}
jj git fetch --remote "$REMOTE"

# 2. Check current bookmark and its base
CURRENT_BOOKMARK=$(jj log -r @ --no-graph -T 'bookmarks')
echo "Current bookmark: $CURRENT_BOOKMARK"
jj log -r @ -n 5

# 3. Rebase current revision onto the latest main
# First, identify what main is (could be main@origin or master@origin)
MAIN_BRANCH=$(jj bookmark list --all | grep -E "main@$REMOTE|master@$REMOTE" | head -1 | awk '{print $1}')

if [ -z "$MAIN_BRANCH" ]; then
  echo "Error: Could not find main or master branch on $REMOTE"
  exit 1
fi

echo "Rebasing onto $MAIN_BRANCH..."

# 4. Rebase all descendants of the old base onto new main
# Find where your bookmark diverged from main
jj rebase -d "$MAIN_BRANCH"

# Alternative: Rebase specific revision range
# jj rebase -r @ -d "$MAIN_BRANCH"

# 5. Verify the rebase
jj log -r "@ | $MAIN_BRANCH"

# 6. If there are conflicts, resolve them
# jj will show conflict markers, edit the files, then:
# jj resolve --list  # See conflicts
# After editing files:
# jj squash  # Or jj commit to finalize
```

### Sync Deleted Bookmarks

**Description:** Synchronize local bookmarks with remote GitHub branches, updating bookmarks that exist on both sides and pruning local bookmarks whose remote branches have been deleted. Keeps your local `jj bookmark list` an exact mirror of what exists on GitHub.

**Example Command:** `jg sync-deleted [--prune] [--remote <remote>]`

**Rationale:** After PRs are merged and branches deleted on GitHub, local bookmarks become stale. This automates cleanup and keeps local state in sync with remote.

**Command Workflow:**
```bash
REMOTE=${1:-origin}

# 1. Fetch latest state from remote
jj git fetch --remote "$REMOTE"

# 2. Get list of remote branches
REMOTE_BRANCHES=$(git ls-remote --heads "$REMOTE" | awk '{print $2}' | sed 's|refs/heads/||')

# 3. Get list of local bookmarks
LOCAL_BOOKMARKS=$(jj bookmark list | grep -v "@$REMOTE" | awk '{print $1}')

# 4. Update local bookmarks that exist on remote
echo "$REMOTE_BRANCHES" | while read remote_branch; do
  if echo "$LOCAL_BOOKMARKS" | grep -q "^${remote_branch}$"; then
    echo "Updating bookmark: $remote_branch"
    jj bookmark set "$remote_branch" -r "${remote_branch}@${REMOTE}"
  fi
done

# 5. Prune local bookmarks whose remote branch was deleted
echo "$LOCAL_BOOKMARKS" | while read local_bookmark; do
  # Skip special bookmarks
  if [[ "$local_bookmark" == "main" ]] || [[ "$local_bookmark" == "master" ]]; then
    continue
  fi

  if ! echo "$REMOTE_BRANCHES" | grep -q "^${local_bookmark}$"; then
    echo "Remote branch deleted, removing local bookmark: $local_bookmark"
    jj bookmark delete "$local_bookmark"
  fi
done

# 6. Show final state
echo -e "\n--- Updated bookmark list ---"
jj bookmark list
```

### PR Ready

**Description:** Marks the current bookmark's PR as "ready for review" by removing draft status, pushing the latest changes, requesting reviewers from a config file, and optionally posting a "ready for review" comment.

**Example Command:** `jg pr ready [--reviewers <user1,user2>] [--team <team>]`

**Rationale:** Streamlines the final step of PR preparation - ensures code is pushed, switches from draft to ready, and notifies reviewers in one command.

**Command Workflow:**
```bash
# 1. Get current bookmark
BOOKMARK=$(jj log -r @ --no-graph -T 'bookmarks' | awk '{print $1}')

if [ -z "$BOOKMARK" ]; then
  echo "Error: No bookmark found on current revision"
  exit 1
fi

# 2. Ensure latest changes are described
jj log -r @

# 3. Push latest changes to remote
echo "Pushing $BOOKMARK to origin..."
jj git push --bookmark "$BOOKMARK"

# 4. Find associated PR
PR_NUM=$(gh pr list --head "$BOOKMARK" --json number -q '.[0].number')

if [ -z "$PR_NUM" ]; then
  echo "Error: No PR found for bookmark $BOOKMARK"
  exit 1
fi

echo "Found PR #$PR_NUM"

# 5. Mark PR as ready for review (remove draft status)
gh pr ready "$PR_NUM"

# 6. Request reviewers from config or arguments
# Read from .jj/pr-reviewers.json or command line
REVIEWERS=${1:-$(cat .jj/pr-reviewers.json 2>/dev/null | jq -r '.reviewers | join(",")')}
TEAM=${2:-$(cat .jj/pr-reviewers.json 2>/dev/null | jq -r '.team')}

if [ -n "$REVIEWERS" ]; then
  echo "Requesting reviews from: $REVIEWERS"
  gh pr edit "$PR_NUM" --add-reviewer "$REVIEWERS"
fi

if [ -n "$TEAM" ]; then
  echo "Requesting review from team: $TEAM"
  gh pr edit "$PR_NUM" --add-reviewer "$TEAM"
fi

# 7. Post a comment
gh pr comment "$PR_NUM" --body "✅ Ready for review!"

# 8. Show PR status
gh pr view "$PR_NUM"
```

### Checkout PR Branch

**Description:** Fetches a PR from GitHub, creates a new jj bookmark (named `pr-<number>` or the original branch name), and immediately rebases it onto the latest target branch to ensure it's up-to-date.

**Example Command:** `jg pr checkout-rebase <pr-number> [--bookmark <name>]`

**Rationale:** Reviewing PRs often requires them to be up-to-date with the target branch. This combines checkout and rebase in one step for efficiency.

**Command Workflow:**
```bash
PR_NUMBER=$1
BOOKMARK_NAME=${2:-}

# 1. Get PR information
PR_INFO=$(gh pr view "$PR_NUMBER" --json headRefName,baseRefName,title)
HEAD_BRANCH=$(echo "$PR_INFO" | jq -r '.headRefName')
BASE_BRANCH=$(echo "$PR_INFO" | jq -r '.baseRefName')
PR_TITLE=$(echo "$PR_INFO" | jq -r '.title')

# 2. Use provided bookmark name or default to pr-<number>
if [ -z "$BOOKMARK_NAME" ]; then
  BOOKMARK_NAME="pr-$PR_NUMBER"
fi

echo "Checking out PR #$PR_NUMBER: $PR_TITLE"
echo "Head: $HEAD_BRANCH -> Bookmark: $BOOKMARK_NAME"
echo "Base: $BASE_BRANCH"

# 3. Fetch the PR branch
gh pr checkout "$PR_NUMBER"
jj git import

# 4. Create bookmark at the PR head
jj bookmark create "$BOOKMARK_NAME" -r "${HEAD_BRANCH}@origin"

# 5. Fetch latest base branch
jj git fetch --remote origin

# 6. Rebase the PR onto the latest base branch
echo "Rebasing $BOOKMARK_NAME onto latest $BASE_BRANCH..."
jj new "$BOOKMARK_NAME"
jj rebase -d "${BASE_BRANCH}@origin"

# 7. Show the result
echo -e "\n--- Rebased PR state ---"
jj log -r "@ | ${BASE_BRANCH}@origin" -n 10

# 8. If conflicts exist, show them
if jj log -r @ --no-graph -T 'conflict' | grep -q 'true'; then
  echo -e "\n⚠️  Conflicts detected!"
  jj resolve --list
fi
```

### Switch to PR Branch

**Description:** Instantly switch to a bookmark that has an open PR against main. If multiple PRs exist, presents an interactive selector (using fzf or similar) to choose which PR to switch to.

**Example Command:** `jg pr switch [--base <branch>]`

**Rationale:** Quick navigation between active PRs without remembering bookmark names. Integrates GitHub PR state with local jj workspace.

**Command Workflow:**
```bash
BASE_BRANCH=${1:-main}

# 1. Get all open PRs targeting the base branch
PR_LIST=$(gh pr list --base "$BASE_BRANCH" --json number,title,headRefName,author,updatedAt)

# 2. Check if any PRs exist
PR_COUNT=$(echo "$PR_LIST" | jq 'length')

if [ "$PR_COUNT" -eq 0 ]; then
  echo "No open PRs found targeting $BASE_BRANCH"
  exit 0
fi

# 3. Extract head branch names
HEAD_BRANCHES=$(echo "$PR_LIST" | jq -r '.[] | "\(.number)|\(.headRefName)|\(.title)|\(.author.login)"')

# 4. Filter to only PRs where we have local bookmarks
AVAILABLE_PRS=""
while IFS='|' read -r pr_num head_branch title author; do
  # Check if bookmark exists locally
  if jj bookmark list | grep -q "^${head_branch}\$"; then
    AVAILABLE_PRS="${AVAILABLE_PRS}#${pr_num} [${head_branch}] ${title} (@${author})\n"
  fi
done <<< "$HEAD_BRANCHES"

if [ -z "$AVAILABLE_PRS" ]; then
  echo "No local bookmarks found for open PRs"
  echo "Available PRs:"
  echo "$HEAD_BRANCHES" | while IFS='|' read -r pr_num head_branch title author; do
    echo "  #$pr_num [$head_branch] $title (@$author)"
  done
  exit 0
fi

# 5. Use fzf to select PR (if multiple available)
if command -v fzf &> /dev/null; then
  SELECTED=$(echo -e "$AVAILABLE_PRS" | fzf --height 40% --reverse --prompt "Select PR: ")
else
  # Fallback to simple selection
  echo -e "Available PRs:\n$AVAILABLE_PRS"
  echo -n "Enter PR number: "
  read PR_INPUT
  SELECTED="#${PR_INPUT}"
fi

# 6. Extract bookmark name from selection
BOOKMARK=$(echo "$SELECTED" | sed -n 's/.*\[\(.*\)\].*/\1/p')

if [ -z "$BOOKMARK" ]; then
  echo "No bookmark selected"
  exit 1
fi

# 7. Switch to the bookmark by creating a new working copy
echo "Switching to bookmark: $BOOKMARK"
jj new "$BOOKMARK"

# 8. Show current state
jj log -r @ -n 5
```

### Create Bookmark from Issue

**Description:** Create a new jj bookmark based on a GitHub issue, automatically naming it from the issue number and title, and setting the revision description to include issue metadata (title, body, labels). Starts new work on this bookmark based on the main branch.

**Example Command:** `jg issue start <issue-number> [--base <branch>]`

**Rationale:** Streamlines starting work on a GitHub issue by creating a properly named bookmark with issue context embedded in the revision description. Maintains traceability between issues and code changes.

**Command Workflow:**
```bash
ISSUE_NUMBER=$1
BASE_BRANCH=${2:-main}

# 1. Fetch issue information from GitHub
ISSUE_INFO=$(gh issue view "$ISSUE_NUMBER" --json number,title,body,labels,assignees)
ISSUE_TITLE=$(echo "$ISSUE_INFO" | jq -r '.title')
ISSUE_BODY=$(echo "$ISSUE_INFO" | jq -r '.body')
ISSUE_LABELS=$(echo "$ISSUE_INFO" | jq -r '.labels[].name' | paste -sd ',' -)
ISSUE_ASSIGNEES=$(echo "$ISSUE_INFO" | jq -r '.assignees[].login' | paste -sd ',' -)

# 2. Generate bookmark name from issue
# Convert title to kebab-case and prepend issue number
BOOKMARK_NAME=$(echo "$ISSUE_NUMBER-$ISSUE_TITLE" | \
  tr '[:upper:]' '[:lower:]' | \
  sed 's/[^a-z0-9-]/-/g' | \
  sed 's/--*/-/g' | \
  sed 's/^-//' | \
  sed 's/-$//' | \
  cut -c1-50)  # Limit length

echo "Creating bookmark: $BOOKMARK_NAME"
echo "Issue: #$ISSUE_NUMBER - $ISSUE_TITLE"

# 3. Ensure we have the latest base branch
jj git fetch --remote origin

# 4. Create new revision on base branch
jj new "${BASE_BRANCH}@origin"

# 5. Create bookmark at current revision
jj bookmark create "$BOOKMARK_NAME"

# 6. Set description with issue metadata
jj describe -m "$(cat <<EOF
$ISSUE_TITLE

$ISSUE_BODY

---
Issue: #$ISSUE_NUMBER
Labels: $ISSUE_LABELS
Assignees: $ISSUE_ASSIGNEES
EOF
)"

# 7. Show the created bookmark and revision
echo -e "\n--- Created bookmark ---"
jj log -r @ -n 3

echo -e "\n✅ Ready to start work on issue #$ISSUE_NUMBER"
echo "Bookmark: $BOOKMARK_NAME"
echo ""
echo "Next steps:"
echo "  1. Make your changes"
echo "  2. jj commit -m 'your changes'"
echo "  3. jj git push --bookmark $BOOKMARK_NAME"
echo "  4. gh pr create --title \"$ISSUE_TITLE\" --body \"Fixes #$ISSUE_NUMBER\""
```
