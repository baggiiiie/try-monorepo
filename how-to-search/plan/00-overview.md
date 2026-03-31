# note-search: learn SQLite FTS5 with Go + Bubbletea

a CLI/TUI tool that indexes markdown notes and searches them with SQLite FTS5.

## tech stack

- Go
- `mattn/go-sqlite3` (CGo SQLite binding)
- `charmbracelet/bubbletea` + `bubbles` (TUI)
- SQLite FTS5

## steps

1. [basic indexer + exact search](./01-basic-indexer.md)
2. [FTS5 match syntax](./02-match-syntax.md)
3. [ranking with bm25](./03-ranking.md)
4. [snippets and highlighting](./04-snippets.md)
5. [tokenizers and CJK support](./05-tokenizers.md)
6. [prefix queries and column filters](./06-prefix-and-columns.md)
7. [incremental re-index](./07-incremental-reindex.md)
8. [bubbletea TUI](./08-bubbletea-tui.md)
