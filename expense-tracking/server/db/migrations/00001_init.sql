-- +goose Up
CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    budget INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);

CREATE INDEX idx_categories_updated_at ON categories(updated_at);
CREATE UNIQUE INDEX idx_categories_name_active ON categories(name) WHERE deleted_at IS NULL;

CREATE TABLE expenses (
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

CREATE INDEX idx_expenses_category_id ON expenses(category_id);
CREATE INDEX idx_expenses_updated_at ON expenses(updated_at);
CREATE INDEX idx_expenses_date ON expenses(date);

-- +goose Down
DROP TABLE expenses;
DROP TABLE categories;
