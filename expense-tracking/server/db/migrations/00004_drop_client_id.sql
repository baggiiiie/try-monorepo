-- +goose Up
-- Complete Path C: id is the single canonical client-minted identifier.
-- Rebuild tables because SQLite cannot DROP COLUMN while unique indexes and
-- foreign keys reference client_id in older schemas.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE categories_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    budget INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);

INSERT INTO categories_new (id, name, icon, budget, created_at, updated_at, deleted_at)
SELECT id, name, icon, budget, created_at, updated_at, deleted_at
FROM categories;

CREATE TABLE expenses_new (
    id TEXT PRIMARY KEY,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    category_id TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    merchant TEXT NOT NULL DEFAULT '',
    date INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'cli',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

INSERT INTO expenses_new (id, amount, currency, category_id, description, merchant, date, source, created_at, updated_at, deleted_at)
SELECT id, amount, currency, category_id, description, merchant, date, source, created_at, updated_at, deleted_at
FROM expenses;

DROP TABLE expenses;
DROP TABLE categories;

ALTER TABLE categories_new RENAME TO categories;
ALTER TABLE expenses_new RENAME TO expenses;

CREATE INDEX idx_categories_updated_at ON categories(updated_at);
CREATE UNIQUE INDEX idx_categories_name_active ON categories(name) WHERE deleted_at IS NULL;
CREATE INDEX idx_expenses_category_id ON expenses(category_id);
CREATE INDEX idx_expenses_updated_at ON expenses(updated_at);
CREATE INDEX idx_expenses_date ON expenses(date);

-- +goose Down
-- Best-effort compatibility rollback: mirror id back into client_id.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE categories_old (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    budget INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);

INSERT INTO categories_old (id, client_id, name, icon, budget, created_at, updated_at, deleted_at)
SELECT id, id, name, icon, budget, created_at, updated_at, deleted_at
FROM categories;

CREATE TABLE expenses_old (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL UNIQUE,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    category_id TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    merchant TEXT NOT NULL DEFAULT '',
    date INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'cli',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

INSERT INTO expenses_old (id, client_id, amount, currency, category_id, description, merchant, date, source, created_at, updated_at, deleted_at)
SELECT id, id, amount, currency, category_id, description, merchant, date, source, created_at, updated_at, deleted_at
FROM expenses;

DROP TABLE expenses;
DROP TABLE categories;

ALTER TABLE categories_old RENAME TO categories;
ALTER TABLE expenses_old RENAME TO expenses;

CREATE INDEX idx_categories_updated_at ON categories(updated_at);
CREATE UNIQUE INDEX idx_categories_name_active ON categories(name) WHERE deleted_at IS NULL;
CREATE INDEX idx_expenses_category_id ON expenses(category_id);
CREATE INDEX idx_expenses_updated_at ON expenses(updated_at);
CREATE INDEX idx_expenses_date ON expenses(date);
