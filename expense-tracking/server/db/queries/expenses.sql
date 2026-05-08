-- name: CreateExpense :one
INSERT INTO expenses (id, amount, currency, category_id, description, merchant, date, source, created_at, updated_at, deleted_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: GetExpenseByID :one
SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL;

-- name: GetExpenseIncludingDeleted :one
SELECT * FROM expenses WHERE id = ?;

-- name: ListExpenses :many
SELECT e.*, c.name AS category_name
FROM expenses e
LEFT JOIN categories c ON e.category_id = c.id
WHERE e.deleted_at IS NULL
ORDER BY e.date DESC, e.created_at DESC;

-- name: UpdateExpense :exec
UPDATE expenses SET amount = ?, currency = ?, category_id = ?, description = ?, merchant = ?, date = ?, updated_at = ? WHERE id = ?;

-- name: UpdateExpenseReturning :one
UPDATE expenses SET amount = ?, currency = ?, category_id = ?, description = ?, merchant = ?, date = ?, source = ?, updated_at = ?, server_version = ?
WHERE id = ?
RETURNING *;

-- name: SoftDeleteExpense :exec
UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;

-- name: SoftDeleteExpenseReturning :one
UPDATE expenses SET deleted_at = ?, updated_at = ?, server_version = ? WHERE id = ?
RETURNING *;

-- name: ListExpensesSinceServerVersion :many
SELECT * FROM expenses WHERE server_version > ?;

-- name: SumExpensesByCategory :many
SELECT e.category_id, c.name AS category_name, SUM(e.amount) AS total
FROM expenses e
LEFT JOIN categories c ON e.category_id = c.id
WHERE e.deleted_at IS NULL AND e.date >= ? AND e.date < ?
GROUP BY e.category_id;
