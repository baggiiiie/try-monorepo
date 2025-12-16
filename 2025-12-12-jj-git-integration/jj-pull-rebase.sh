#!/bin/bash

# step for pull rebase
# 1. find the changeid of where the branch to pull currently is
# 2. pull remote
# 3. rebase all children of changeid of old bookmark to pulled new branch

branch_to_fetch=${1:-"main"}

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

local_bookmark_change_id=$(jq -r '.change_id' <<<"$bookmark_info")

[ -z "$local_bookmark_change_id" ] && {
    echo "no local bookmark ${branch_to_fetch} is tracking remote"
    echo "bookmark info for '$branch_to_fetch' is: $bookmark_info"
    exit 1
}
echo "bookmark info for '$branch_to_fetch' is: $bookmark_info"

echo "2. fetch remote branch '$branch_to_fetch'"
jj git fetch --branch "$branch_to_fetch" || {
    echo "no remote branch to fetch"
    exit 0
}

echo "3. rebase children of change id '$local_bookmark_change_id' onto fetched branch '$branch_to_fetch'"
jj rebase -r "'children($local_bookmark_change_id)::~::$branch_to_fetch'" -o "'$branch_to_fetch'" --ignore-immutable
