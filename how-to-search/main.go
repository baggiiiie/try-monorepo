package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	_ "github.com/mattn/go-sqlite3"
)

// --- database helpers (unchanged) ---

func openDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		return nil, err
	}
	_, err = db.Exec(`CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(path, title, body, tokenize='trigram')`)
	if err != nil {
		return nil, err
	}
	return db, nil
}

func extractTitle(content string) string {
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "# ") {
			return strings.TrimPrefix(line, "# ")
		}
	}
	return ""
}

func indexNotes(db *sql.DB, dir string) error {
	_, err := db.Exec(`DELETE FROM notes_fts`)
	if err != nil {
		return err
	}

	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return err
	}

	return filepath.WalkDir(resolved, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(d.Name(), ".md") {
			return nil
		}

		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}

		body := string(data)
		title := extractTitle(body)
		if title == "" {
			title = strings.TrimSuffix(d.Name(), ".md")
		}

		relPath, _ := filepath.Rel(resolved, path)
		_, err = db.Exec(`INSERT INTO notes_fts(path, title, body) VALUES (?, ?, ?)`, relPath, title, body)
		return err
	})
}

// --- search result type ---

type searchResult struct {
	path    string
	title   string
	snippet string
	score   float64
}

func queryNotes(db *sql.DB, query string) []searchResult {
	if query == "" {
		return nil
	}

	rows, err := db.Query(`
		SELECT path,
			highlight(notes_fts, 1, '<<', '>>') as title,
			snippet(notes_fts, 2, '<<', '>>', '...', 20) as context,
			bm25(notes_fts, 0.0, 5.0, 1.0) as score
		FROM notes_fts
		WHERE notes_fts MATCH ?
		ORDER BY score
		LIMIT 20`, query)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var results []searchResult
	for rows.Next() {
		var r searchResult
		if err := rows.Scan(&r.path, &r.title, &r.snippet, &r.score); err != nil {
			continue
		}
		results = append(results, r)
	}
	return results
}

// --- bubbletea TUI ---

type searchDoneMsg struct {
	results []searchResult
}

type debounceMsg struct {
	query string
}

type model struct {
	input   textinput.Model
	results []searchResult
	cursor  int
	db      *sql.DB
	width   int
	height  int
	lastQ   string
}

func newModel(db *sql.DB) model {
	ti := textinput.New()
	ti.Placeholder = "search notes..."
	ti.Focus()
	return model{input: ti, db: db}
}

func (m model) Init() tea.Cmd {
	return textinput.Blink
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "esc":
			return m, tea.Quit
		case "up":
			if m.cursor > 0 {
				m.cursor--
			}
			return m, nil
		case "down":
			if m.cursor < len(m.results)-1 {
				m.cursor++
			}
			return m, nil
		case "enter":
			if m.cursor < len(m.results) {
				r := m.results[m.cursor]
				// print selected path after quitting
				return m, tea.Sequence(
					tea.Println(r.path),
					tea.Quit,
				)
			}
			return m, nil
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case debounceMsg:
		// only run query if input hasn't changed since debounce was scheduled
		if msg.query == m.input.Value() {
			results := queryNotes(m.db, msg.query)
			return m, func() tea.Msg { return searchDoneMsg{results} }
		}
		return m, nil

	case searchDoneMsg:
		m.results = msg.results
		m.cursor = 0
		return m, nil
	}

	var cmd tea.Cmd
	m.input, cmd = m.input.Update(msg)

	// if the query text changed, schedule a debounced search
	if m.input.Value() != m.lastQ {
		m.lastQ = m.input.Value()
		q := m.lastQ
		return m, tea.Batch(cmd, tea.Tick(100*time.Millisecond, func(time.Time) tea.Msg {
			return debounceMsg{query: q}
		}))
	}

	return m, cmd
}

// --- styles ---

var (
	titleStyle     = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("12"))
	pathStyle      = lipgloss.NewStyle().Faint(true)
	scoreStyle     = lipgloss.NewStyle().Faint(true)
	snippetStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("7"))
	selectedStyle  = lipgloss.NewStyle().Background(lipgloss.Color("236"))
	matchStyle     = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("11"))
	helpStyle      = lipgloss.NewStyle().Faint(true)
)

func highlightMatches(s string, base lipgloss.Style) string {
	var b strings.Builder
	for {
		start := strings.Index(s, "<<")
		if start == -1 {
			b.WriteString(base.Render(s))
			break
		}
		end := strings.Index(s, ">>")
		if end == -1 {
			b.WriteString(base.Render(s))
			break
		}
		b.WriteString(base.Render(s[:start]))
		b.WriteString(matchStyle.Render(s[start+2 : end]))
		s = s[end+2:]
	}
	return b.String()
}

func (m model) View() string {
	var b strings.Builder

	// search box
	b.WriteString(m.input.View())
	b.WriteString("\n\n")

	if m.input.Value() == "" {
		b.WriteString(helpStyle.Render("type to search • ↑↓ navigate • enter select • esc quit"))
		return b.String()
	}

	if len(m.results) == 0 {
		b.WriteString(helpStyle.Render("no results"))
		return b.String()
	}

	// show how many results we have available
	maxVisible := m.height - 5
	if maxVisible < 1 {
		maxVisible = 10
	}

	for i, r := range m.results {
		if i >= maxVisible {
			break
		}

		title := highlightMatches(r.title, titleStyle)
		path := pathStyle.Render(r.path)
		score := scoreStyle.Render(fmt.Sprintf("%.2f", r.score))
		snippet := highlightMatches(r.snippet, snippetStyle)

		line := fmt.Sprintf("%s  %s  %s\n  %s", title, path, score, snippet)

		if i == m.cursor {
			line = selectedStyle.Render(line)
		}

		b.WriteString(line)
		b.WriteString("\n\n")
	}

	return b.String()
}

// --- main ---

func main() {
	db, err := openDB("notes.db")
	if err != nil {
		fmt.Fprintf(os.Stderr, "db error: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := indexNotes(db, "notes"); err != nil {
		fmt.Fprintf(os.Stderr, "index error: %v\n", err)
		os.Exit(1)
	}

	p := tea.NewProgram(newModel(db), tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}
