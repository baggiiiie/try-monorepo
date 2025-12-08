rev=$(jj log --no-graph -T 'change_id.shortest() ++ "\n"' -r 'main..@')
while read -r line; do
    count=0
    while [ $count -le 1 ]; do
        if ! uv run pre-commit run --files "$(jj diff -r "$line" --name-only)"; then
            count=$((count + 1))
        else
            break
        fi
    done
    if [[ $count -gt 1 ]]; then
        echo "Pre-commit checks failed for change $line"
        exit 1
    fi
    echo
done <<<"$rev"
