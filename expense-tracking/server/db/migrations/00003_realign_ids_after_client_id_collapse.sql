-- +goose Up
-- Keep Path C invariant for rows created by older application builds after
-- 00002 ran: id is the client-minted identifier and client_id is retained only
-- for backwards-compatible sync payloads.
PRAGMA defer_foreign_keys = ON;

UPDATE expenses
SET category_id = COALESCE(
    (SELECT client_id FROM categories WHERE categories.id = expenses.category_id),
    expenses.category_id
);

UPDATE categories SET id = client_id WHERE id != client_id;
UPDATE expenses SET id = client_id WHERE id != client_id;

-- +goose Down
-- Best-effort/no-op: overwritten server-assigned ids cannot be recovered.
