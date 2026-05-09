-- +goose Up
-- ADR 007: split the conflict-resolution clock from the audit "server received at"
-- column. Each syncable table now carries `client_updated_at`, the value the
-- client claims at edit time. `updated_at` continues to exist as a server-stamped
-- audit column but is no longer load-bearing for LWW.
ALTER TABLE expenses ADD COLUMN client_updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN client_updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recurring_expenses ADD COLUMN client_updated_at INTEGER NOT NULL DEFAULT 0;

-- Backfill: at this point in time `updated_at` was being used as the
-- conflict-resolution clock, so it is the best available approximation of
-- `client_updated_at` for already-stored rows.
UPDATE expenses SET client_updated_at = updated_at;
UPDATE categories SET client_updated_at = updated_at;
UPDATE recurring_expenses SET client_updated_at = updated_at;

CREATE INDEX idx_expenses_client_updated_at ON expenses(client_updated_at);
CREATE INDEX idx_categories_client_updated_at ON categories(client_updated_at);
CREATE INDEX idx_recurring_expenses_client_updated_at ON recurring_expenses(client_updated_at);

-- +goose Down
DROP INDEX IF EXISTS idx_recurring_expenses_client_updated_at;
DROP INDEX IF EXISTS idx_categories_client_updated_at;
DROP INDEX IF EXISTS idx_expenses_client_updated_at;
-- Intentionally irreversible on SQLite: dropping client_updated_at columns
-- would require rebuilding all synced tables and risks data loss in a rollback
-- path. Down removes the indexes but leaves inert columns behind.
