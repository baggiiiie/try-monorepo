package service

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"expense-tracker/internal/config"
	dbsqlc "expense-tracker/internal/repository/sqlc"

	"github.com/google/uuid"
)

type ExpenseService struct {
	queries *dbsqlc.Queries
	prefs   *config.Preferences
}

func NewExpenseService(q *dbsqlc.Queries, prefs *config.Preferences) *ExpenseService {
	return &ExpenseService{queries: q, prefs: prefs}
}

func (s *ExpenseService) UpdatePreferences(p *config.Preferences) {
	s.prefs = p
}

type ExpenseInput struct {
	ID              string
	Amount          int64
	Currency        string
	CategoryID      string
	Category        string // category name, resolved to ID
	Description     string
	Merchant        string
	Date            int64
	Source          string
	ClientUpdatedAt int64
}

type Expense struct {
	ID              string `json:"id"`
	Amount          int64  `json:"amount"`
	Currency        string `json:"currency"`
	CategoryID      string `json:"category_id"`
	Category        string `json:"category"`
	Description     string `json:"description"`
	Merchant        string `json:"merchant"`
	Date            int64  `json:"date"`
	Source          string `json:"source"`
	CreatedAt       int64  `json:"created_at"`
	UpdatedAt       int64  `json:"updated_at"`
	ClientUpdatedAt int64  `json:"client_updated_at"`
	DeletedAt       *int64 `json:"deleted_at,omitempty"`
}

func (s *ExpenseService) Create(ctx context.Context, input ExpenseInput) (*Expense, error) {
	return s.CreateWithQueries(ctx, s.queries, input)
}

// CreateWithQueries inserts a new expense using the provided queries handle, allowing
// callers to compose the create with a surrounding transaction (e.g. dry-run
// rollback).
func (s *ExpenseService) CreateWithQueries(ctx context.Context, q *dbsqlc.Queries, input ExpenseInput) (*Expense, error) {
	if input.Amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}

	// Resolve category
	categoryID := input.CategoryID
	if categoryID == "" && input.Category != "" {
		resolvedCategoryID, err := resolveActiveCategoryIDByName(ctx, q, input.Category)
		if err != nil {
			if err == sql.ErrNoRows {
				return nil, fmt.Errorf("category %q not found. Run 'expense category list' to see available categories", input.Category)
			}
			return nil, err
		}
		categoryID = resolvedCategoryID
	}
	if categoryID == "" {
		return nil, fmt.Errorf("category is required")
	}
	if err := validateActiveCategoryID(ctx, q, categoryID); err != nil {
		return nil, err
	}

	currency := input.Currency
	if currency == "" {
		currency = s.prefs.Currency
	}

	date := input.Date
	if date == 0 {
		date = time.Now().Unix()
	}

	now := time.Now().Unix()
	id := input.ID
	if id == "" {
		id = uuid.New().String()
	}
	source := input.Source
	if source == "" {
		source = "cli"
	}
	clientUpdatedAt := input.ClientUpdatedAt
	if clientUpdatedAt == 0 {
		clientUpdatedAt = now
	}
	row, err := q.CreateExpense(ctx, dbsqlc.CreateExpenseParams{
		ID:              id,
		Amount:          input.Amount,
		Currency:        currency,
		CategoryID:      categoryID,
		Description:     input.Description,
		Merchant:        input.Merchant,
		Date:            date,
		Source:          source,
		CreatedAt:       now,
		UpdatedAt:       now,
		ClientUpdatedAt: clientUpdatedAt,
	})
	if err != nil {
		return nil, fmt.Errorf("creating expense: %w", err)
	}

	// Get category name for response
	cat, _ := q.GetCategoryIncludingDeleted(ctx, categoryID)
	exp := expenseFromRow(row, cat.Name)
	return &exp, nil
}

func (s *ExpenseService) List(ctx context.Context) ([]Expense, error) {
	rows, err := s.queries.ListExpenses(ctx)
	if err != nil {
		return nil, err
	}
	expenses := make([]Expense, len(rows))
	for i, r := range rows {
		expenses[i] = expenseFromListRow(r)
	}
	return expenses, nil
}

// ListWindowOptions defines a cursor-paginated window over the expense feed.
// All fields are unix seconds; Limit is the page size.
//
// The PWA expense feed wants to render "recent first" with the option to
// scroll back through history, but does not want to download every expense
// ever recorded on each cold start. Callers therefore typically pass
// (Before=now+1, Since=now-7d, Limit=N) for the first page and then
// (Before=cursor, Since=0, Limit=N) for subsequent pages — see the API
// handler for the default-window logic.
type ListWindowOptions struct {
	Before int64
	Since  int64
	Limit  int
}

