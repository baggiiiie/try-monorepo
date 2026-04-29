package repository

import (
	"context"
	"database/sql"
	"fmt"

	dbsqlc "expense-tracker/internal/repository/sqlc"
)

// Store centralizes data-layer access. It owns the *sql.DB, exposes
// the sqlc-generated Queries for plain reads/writes, and provides
// WithTx for callers that need to perform multiple queries inside a
// single transaction.
type Store struct {
	db      *sql.DB
	queries *dbsqlc.Queries
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db, queries: dbsqlc.New(db)}
}

func (s *Store) Queries() *dbsqlc.Queries { return s.queries }

// WithTx runs fn inside a single SQLite transaction and commits on
// success. The transaction is rolled back if fn returns an error.
//
// `PRAGMA defer_foreign_keys = ON` is set so callers can perform
// multi-row inserts/updates whose intermediate states would otherwise
// fail SQLite's immediate foreign-key checks; the constraints are
// still enforced at commit time.
func (s *Store) WithTx(ctx context.Context, fn func(*dbsqlc.Queries) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, "PRAGMA defer_foreign_keys = ON"); err != nil {
		return fmt.Errorf("enabling deferred foreign keys: %w", err)
	}

	if err := fn(s.queries.WithTx(tx)); err != nil {
		return err
	}
	return tx.Commit()
}
