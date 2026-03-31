# step 8: bubbletea TUI

## goal

interactive search-as-you-type UI in the terminal.

## concepts

- bubbletea uses the Elm architecture: `Model`, `Update`, `View`
- `bubbles/textinput` — the search box
- `bubbles/list` or `bubbles/viewport` — display results
- debounce: don't query on every keystroke, wait ~100ms after the user stops typing
- the SQLite query runs synchronously (fast enough for local files), return results as a `tea.Msg`

## tasks

1. add `charmbracelet/bubbletea`, `charmbracelet/bubbles`, `charmbracelet/lipgloss`
2. define the model:
   ```go
   type model struct {
     input    textinput.Model
     results  []SearchResult  // path, title, snippet, score
     db       *sql.DB
     // ...
   }
   ```
3. on each keystroke (or debounced), run the FTS5 query from previous steps and update `results`
4. render: search box on top, results below with highlighted snippets
5. keybindings: `up/down` to navigate results, `enter` to open file (or just print path), `esc/ctrl+c` to quit
6. use lipgloss for styling: dim the score, bold the filename, color the matched terms in snippets
7. (optional) add a preview pane on the right showing more context from the selected result

## verify

- typing in the search box updates results in real time
- results show snippets with highlighted terms
- navigating with arrow keys works
- it doesn't crash on empty queries or no results
