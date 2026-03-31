# step 4: snippets and highlighting

## goal

show *where* in the document the match was found, with the matching terms highlighted.

## concepts

- `snippet(notes_fts, col, marker_start, marker_end, ellipsis, max_tokens)` — returns a short excerpt around the match
  - `col`: which column (0=path, 1=title, 2=body)
  - markers wrap the matched term, e.g., `'>>>'` and `'<<<'` or ANSI codes for terminal color
  - `max_tokens`: how many tokens of context around the match
- `highlight(notes_fts, col, marker_start, marker_end)` — returns the full column text with matched terms wrapped in markers

## tasks

1. change query to include a snippet:
   ```sql
   SELECT path, title, 
     snippet(notes_fts, 2, '**', '**', '...', 20) as context,
     bm25(notes_fts) as score
   FROM notes_fts WHERE notes_fts MATCH ?
   ORDER BY score;
   ```
2. print the snippet below each result, like:
   ```
   writing-a-ssg.md (score: -2.34)
     ...convert that input **markdown** into different **blocks**...
   ```
3. swap `'**'` markers for ANSI color codes (`\033[1;33m` / `\033[0m`) for colored terminal output
4. try `highlight()` instead of `snippet()` on the title column to see the difference

## verify

- snippets show the matching terms surrounded by markers
- context is concise (~20 tokens) with ellipsis for truncation
