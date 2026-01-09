#!/bin/bash

# step for pull rebase
# 1. find the changeid of where the branch to pull currently is
# 2. pull remote
# 3. rebase all children of changeid of old bookmark to pulled new branch

# Parse command line arguments
branch_to_fetch="main"
remote="origin"
local_tree_root="$branch_to_fetch"

while [[ $# -gt 0 ]]; do
    case $1 in
    -b | --branch)
        branch_to_fetch="$2"
        shift 2
        ;;
    --remote)
        remote="$2"
        shift 2
        ;;
    --root)
        local_tree_root="$2"
        shift 2
        ;;
    -h | --help)
        echo "Usage: $0 [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  -b, --branch BRANCH    Branch to fetch (default: main)"
        echo "  -R, --remote REMOTE    Remote to fetch from (default: origin)"
        echo "  -h, --help             Show this help message"
        exit 0
        ;;
    *)
        echo "Unknown option: $1"
        echo "Use -h or --help for usage information"
        exit 1
        ;;
    esac
done

jj bookmark track "$branch_to_fetch" --remote="$remote" || {
    echo "failed to track remote branch '$branch_to_fetch' from remote '$remote'"
    exit 1
}

echo "1. get current bookmark info"
# bookmark_info=$(jj bookmark list "$branch_to_fetch" -T '"{" ++
#   "\"name\": " ++ name.escape_json() ++ ", " ++
#   "\"remote\": " ++ if(remote, remote.escape_json(), "null") ++ ", " ++
#   "\"change_id\": \"" ++ normal_target.change_id().shortest(8) ++ "\", " ++
#   "\"commit_id\": \"" ++ normal_target.commit_id().shortest(8) ++ "\"" ++
#   "}\n"' | jq)
bookmark_info=$(jj bookmark list "$branch_to_fetch" -T '"{" ++
  "\"name\": " ++ name.escape_json() ++ ", " ++
  "\"remote\": " ++ if(remote, remote.escape_json(), "null") ++ ", " ++
  "\"change_id\": \"" ++ normal_target.change_id().shortest(8) ++ "\", " ++
  "\"commit_id\": \"" ++ normal_target.commit_id().shortest(8) ++ "\"" ++
  "}\n"' | jq)

local_bookmark_commit_id=$(jq -r 'select(.remote == null).commit_id' <<<"$bookmark_info")

[ -z "$local_bookmark_commit_id" ] && {
    echo "no local bookmark ${branch_to_fetch} is tracking remote"
    echo "bookmark info for '$branch_to_fetch' is: $bookmark_info"
    exit 1
}

echo "2. fetch remote branch '$branch_to_fetch'"
jj git fetch --branch "$branch_to_fetch" --remote "$remote" || {
    echo "no remote branch to fetch: $branch_to_fetch@$remote"
    exit 0
}
bookmark_info=$(jj bookmark list "$branch_to_fetch" -T '"{" ++
  "\"name\": " ++ name.escape_json() ++ ", " ++
  "\"remote\": " ++ if(remote, remote.escape_json(), "null") ++ ", " ++
  "\"change_id\": \"" ++ normal_target.change_id().shortest(8) ++ "\", " ++
  "\"commit_id\": \"" ++ normal_target.commit_id().shortest(8) ++ "\"" ++
  "}\n"' | jq)
remote_bookmark_commit_id=$(jq -r "select(.remote == null).commit_id" <<<"$bookmark_info")
[ -z "$remote_bookmark_commit_id" ] && {
    echo "remote bookmark does not exist for branch ${branch_to_fetch}, probably untracked"
}
echo "bookmark info for '$branch_to_fetch' is: $bookmark_info"

echo "3. rebase children of change id '$local_bookmark_commit_id' onto fetched branch '$branch_to_fetch'"
jj rebase -r "children($local_bookmark_commit_id)::~..$remote_bookmark_commit_id&mine()" --onto "'$remote_bookmark_commit_id'" --ignore-immutable
