# step 1: basic indexer + exact search

## goal

walk `notes/` dir, read each `.md` file, store content in an FTS5 virtual table, query it.

## concepts

- `CREATE VIRTUAL TABLE ... USING fts5(...)` — this is how you create an FTS-enabled table. it's not a normal table; SQLite builds an inverted index behind the scenes.
- FTS5 is an extension, not core SQL. `mattn/go-sqlite3` includes it if you build with the right tags.

## tasks

1. `go mod init note-search`, add `mattn/go-sqlite3`
2. create a function that opens/creates a SQLite DB and runs:
   ```sql
   CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
     path,
     title,
     body
   );
   ```
3. walk `notes/` dir with `filepath.WalkDir`, for each `.md` file:
   - extract title (first `# ` line, or filename if none)
   - read full body
   - `INSERT INTO notes_fts(path, title, body) VALUES (?, ?, ?)`
4. accept a search query from CLI args, run:
   ```sql
   SELECT path, title FROM notes_fts WHERE notes_fts MATCH ? ;
   ```
   print results.
5. try searching: `go run . "markdown"`, `go run . "list"`

## verify

- `go run . "markdown"` returns `writing-a-ssg.md` (and possibly others)
- searching a word that doesn't exist returns nothing
