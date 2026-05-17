-- name: GetWalletSuggestion :one
SELECT id, amount, currency, merchant, card_name, captured_at, source, status,
       linked_expense_id, created_at, updated_at, client_updated_at, server_version
FROM wallet_suggestions
WHERE id = ?;

-- name: ListWalletSuggestionsByStatus :many
SELECT id, amount, currency, merchant, card_name, captured_at, source, status,
       linked_expense_id, created_at, updated_at, client_updated_at, server_version
FROM wallet_suggestions
WHERE status = ?
ORDER BY captured_at DESC, id DESC;

-- name: CreateWalletSuggestion :exec
-- INSERT OR IGNORE gives us idempotency on the client-supplied id: the Apple
-- Pay Shortcut posts the same UUID on retry, the server inserts once and
-- silently no-ops thereafter. Callers should follow with GetWalletSuggestion
-- to read back the canonical row (whether freshly inserted or pre-existing).
INSERT OR IGNORE INTO wallet_suggestions (
    id, amount, currency, merchant, card_name, captured_at, source, status,
    created_at, updated_at, client_updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?);

-- name: AcceptWalletSuggestion :execresult
UPDATE wallet_suggestions
SET status = 'accepted',
    linked_expense_id = sqlc.arg(linked_expense_id),
    updated_at = sqlc.arg(updated_at),
    client_updated_at = sqlc.arg(client_updated_at)
WHERE id = sqlc.arg(id) AND status = 'pending';

-- name: DismissWalletSuggestion :execresult
UPDATE wallet_suggestions
SET status = 'dismissed',
    updated_at = sqlc.arg(updated_at),
    client_updated_at = sqlc.arg(client_updated_at)
WHERE id = sqlc.arg(id) AND status = 'pending';

-- name: ListWalletSuggestionsSinceServerVersion :many
SELECT id, amount, currency, merchant, card_name, captured_at, source, status,
       linked_expense_id, created_at, updated_at, client_updated_at, server_version
FROM wallet_suggestions
WHERE server_version > ?;
