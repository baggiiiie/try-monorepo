-- +goose Up
--
-- Server-side wallet suggestions are how the Apple Pay Shortcut delivers a
-- "you just tapped your card, want to log this?" hint to *both* clients.
-- The Shortcut posts here, the PWA fetches via REST, and iOS pulls via the
-- sync protocol — so the table participates in the same server_version
-- cursor as expenses/categories/recurring_expenses (see migration 6).
--
-- Lifecycle:
--   pending   — captured from Apple Pay, awaiting user review
--   accepted  — user confirmed it as an expense; linked_expense_id is set
--   dismissed — user rejected it; no expense was created
--
-- amount is nullable because a Shortcut may capture the merchant/card
-- before the receipt clears; card_name is nullable for the same reason.

CREATE TABLE wallet_suggestions (
    id TEXT PRIMARY KEY,
    amount INTEGER,
    currency TEXT NOT NULL DEFAULT '',
    merchant TEXT NOT NULL DEFAULT '',
    card_name TEXT,
    captured_at INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'dismissed')),
    linked_expense_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    client_updated_at INTEGER NOT NULL,
    server_version INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (linked_expense_id) REFERENCES expenses(id)
);

CREATE INDEX idx_wallet_suggestions_status ON wallet_suggestions(status);
CREATE INDEX idx_wallet_suggestions_server_version ON wallet_suggestions(server_version);
CREATE INDEX idx_wallet_suggestions_captured_at ON wallet_suggestions(captured_at);

-- +goose StatementBegin
CREATE TRIGGER wallet_suggestions_server_version_insert
AFTER INSERT ON wallet_suggestions
WHEN NEW.server_version = 0
BEGIN
    UPDATE sync_state SET current_version = current_version + 1 WHERE id = 1;
    UPDATE wallet_suggestions SET server_version = (SELECT current_version FROM sync_state WHERE id = 1) WHERE id = NEW.id;
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER wallet_suggestions_server_version_update
AFTER UPDATE ON wallet_suggestions
WHEN NEW.server_version = OLD.server_version
BEGIN
    UPDATE sync_state SET current_version = current_version + 1 WHERE id = 1;
    UPDATE wallet_suggestions SET server_version = (SELECT current_version FROM sync_state WHERE id = 1) WHERE id = NEW.id;
END;
-- +goose StatementEnd

-- +goose Down
DROP TRIGGER IF EXISTS wallet_suggestions_server_version_update;
DROP TRIGGER IF EXISTS wallet_suggestions_server_version_insert;
DROP INDEX IF EXISTS idx_wallet_suggestions_captured_at;
DROP INDEX IF EXISTS idx_wallet_suggestions_server_version;
DROP INDEX IF EXISTS idx_wallet_suggestions_status;
DROP TABLE wallet_suggestions;
