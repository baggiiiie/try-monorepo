# step 7: incremental re-index

## goal

don't re-index unchanged files. track file modification times.

## concepts

- FTS5 tables don't have a primary key you can `UPDATE` by — you need a separate metadata table to track what's been indexed
- strategy: store `path` and `mtime` in a regular table. on re-index, compare current `mtime` with stored `mtime`. only re-index changed/new files, delete removed files.
- FTS5 supports `DELETE` but you need the `rowid`: `DELETE FROM notes_fts WHERE rowid = ?`
- you need to link the metadata table's rowid to the FTS table's rowid

## tasks

1. create a metadata table:
   ```sql
   CREATE TABLE IF NOT EXISTS notes_meta (
     path TEXT PRIMARY KEY,
     mtime INTEGER,
     fts_rowid INTEGER
   );
   ```
2. on index: after inserting into `notes_fts`, store `last_insert_rowid()` and `mtime` in `notes_meta`
3. on re-index:
   - for each `.md` file, check `notes_meta` for its `mtime`
   - if unchanged, skip
   - if changed, delete old FTS row (`DELETE FROM notes_fts WHERE rowid = ?`), re-insert, update meta
   - if file deleted from disk, delete from both tables
4. add a `--reindex` flag and a `--force-reindex` flag

## verify

- first run indexes all files
- second run (no changes) indexes nothing and is fast
- touch a file, re-run — only that file is re-indexed
