# step 2: FTS5 MATCH syntax

## goal

learn the query language FTS5 gives you for free.

## concepts

- `MATCH` is the FTS5 query operator. you don't use `LIKE` or `=`; you use `MATCH`.
- **AND**: `markdown block` — both terms must appear (implicit AND)
- **OR**: `markdown OR html` — either term
- **NOT**: `markdown NOT html` — first but not second
- **phrase**: `"code block"` — exact phrase, terms must be adjacent
- **NEAR**: `NEAR(markdown html, 5)` — terms within 5 tokens of each other

## tasks

1. after step 1 works, try these queries and observe results:
   - `go run . "markdown block"` (implicit AND)
   - `go run . "markdown OR html"`
   - `go run . "list NOT ordered"`
   - `go run . '"code block"'` (phrase, note shell quoting)
   - `go run . "NEAR(markdown html, 10)"`
2. add a `--explain` flag that prints the query being sent to SQLite, so you can see what's happening
3. try an invalid query (e.g., unbalanced quotes) and handle the error gracefully

## verify

- phrase search for `"code block"` matches `writing-a-ssg.md` only
- `NOT` excludes results as expected
