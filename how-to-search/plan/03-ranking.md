# step 3: ranking with bm25

## goal

return results in relevance order instead of insertion order.

## concepts

- by default FTS5 returns results in arbitrary order
- `bm25()` is a built-in FTS5 ranking function implementing the Okapi BM25 algorithm
- BM25 considers: term frequency (how often the term appears), inverse document frequency (rarer terms score higher), document length (shorter docs with the same term count rank higher)
- you can weight columns: `bm25(notes_fts, 10.0, 5.0, 1.0)` — weight path=10, title=5, body=1 so title matches rank higher
- FTS5 has a special `rank` column that you can use after configuring a rank function

## tasks

1. change query to:
   ```sql
   SELECT path, title, bm25(notes_fts) as score
   FROM notes_fts
   WHERE notes_fts MATCH ?
   ORDER BY score;
   ```
   (note: bm25 returns negative values; lower = better match, so `ORDER BY score` ascending is correct)
2. print the score next to each result
3. experiment with column weights: `bm25(notes_fts, 0.0, 5.0, 1.0)` — zero out path, boost title
4. try a query that appears in multiple files and verify the ranking makes sense

## verify

- results are now ordered by relevance
- a term in the title ranks that doc higher than the same term only in the body
