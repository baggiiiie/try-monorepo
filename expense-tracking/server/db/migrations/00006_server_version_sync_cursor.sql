-- +goose Up
CREATE TABLE sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    current_version INTEGER NOT NULL
);

INSERT INTO sync_state (id, current_version) VALUES (1, 0);

ALTER TABLE categories ADD COLUMN server_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE expenses ADD COLUMN server_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recurring_expenses ADD COLUMN server_version INTEGER NOT NULL DEFAULT 0;

UPDATE sync_state
SET current_version = (
    SELECT COUNT(*) FROM (
        SELECT id FROM categories
        UNION ALL SELECT id FROM expenses
        UNION ALL SELECT id FROM recurring_expenses
    )
);

WITH ordered AS (
    SELECT 'categories' AS table_name, id, ROW_NUMBER() OVER (ORDER BY updated_at, id) AS version
    FROM categories
    UNION ALL
    SELECT 'expenses' AS table_name, id, (SELECT COUNT(*) FROM categories) + ROW_NUMBER() OVER (ORDER BY updated_at, id) AS version
    FROM expenses
    UNION ALL
    SELECT 'recurring_expenses' AS table_name, id,
           (SELECT COUNT(*) FROM categories) + (SELECT COUNT(*) FROM expenses) + ROW_NUMBER() OVER (ORDER BY updated_at, id) AS version
    FROM recurring_expenses
)
UPDATE categories
SET server_version = (SELECT version FROM ordered WHERE ordered.table_name = 'categories' AND ordered.id = categories.id);

WITH ordered AS (
    SELECT id, (SELECT COUNT(*) FROM categories) + ROW_NUMBER() OVER (ORDER BY updated_at, id) AS version
    FROM expenses
)
UPDATE expenses
SET server_version = (SELECT version FROM ordered WHERE ordered.id = expenses.id);

WITH ordered AS (
    SELECT id, (SELECT COUNT(*) FROM categories) + (SELECT COUNT(*) FROM expenses) + ROW_NUMBER() OVER (ORDER BY updated_at, id) AS version
    FROM recurring_expenses
)
UPDATE recurring_expenses
SET server_version = (SELECT version FROM ordered WHERE ordered.id = recurring_expenses.id);

CREATE INDEX idx_categories_server_version ON categories(server_version);
CREATE INDEX idx_expenses_server_version ON expenses(server_version);
CREATE INDEX idx_recurring_expenses_server_version ON recurring_expenses(server_version);

-- +goose StatementBegin
CREATE TRIGGER categories_server_version_insert
AFTER INSERT ON categories
WHEN NEW.server_version = 0
BEGIN
    UPDATE sync_state SET current_version = current_version + 1 WHERE id = 1;
    UPDATE categories SET server_version = (SELECT current_version FROM sync_state WHERE id = 1) WHERE id = NEW.id;
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER categories_server_version_update
AFTER UPDATE ON categories
WHEN NEW.server_version = OLD.server_version
BEGIN
    UPDATE sync_state SET current_version = current_version + 1 WHERE id = 1;
    UPDATE categories SET server_version = (SELECT current_version FROM sync_state WHERE id = 1) WHERE id = NEW.id;
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER expenses_server_version_insert
AFTER INSERT ON expenses
WHEN NEW.server_version = 0
BEGIN
    UPDATE sync_state SET current_version = current_version + 1 WHERE id = 1;
    UPDATE expenses SET server_version = (SELECT current_version FROM sync_state WHERE id = 1) WHERE id = NEW.id;
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER expenses_server_version_update
AFTER UPDATE ON expenses
WHEN NEW.server_version = OLD.server_version
BEGIN
    UPDATE sync_state SET current_version = current_version + 1 WHERE id = 1;
    UPDATE expenses SET server_version = (SELECT current_version FROM sync_state WHERE id = 1) WHERE id = NEW.id;
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER recurring_expenses_server_version_insert
AFTER INSERT ON recurring_expenses
WHEN NEW.server_version = 0
BEGIN
    UPDATE sync_state SET current_version = current_version + 1 WHERE id = 1;
    UPDATE recurring_expenses SET server_version = (SELECT current_version FROM sync_state WHERE id = 1) WHERE id = NEW.id;
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER recurring_expenses_server_version_update
AFTER UPDATE ON recurring_expenses
WHEN NEW.server_version = OLD.server_version
BEGIN
    UPDATE sync_state SET current_version = current_version + 1 WHERE id = 1;
    UPDATE recurring_expenses SET server_version = (SELECT current_version FROM sync_state WHERE id = 1) WHERE id = NEW.id;
END;
-- +goose StatementEnd

-- +goose Down
DROP TRIGGER IF EXISTS recurring_expenses_server_version_update;
DROP TRIGGER IF EXISTS recurring_expenses_server_version_insert;
DROP TRIGGER IF EXISTS expenses_server_version_update;
DROP TRIGGER IF EXISTS expenses_server_version_insert;
DROP TRIGGER IF EXISTS categories_server_version_update;
DROP TRIGGER IF EXISTS categories_server_version_insert;
DROP INDEX IF EXISTS idx_recurring_expenses_server_version;
DROP INDEX IF EXISTS idx_expenses_server_version;
DROP INDEX IF EXISTS idx_categories_server_version;
DROP TABLE sync_state;
-- Intentionally irreversible on SQLite: dropping server_version columns would require
-- rebuilding all synced tables and risks data loss in a rollback path. Down removes
-- active sync-version bookkeeping but leaves inert columns behind.
