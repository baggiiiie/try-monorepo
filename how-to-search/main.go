package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

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
	// clear existing data so re-runs don't duplicate
	_, err := db.Exec(`DELETE FROM notes_fts`)
	if err != nil {
		return err
	}

	// resolve symlinks so WalkDir traverses the actual directory
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

func search(db *sql.DB, query string, explain bool) error {
	if explain {
		fmt.Fprintf(os.Stderr, "[MATCH] %s\n", query)
	}

	const (
		highlightStart = "\033[1;33m"
		highlightEnd   = "\033[0m"
	)

	rows, err := db.Query(`
		SELECT path,
			highlight(notes_fts, 1, ?, ?) as highlighted_title,
			snippet(notes_fts, 2, ?, ?, '...', 20) as context,
			bm25(notes_fts, 0.0, 5.0, 1.0) as score
		FROM notes_fts
		WHERE notes_fts MATCH ?
		ORDER BY score`, highlightStart, highlightEnd, highlightStart, highlightEnd, query)
	if err != nil {
		return fmt.Errorf("bad query %q: %w", query, err)
	}
	defer rows.Close()

	found := false
	for rows.Next() {
		var path, highlightedTitle, context string
		var score float64
		if err := rows.Scan(&path, &highlightedTitle, &context, &score); err != nil {
			return err
		}
		fmt.Printf("%s (score: %.2f)\n", highlightedTitle, score)
		fmt.Printf("  %s\n\n", context)
		found = true
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("bad query %q: %w", query, err)
	}
	if !found {
		fmt.Println("no results")
	}
	return nil
}

func main() {
	explain := false
	args := os.Args[1:]

	// check for --explain flag
	var filtered []string
	for _, a := range args {
		if a == "--explain" {
			explain = true
		} else {
			filtered = append(filtered, a)
		}
	}

	if len(filtered) < 1 {
		fmt.Fprintf(os.Stderr, "usage: note-search [--explain] <query>\n")
		os.Exit(1)
	}
	query := filtered[0]

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

	if err := search(db, query, explain); err != nil {
		fmt.Fprintf(os.Stderr, "search error: %v\n", err)
		os.Exit(1)
	}
}
