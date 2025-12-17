#!/bin/bash

# step for pull rebase
# 1. find the changeid of where the branch to pull currently is
# 2. pull remote
# 3. rebase all children of changeid of old bookmark to pulled new branch

branch_to_fetch=${1:-"main"}
remote=${1:-"origin"}

jj bookmark track "$branch_to_fetch@$remote" || {
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
remote_bookmark_commit_id=$(jq -r 'select(.remote != null).commit_id' <<<"$bookmark_info")

[ -z "$local_bookmark_commit_id" ] && {
    echo "no local bookmark ${branch_to_fetch} is tracking remote"
    echo "bookmark info for '$branch_to_fetch' is: $bookmark_info"
    exit 1
}
[ -z "$remote_bookmark_commit_id" ] && {
    echo "remote bookmark does not exist for branch ${branch_to_fetch}, probably untracked"
}
echo "bookmark info for '$branch_to_fetch' is: $bookmark_info"

echo "2. fetch remote branch '$branch_to_fetch'"
jj git fetch --branch "$branch_to_fetch" || {
    echo "no remote branch to fetch"
    exit 0
}

echo "3. rebase children of change id '$local_bookmark_commit_id' onto fetched branch '$branch_to_fetch'"
jj rebase -r "children($local_bookmark_commit_id)::~::$remote_bookmark_commit_id" --onto "'$remote_bookmark_commit_id'" --ignore-immutable
