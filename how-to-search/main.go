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
	_, err = db.Exec(`CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(path, title, body)`)
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

func search(db *sql.DB, query string) error {
	rows, err := db.Query(`SELECT path, title FROM notes_fts WHERE notes_fts MATCH ?`, query)
	if err != nil {
		return err
	}
	defer rows.Close()

	found := false
	for rows.Next() {
		var path, title string
		if err := rows.Scan(&path, &title); err != nil {
			return err
		}
		fmt.Printf("%s  —  %s\n", path, title)
		found = true
	}
	if !found {
		fmt.Println("no results")
	}
	return rows.Err()
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "usage: note-search <query>\n")
		os.Exit(1)
	}
	query := os.Args[1]

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

	if err := search(db, query); err != nil {
		fmt.Fprintf(os.Stderr, "search error: %v\n", err)
		os.Exit(1)
	}
}