// ListWindow returns expenses with Since <= date < Before, ordered newest
// first, capped at Limit rows. Used by the PWA's paginated GET /api/expenses
// endpoint; the CLI continues to use List() which returns the unbounded feed.
func (s *ExpenseService) ListWindow(ctx context.Context, opts ListWindowOptions) ([]Expense, error) {
	rows, err := s.queries.ListExpensesByDateWindow(ctx, dbsqlc.ListExpensesByDateWindowParams{
		Before:  opts.Before,
		Since:   opts.Since,
		MaxRows: int64(opts.Limit),
	})
	if err != nil {
		return nil, err
	}
	expenses := make([]Expense, len(rows))
	for i, r := range rows {
		expenses[i] = Expense{
			ID:              r.ID,
			Amount:          r.Amount,
			Currency:        r.Currency,
			CategoryID:      r.CategoryID,
			Category:        r.CategoryName.String,
			Description:     r.Description,
			Merchant:        r.Merchant,
			Date:            r.Date,
			Source:          r.Source,
			CreatedAt:       r.CreatedAt,
			UpdatedAt:       r.UpdatedAt,
			ClientUpdatedAt: r.ClientUpdatedAt,
			DeletedAt:       toInt64Ptr(r.DeletedAt),
		}
	}
	return expenses, nil
}

func (s *ExpenseService) Get(ctx context.Context, id string) (*Expense, error) {
	row, err := s.queries.GetExpenseByID(ctx, id)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("expense not found")
		}
		return nil, err
	}
	cat, _ := s.queries.GetCategoryIncludingDeleted(ctx, row.CategoryID)
	exp := expenseFromRow(row, cat.Name)
	return &exp, nil
}

func (s *ExpenseService) Update(ctx context.Context, id string, input ExpenseInput) (*Expense, error) {
	existing, err := s.queries.GetExpenseByID(ctx, id)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("expense not found")
		}
		return nil, err
	}

	amount := existing.Amount
	if input.Amount > 0 {
		amount = input.Amount
	}
	currency := existing.Currency
	if input.Currency != "" {
		currency = input.Currency
	}
	categoryID := existing.CategoryID
	categoryChanged := false
	if input.Category != "" {
		resolvedCategoryID, err := resolveActiveCategoryIDByName(ctx, s.queries, input.Category)
		if err != nil {
			if err == sql.ErrNoRows {
				return nil, fmt.Errorf("category %q not found", input.Category)
			}
			return nil, err
		}
		categoryID = resolvedCategoryID
		categoryChanged = true
	} else if input.CategoryID != "" {
		categoryID = input.CategoryID
		categoryChanged = true
	}
	if categoryChanged {
		if err := validateActiveCategoryID(ctx, s.queries, categoryID); err != nil {
			return nil, err
		}
	}
	description := existing.Description
	if input.Description != "" {
		description = input.Description
	}
	merchant := existing.Merchant
	if input.Merchant != "" {
		merchant = input.Merchant
	}
	date := existing.Date
	if input.Date > 0 {
		date = input.Date
	}

	now := time.Now().Unix()
	err = s.queries.UpdateExpense(ctx, dbsqlc.UpdateExpenseParams{
		Amount:          amount,
		Currency:        currency,
		CategoryID:      categoryID,
		Description:     description,
		Merchant:        merchant,
		Date:            date,
		UpdatedAt:       now,
		ClientUpdatedAt: now,
		ID:              id,
	})
	if err != nil {
		return nil, fmt.Errorf("updating expense: %w", err)
	}

	return s.Get(ctx, id)
}

func (s *ExpenseService) Delete(ctx context.Context, id string) error {
	now := time.Now().Unix()
	return s.queries.SoftDeleteExpense(ctx, dbsqlc.SoftDeleteExpenseParams{
		DeletedAt:       sql.NullInt64{Int64: now, Valid: true},
		UpdatedAt:       now,
		ClientUpdatedAt: now,
		ID:              id,
	})
}

func expenseFromRow(r dbsqlc.Expense, categoryName string) Expense {
	exp := Expense{
		ID:              r.ID,
		Amount:          r.Amount,
		Currency:        r.Currency,
		CategoryID:      r.CategoryID,
		Category:        categoryName,
		Description:     r.Description,
		Merchant:        r.Merchant,
		Date:            r.Date,
		Source:          r.Source,
		CreatedAt:       r.CreatedAt,
		UpdatedAt:       r.UpdatedAt,
		ClientUpdatedAt: r.ClientUpdatedAt,
		DeletedAt:       toInt64Ptr(r.DeletedAt),
	}
	return exp
}

func expenseFromListRow(r dbsqlc.ListExpensesRow) Expense {
	exp := Expense{
		ID:              r.ID,
		Amount:          r.Amount,
		Currency:        r.Currency,
		CategoryID:      r.CategoryID,
		Category:        r.CategoryName.String,
		Description:     r.Description,
		Merchant:        r.Merchant,
		Date:            r.Date,
		Source:          r.Source,
		CreatedAt:       r.CreatedAt,
		UpdatedAt:       r.UpdatedAt,
		ClientUpdatedAt: r.ClientUpdatedAt,
		DeletedAt:       toInt64Ptr(r.DeletedAt),
	}
	return exp
}
