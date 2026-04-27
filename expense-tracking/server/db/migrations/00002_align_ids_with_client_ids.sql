-- +goose Up
-- Path C: collapse to a single id per row by snapping every row's id back
-- to its (immutable, client-minted) client_id. Repoint FK columns first
-- so the FK relationships hold once the parent ids are updated. Goose
-- runs each migration in a single transaction by default; defer_foreign_keys
-- delays FK validation until COMMIT.
PRAGMA defer_foreign_keys = ON;

UPDATE expenses
SET category_id = COALESCE(
    (SELECT client_id FROM categories WHERE categories.id = expenses.category_id),
    expenses.category_id
);

UPDATE categories SET id = client_id WHERE id != client_id;
UPDATE expenses SET id = client_id WHERE id != client_id;

-- +goose Down
-- Down migration is best-effort: we cannot recover the old server-assigned
-- ids that were overwritten. We simply re-mirror id into client_id so the
-- columns are consistent if someone rolls back.
UPDATE categories SET client_id = id WHERE client_id != id;
UPDATE expenses SET client_id = id WHERE client_id != id;
