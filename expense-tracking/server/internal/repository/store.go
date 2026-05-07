package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	dbsqlc "expense-tracker/internal/repository/sqlc"
)

// Store centralizes data-layer access. It owns the *sql.DB, exposes
// the sqlc-generated Queries for plain reads/writes, and provides
// transaction helpers for callers that need to perform multiple queries
// inside a single SQLite snapshot.
type Store struct {
	db      *sql.DB
	queries *dbsqlc.Queries
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db, queries: dbsqlc.New(db)}
}

func (s *Store) Queries() *dbsqlc.Queries { return s.queries }

// WithTx runs fn inside a single SQLite write transaction and commits on
// success. The transaction is rolled back if fn returns an error.
//
// `PRAGMA defer_foreign_keys = ON` is set so callers can perform
// multi-row inserts/updates whose intermediate states would otherwise
// fail SQLite's immediate foreign-key checks; the constraints are
// still enforced at commit time.
func (s *Store) WithTx(ctx context.Context, fn func(*dbsqlc.Queries) error) error {
	return execWithBusyRetry(ctx, func() error {
		return s.withTxOnce(ctx, "BEGIN IMMEDIATE", txOptions{
			deferForeignKeys: true,
		}, fn)
	})
}

// WithReadTx runs fn inside a single SQLite read-only transaction.
// `BEGIN DEFERRED` pins one consistent snapshot for the whole callback,
// and `PRAGMA query_only = ON` ensures the callback cannot write.
func (s *Store) WithReadTx(ctx context.Context, fn func(*dbsqlc.Queries) error) error {
	return execWithBusyRetry(ctx, func() error {
		return s.withTxOnce(ctx, "BEGIN DEFERRED", txOptions{
			queryOnly: true,
		}, fn)
	})
}

type txOptions struct {
	deferForeignKeys bool
	queryOnly        bool
}

func (s *Store) withTxOnce(ctx context.Context, begin string, options txOptions, fn func(*dbsqlc.Queries) error) error {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	if options.queryOnly {
		if _, err := conn.ExecContext(ctx, "PRAGMA query_only = ON"); err != nil {
			return fmt.Errorf("enabling query_only: %w", err)
		}
	}

	committed := false
	defer func() {
		if !committed {
			_, _ = conn.ExecContext(context.Background(), "ROLLBACK")
		}
		if options.queryOnly {
			_, _ = conn.ExecContext(context.Background(), "PRAGMA query_only = OFF")
		}
	}()

	if err := execWithBusyRetry(ctx, func() error {
		_, err := conn.ExecContext(ctx, begin)
		return err
	}); err != nil {
		return err
	}

	if options.deferForeignKeys {
		if _, err := conn.ExecContext(ctx, "PRAGMA defer_foreign_keys = ON"); err != nil {
			return fmt.Errorf("enabling deferred foreign keys: %w", err)
		}
	}

	if err := fn(dbsqlc.New(retryDBTX{ctx: ctx, conn: conn})); err != nil {
		return err
	}
	if err := execWithBusyRetry(ctx, func() error {
		_, err := conn.ExecContext(ctx, "COMMIT")
		return err
	}); err != nil {
		return err
	}
	committed = true
	return nil
}

type retryDBTX struct {
	ctx  context.Context
	conn *sql.Conn
}

func (db retryDBTX) ExecContext(ctx context.Context, query string, args ...interface{}) (sql.Result, error) {
	var result sql.Result
	err := execWithBusyRetry(db.context(ctx), func() error {
		var err error
		result, err = db.conn.ExecContext(ctx, query, args...)
		return err
	})
	return result, err
}

func (db retryDBTX) PrepareContext(ctx context.Context, query string) (*sql.Stmt, error) {
	var stmt *sql.Stmt
	err := execWithBusyRetry(db.context(ctx), func() error {
		var err error
		stmt, err = db.conn.PrepareContext(ctx, query)
		return err
	})
	return stmt, err
}

func (db retryDBTX) QueryContext(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error) {
	var rows *sql.Rows
	err := execWithBusyRetry(db.context(ctx), func() error {
		var err error
		rows, err = db.conn.QueryContext(ctx, query, args...)
		return err
	})
	return rows, err
}

func (db retryDBTX) QueryRowContext(ctx context.Context, query string, args ...interface{}) *sql.Row {
	return db.conn.QueryRowContext(ctx, query, args...)
}

func (db retryDBTX) context(ctx context.Context) context.Context {
	if ctx != nil {
		return ctx
	}
	return db.ctx
}

func execWithBusyRetry(ctx context.Context, fn func() error) error {
	var err error
	backoff := 10 * time.Millisecond
	deadline := time.Now().Add(2 * time.Second)
	for {
		err = fn()
		if err == nil || !isSQLiteBusy(err) || time.Now().After(deadline) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
		if backoff < 250*time.Millisecond {
			backoff *= 2
		}
	}
}

func isSQLiteBusy(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "sqlite_busy") || strings.Contains(msg, "database is locked") || strings.Contains(msg, "database table is locked")
}
