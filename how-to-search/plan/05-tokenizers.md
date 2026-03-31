# step 5: tokenizers and CJK support

## goal

make search work properly for non-ASCII content (your notes have Chinese text).

## concepts

- a **tokenizer** breaks text into searchable tokens. FTS5 ships with:
  - `unicode61` (default) — splits on unicode-defined word boundaries. handles accents via `remove_diacritics`. does NOT handle CJK well because CJK has no spaces between words.
  - `ascii` — ASCII-only splitting, worst for your use case
  - `porter` — wraps another tokenizer and applies porter stemming (`running` → `run`). english only.
  - `trigram` — indexes every 3-byte sequence. works for CJK and substring matching but produces a much larger index.
- for CJK: `trigram` is the practical choice unless you bring an external segmentation library (like jieba)
- you can specify tokenizer when creating the table:
  ```sql
  CREATE VIRTUAL TABLE notes_fts USING fts5(
    path, title, body,
    tokenize='trigram'
  );
  ```
- tradeoff: `trigram` makes the index larger and doesn't understand word boundaries, but it enables substring search for all languages

## tasks

1. first, try searching a Chinese term from `what to read.md` with the default tokenizer — observe it fails or returns unexpected results
2. recreate the table with `tokenize='trigram'`
3. re-index and search the same Chinese term — it should now work
4. also try: with trigram, `"markd"` now matches `"markdown"` (substring matching for free!)
5. try a combined tokenizer: `tokenize="trigram remove_diacritics 1"` if you want accent-insensitive search too
6. consider: you could keep two FTS tables (one `unicode61` for english, one `trigram` for CJK) or just use `trigram` for everything

## verify

- searching `操作系统` matches `what to read.md`
- substring search like `"markd"` works with trigram
