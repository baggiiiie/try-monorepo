-- name: ListDueRecurringExpenses :many
SELECT id, amount, currency, category_id, description, merchant, frequency, day_of_month, start_date, end_date, next_run_date, last_run_date, created_at, updated_at, deleted_at, server_version
FROM recurring_expenses
WHERE deleted_at IS NULL AND next_run_date <= ? AND (end_date IS NULL OR end_date >= next_run_date)
ORDER BY next_run_date
LIMIT 500;

-- name: InsertRecurringExpenseRunExpense :exec
INSERT OR IGNORE INTO expenses (id, amount, currency, category_id, description, merchant, date, source, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, 'recurring', ?, ?);

-- name: InsertRecurringExpenseRun :exec
INSERT OR IGNORE INTO recurring_expense_runs (id, recurring_expense_id, expense_id, occurrence_date, created_at)
VALUES (?, ?, ?, ?, ?);

-- name: UpdateRecurringExpenseRunDates :exec
UPDATE recurring_expenses
SET last_run_date = ?, next_run_date = ?, updated_at = ?, server_version = ?
WHERE id = ?;

-- name: ListRecurringExpensesUpdatedSince :many
SELECT id, amount, currency, category_id, description, merchant, frequency, day_of_month, start_date, end_date, next_run_date, last_run_date, created_at, updated_at, deleted_at, server_version
FROM recurring_expenses
WHERE server_version > ?;

-- name: GetRecurringExpense :one
SELECT id, amount, currency, category_id, description, merchant, frequency, day_of_month, start_date, end_date, next_run_date, last_run_date, created_at, updated_at, deleted_at, server_version
FROM recurring_expenses
WHERE id = ?;

-- name: CreateRecurringExpense :exec
INSERT INTO recurring_expenses (id, amount, currency, category_id, description, merchant, frequency, day_of_month, start_date, end_date, next_run_date, last_run_date, created_at, updated_at, deleted_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: UpdateRecurringExpense :exec
UPDATE recurring_expenses
SET amount = ?, currency = ?, category_id = ?, description = ?, merchant = ?, frequency = ?, day_of_month = ?, start_date = ?, end_date = ?, next_run_date = ?, last_run_date = ?, updated_at = ?, deleted_at = ?
WHERE id = ?;

-- name: UpdateRecurringExpenseReturning :one
UPDATE recurring_expenses
SET amount = ?, currency = ?, category_id = ?, description = ?, merchant = ?,
    frequency = ?, day_of_month = ?, start_date = ?, end_date = ?,
    next_run_date = ?, last_run_date = ?, updated_at = ?, server_version = ?
WHERE id = ?
RETURNING id, amount, currency, category_id, description, merchant, frequency,
          day_of_month, start_date, end_date, next_run_date, last_run_date,
          created_at, updated_at, deleted_at, server_version;

-- name: SoftDeleteRecurringExpenseReturning :one
UPDATE recurring_expenses
SET deleted_at = ?, updated_at = ?, server_version = ?
WHERE id = ?
RETURNING id, amount, currency, category_id, description, merchant, frequency,
          day_of_month, start_date, end_date, next_run_date, last_run_date,
          created_at, updated_at, deleted_at, server_version;
