# step 6: prefix queries and column filters

## goal

search by prefix (autocomplete-style) and target specific columns.

## concepts

- **prefix queries**: `mark*` matches `markdown`, `markers`, `markup`, etc. add `*` to the end of a term.
  - for prefix queries to be fast, you can add a prefix index: `CREATE VIRTUAL TABLE ... USING fts5(..., prefix='2,3')` — pre-indexes 2 and 3 character prefixes
- **column filters**: `title:markdown` searches only the `title` column. `body:html` searches only `body`.
  - syntax: `{column_name}:{term}`
  - you can combine: `title:markdown body:block`
- both features are part of FTS5's query syntax — no code changes needed, just query strings

## tasks

1. try prefix search: `go run . "mark*"` — should match anything with markdown, markers, etc.
2. try column filter: `go run . "title:markdown"` vs `go run . "body:markdown"`
3. recreate the table with a prefix index:
   ```sql
   CREATE VIRTUAL TABLE notes_fts USING fts5(
     path, title, body,
     tokenize='trigram',
     prefix='2,3'
   );
   ```
4. benchmark: time a prefix query before and after adding the prefix index (probably not noticeable with 4 files, but the concept matters)
5. note: if you're using `trigram` tokenizer, prefix queries overlap with substring matching — compare behavior

## verify

- `"mark*"` returns results containing `markdown`
- `"title:ssg"` matches `writing-a-ssg.md` but `"body:ssg"` behavior may differ
