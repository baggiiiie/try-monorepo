-- name: CreateExpense :one
INSERT INTO expenses (id, client_id, amount, currency, category_id, description, merchant, date, source, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: GetExpenseByID :one
SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL;

-- name: GetExpenseByClientID :one
SELECT * FROM expenses WHERE client_id = ?;

-- name: ListExpenses :many
SELECT e.*, c.name AS category_name
FROM expenses e
LEFT JOIN categories c ON e.category_id = c.id
WHERE e.deleted_at IS NULL
ORDER BY e.date DESC, e.created_at DESC;

-- name: UpdateExpense :exec
UPDATE expenses SET amount = ?, currency = ?, category_id = ?, description = ?, merchant = ?, date = ?, updated_at = ? WHERE id = ?;

-- name: SoftDeleteExpense :exec
UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;

-- name: ListExpensesUpdatedSince :many
SELECT * FROM expenses WHERE updated_at > ?;

-- name: ReassignExpensesCategory :exec
UPDATE expenses SET category_id = ? WHERE category_id = ?;

-- name: SumExpensesByCategory :many
SELECT e.category_id, c.name AS category_name, SUM(e.amount) AS total
FROM expenses e
LEFT JOIN categories c ON e.category_id = c.id
WHERE e.deleted_at IS NULL AND e.date >= ? AND e.date < ?
GROUP BY e.category_id;
