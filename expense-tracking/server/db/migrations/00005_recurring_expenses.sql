-- +goose Up
CREATE TABLE recurring_expenses (
    id TEXT PRIMARY KEY,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    category_id TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    merchant TEXT NOT NULL DEFAULT '',
    frequency TEXT NOT NULL,
    day_of_month INTEGER,
    start_date INTEGER NOT NULL,
    end_date INTEGER,
    next_run_date INTEGER NOT NULL,
    last_run_date INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE INDEX idx_recurring_expenses_updated_at ON recurring_expenses(updated_at);
CREATE INDEX idx_recurring_expenses_category_id ON recurring_expenses(category_id);
CREATE INDEX idx_recurring_expenses_due ON recurring_expenses(next_run_date) WHERE deleted_at IS NULL;

CREATE TABLE recurring_expense_runs (
    id TEXT PRIMARY KEY,
    recurring_expense_id TEXT NOT NULL,
    expense_id TEXT NOT NULL,
    occurrence_date INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (recurring_expense_id) REFERENCES recurring_expenses(id),
    FOREIGN KEY (expense_id) REFERENCES expenses(id)
);

CREATE UNIQUE INDEX idx_recurring_expense_runs_unique_occurrence
ON recurring_expense_runs(recurring_expense_id, occurrence_date);

-- +goose Down
DROP TABLE recurring_expense_runs;
DROP TABLE recurring_expenses;
