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
	queries    *dbsqlc.Queries
	db         *sql.DB
	prefs      *config.Preferences
	configPath string
}

func NewExpenseService(q *dbsqlc.Queries, db *sql.DB, prefs *config.Preferences, configPath string) *ExpenseService {
	return &ExpenseService{queries: q, db: db, prefs: prefs, configPath: configPath}
}

func (s *ExpenseService) UpdatePreferences(p *config.Preferences) {
	s.prefs = p
}

type ExpenseInput struct {
	Amount      int64
	Currency    string
	CategoryID  string
	Category    string // category name, resolved to ID
	Description string
	Merchant    string
	Date        int64
}

type Expense struct {
	ID          string `json:"id"`
	ClientID    string `json:"client_id"`
	Amount      int64  `json:"amount"`
	Currency    string `json:"currency"`
	CategoryID  string `json:"category_id"`
	Category    string `json:"category"`
	Description string `json:"description"`
	Merchant    string `json:"merchant"`
	Date        int64  `json:"date"`
	Source      string `json:"source"`
	CreatedAt   int64  `json:"created_at"`
	UpdatedAt   int64  `json:"updated_at"`
	DeletedAt   *int64 `json:"deleted_at,omitempty"`
}

func (s *ExpenseService) Create(ctx context.Context, input ExpenseInput) (*Expense, error) {
	if input.Amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}

	// Resolve category
	categoryID := input.CategoryID
	if categoryID == "" && input.Category != "" {
		cat, err := s.queries.GetCategoryByName(ctx, input.Category)
		if err != nil {
			if err == sql.ErrNoRows {
				return nil, fmt.Errorf("category %q not found. Run 'expense category list' to see available categories", input.Category)
			}
			return nil, err
		}
		categoryID = cat.ID
	}
	if categoryID == "" {
		return nil, fmt.Errorf("category is required")
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
	row, err := s.queries.CreateExpense(ctx, dbsqlc.CreateExpenseParams{
		ID:          uuid.New().String(),
		ClientID:    uuid.New().String(),
		Amount:      input.Amount,
		Currency:    currency,
		CategoryID:  categoryID,
		Description: input.Description,
		Merchant:    input.Merchant,
		Date:        date,
		Source:      "cli",
		CreatedAt:   now,
		UpdatedAt:   now,
	})
	if err != nil {
		return nil, fmt.Errorf("creating expense: %w", err)
	}

	// Get category name for response
	cat, _ := s.queries.GetCategoryIncludingDeleted(ctx, categoryID)
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
	if input.Category != "" {
		cat, err := s.queries.GetCategoryByName(ctx, input.Category)
		if err != nil {
			if err == sql.ErrNoRows {
				return nil, fmt.Errorf("category %q not found", input.Category)
			}
			return nil, err
		}
		categoryID = cat.ID
	} else if input.CategoryID != "" {
		categoryID = input.CategoryID
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
		Amount:      amount,
		Currency:    currency,
		CategoryID:  categoryID,
		Description: description,
		Merchant:    merchant,
		Date:        date,
		UpdatedAt:   now,
		ID:          id,
	})
	if err != nil {
		return nil, fmt.Errorf("updating expense: %w", err)
	}

	return s.Get(ctx, id)
}

func (s *ExpenseService) Delete(ctx context.Context, id string) error {
	now := time.Now().Unix()
	return s.queries.SoftDeleteExpense(ctx, dbsqlc.SoftDeleteExpenseParams{
		DeletedAt: sql.NullInt64{Int64: now, Valid: true},
		UpdatedAt: now,
		ID:        id,
	})
}

func expenseFromRow(r dbsqlc.Expense, categoryName string) Expense {
	exp := Expense{
		ID:          r.ID,
		ClientID:    r.ClientID,
		Amount:      r.Amount,
		Currency:    r.Currency,
		CategoryID:  r.CategoryID,
		Category:    categoryName,
		Description: r.Description,
		Merchant:    r.Merchant,
		Date:        r.Date,
		Source:      r.Source,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
		DeletedAt:   toInt64Ptr(r.DeletedAt),
	}
	return exp
}

func expenseFromListRow(r dbsqlc.ListExpensesRow) Expense {
	exp := Expense{
		ID:          r.ID,
		ClientID:    r.ClientID,
		Amount:      r.Amount,
		Currency:    r.Currency,
		CategoryID:  r.CategoryID,
		Category:    r.CategoryName.String,
		Description: r.Description,
		Merchant:    r.Merchant,
		Date:        r.Date,
		Source:      r.Source,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
		DeletedAt:   toInt64Ptr(r.DeletedAt),
	}
	return exp
}
