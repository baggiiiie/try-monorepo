#!/bin/bash

# jj-sync-bookmarks.sh
# Synchronize jj bookmarks with GitHub branches

set -euo pipefail

# Default values
MODE=""
REMOTE="origin"
VERBOSE=false

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

usage() {
    cat <<EOF
Usage: $0 [--push|--pull|--all] [--remote <remote>] [--verbose]

Synchronize jj bookmarks with GitHub branches.

Options:
  --push              Push local bookmarks to remote branches
  --pull              Pull remote branches to local bookmarks
  --all               Sync in both directions (fetch, push, prune)
  --remote <remote>   Specify remote (default: origin)
  --verbose           Enable verbose output
  -h, --help          Show this help message

Examples:
  $0 --push                    # Push all local bookmarks to origin
  $0 --pull --remote upstream  # Pull branches from upstream
  $0 --all                     # Full bidirectional sync with origin

EOF
    exit 0
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
    --push)
        MODE="push"
        shift
        ;;
    --pull)
        MODE="pull"
        shift
        ;;
    --all)
        MODE="all"
        shift
        ;;
    --remote)
        REMOTE="$2"
        shift 2
        ;;
    --verbose)
        VERBOSE=true
        shift
        ;;
    -h | --help)
        usage
        ;;
    *)
        log_error "Unknown option: $1"
        usage
        ;;
    esac
done

# Validate we're in a jj repo
if ! jj root; then
    log_error "Not in a jj repository. Please run this command from a jj repo root."
    exit 1
fi

# Validate mode is set
if [[ -z $MODE ]]; then
    log_error "Please specify a sync mode: --push, --pull, or --all"
    usage
fi

# Validate remote exists
if ! git remote | grep -q "^${REMOTE}$"; then
    log_error "Remote '${REMOTE}' does not exist"
    log_info "Available remotes:"
    git remote
    exit 1
fi

# Push mode: Push all local bookmarks to remote
push_bookmarks() {
    log_info "Pushing local bookmarks to remote '${REMOTE}'..."

    # Get list of local bookmarks (excluding @git refs)
    local bookmarks
    bookmarks=$(
        jj bookmark list -T 'concat(name,"\n")' | sort -u
    )

    if [[ -z $bookmarks ]]; then
        log_warn "No local bookmarks found to push"
        return 0
    fi

    local pushed_count=0
    local failed_count=0

    while IFS= read -r bookmark; do
        [[ -z $bookmark ]] && continue

        if $VERBOSE; then
            log_info "Pushing bookmark: $bookmark"
        fi

        if jj git push --bookmark "$bookmark" --remote "$REMOTE" 2>&1; then
            ((pushed_count++))
            $VERBOSE && log_info "✓ Pushed: $bookmark"
        else
            ((failed_count++))
            log_warn "✗ Failed to push: $bookmark"
        fi
    done <<<"$bookmarks"

    log_info "Push complete: ${pushed_count} succeeded, ${failed_count} failed"
}

# Pull mode: Fetch remote branches and track them as bookmarks
pull_bookmarks() {
    log_info "Pulling remote branches from '${REMOTE}'..."

    # Fetch from remote first
    log_info "Fetching from remote..."
    if ! jj git fetch --remote "$REMOTE"; then
        log_error "Failed to fetch from remote '${REMOTE}'"
        exit 1
    fi

    # Get list of remote branches
    local remote_branches
    remote_branches=$(git branch -r | grep "^[[:space:]]*${REMOTE}/" | grep -v HEAD | sed "s|^[[:space:]]*${REMOTE}/||" || true)

    if [[ -z $remote_branches ]]; then
        log_warn "No remote branches found on '${REMOTE}'"
        return 0
    fi

    local tracked_count=0
    local failed_count=0

    while IFS= read -r branch; do
        [[ -z $branch ]] && continue

        if $VERBOSE; then
            log_info "Tracking remote bookmark: ${branch}@${REMOTE}"
        fi

        # Check if bookmark is already tracked
        if jj bookmark list --all 2>/dev/null | grep -q "${branch}@${REMOTE}"; then
            $VERBOSE && log_info "✓ Already tracked: ${branch}"
            ((tracked_count++))
        else
            # Track the remote bookmark
            if jj bookmark track "${branch}" --remote="${REMOTE}" 2>&1; then
                ((tracked_count++))
                $VERBOSE && log_info "✓ Tracked: ${branch}"
            else
                ((failed_count++))
                log_warn "✗ Failed to track: ${branch}"
            fi
        fi
    done <<<"$remote_branches"

    log_info "Pull complete: ${tracked_count} tracked, ${failed_count} failed"

    # Fetch again to update tracked bookmarks
    log_info "Updating tracked bookmarks..."
    jj git fetch --remote "$REMOTE"
}

# Sync all: Bidirectional sync with pruning
sync_all() {
    log_info "Starting full bidirectional sync with '${REMOTE}'..."

    # Step 1: Fetch from remote first
    log_info "Step 1/3: Fetching from remote..."
    if ! jj git fetch --remote "$REMOTE"; then
        log_error "Failed to fetch from remote '${REMOTE}'"
        exit 1
    fi

    # Step 2: Push all local bookmarks
    log_info "Step 2/3: Pushing local bookmarks..."
    push_bookmarks

    # Step 3: Prune deleted remote branches
    log_info "Step 3/3: Pruning stale bookmarks..."

    local bookmarks
    bookmarks=$(jj bookmark list | grep -v '@' | awk '{print $1}' | grep -v '^$' || true)

    local pruned_count=0

    while IFS= read -r bookmark; do
        [[ -z $bookmark ]] && continue

        # Check if bookmark exists on remote
        if ! git ls-remote --heads "$REMOTE" "$bookmark" 2>/dev/null | grep -q "$bookmark"; then
            if $VERBOSE; then
                log_info "Pruning stale bookmark: $bookmark"
            fi

            # Ask for confirmation unless in non-interactive mode
            if [[ -t 0 ]]; then
                read -p "Delete local bookmark '$bookmark' (not found on remote)? [y/N] " -n 1 -r
                echo
                if [[ $REPLY =~ ^[Yy]$ ]]; then
                    if jj bookmark delete "$bookmark" 2>&1; then
                        ((pruned_count++))
                        log_info "✓ Deleted: $bookmark"
                    else
                        log_warn "✗ Failed to delete: $bookmark"
                    fi
                fi
            else
                # Non-interactive mode: skip pruning
                $VERBOSE && log_warn "Skipping prune of '$bookmark' (non-interactive mode)"
            fi
        fi
    done <<<"$bookmarks"

    log_info "Prune complete: ${pruned_count} bookmarks deleted"
    log_info "Full sync complete!"
}

# Execute the appropriate mode
case $MODE in
push)
    push_bookmarks
    ;;
pull)
    pull_bookmarks
    ;;
all)
    sync_all
    ;;
esac

log_info "Done!"
