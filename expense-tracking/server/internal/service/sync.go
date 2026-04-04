package service

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	dbsqlc "expense-tracker/internal/repository/sqlc"

	"github.com/google/uuid"
)

type SyncService struct {
	queries *dbsqlc.Queries
	db      *sql.DB
}

func NewSyncService(q *dbsqlc.Queries, db *sql.DB) *SyncService {
	return &SyncService{queries: q, db: db}
}

type PushRequest struct {
	Expenses   []PushExpense  `json:"expenses"`
	Categories []PushCategory `json:"categories"`
}

type PushExpense struct {
	ClientID    string `json:"client_id"`
	Amount      int64  `json:"amount"`
	Currency    string `json:"currency"`
	CategoryID  string `json:"category_id"`
	Description string `json:"description"`
	Merchant    string `json:"merchant"`
	Date        int64  `json:"date"`
	Source      string `json:"source"`
	UpdatedAt   int64  `json:"updated_at"`
	DeletedAt   *int64 `json:"deleted_at,omitempty"`
}

type PushCategory struct {
	ClientID  string `json:"client_id"`
	Name      string `json:"name"`
	Icon      string `json:"icon"`
	Budget    *int64 `json:"budget,omitempty"`
	UpdatedAt int64  `json:"updated_at"`
	DeletedAt *int64 `json:"deleted_at,omitempty"`
}

type PullResponse struct {
	Expenses   []Expense  `json:"expenses"`
	Categories []Category `json:"categories"`
	ServerTime int64      `json:"server_time"`
}

type PushResponse struct {
	Expenses   []Expense  `json:"expenses"`
	Categories []Category `json:"categories"`
	ServerTime int64      `json:"server_time"`
}

func (s *SyncService) Pull(ctx context.Context, since int64) (*PullResponse, error) {
	expenses, err := s.queries.ListExpensesUpdatedSince(ctx, since)
	if err != nil {
		return nil, err
	}
	categories, err := s.queries.ListCategoriesUpdatedSince(ctx, since)
	if err != nil {
		return nil, err
	}

	resp := &PullResponse{
		Expenses:   make([]Expense, len(expenses)),
		Categories: make([]Category, len(categories)),
		ServerTime: time.Now().Unix(),
	}

	for i, e := range expenses {
		resp.Expenses[i] = Expense{
			ID:          e.ID,
			ClientID:    e.ClientID,
			Amount:      e.Amount,
			Currency:    e.Currency,
			CategoryID:  e.CategoryID,
			Description: e.Description,
			Merchant:    e.Merchant,
			Date:        e.Date,
			Source:      e.Source,
			CreatedAt:   e.CreatedAt,
			UpdatedAt:   e.UpdatedAt,
			DeletedAt:   toInt64Ptr(e.DeletedAt),
		}
	}

	for i, c := range categories {
		resp.Categories[i] = Category{
			ID:        c.ID,
			ClientID:  c.ClientID,
			Name:      c.Name,
			Icon:      c.Icon,
			Budget:    toInt64Ptr(c.Budget),
			CreatedAt: c.CreatedAt,
			UpdatedAt: c.UpdatedAt,
			DeletedAt: toInt64Ptr(c.DeletedAt),
		}
	}

	return resp, nil
}

func (s *SyncService) Push(ctx context.Context, req PushRequest) (*PushResponse, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	qtx := s.queries.WithTx(tx)
	now := time.Now().Unix()

	resp := &PushResponse{
		Expenses:   make([]Expense, 0, len(req.Expenses)),
		Categories: make([]Category, 0, len(req.Categories)),
		ServerTime: now,
	}

	// Process categories first (expenses may reference them)
	for _, c := range req.Categories {
		cat, err := s.pushCategory(ctx, qtx, c, now)
		if err != nil {
			return nil, fmt.Errorf("pushing category: %w", err)
		}
		resp.Categories = append(resp.Categories, *cat)
	}

	// Process expenses
	for _, e := range req.Expenses {
		exp, err := s.pushExpense(ctx, qtx, e, now)
		if err != nil {
			return nil, fmt.Errorf("pushing expense: %w", err)
		}
		resp.Expenses = append(resp.Expenses, *exp)
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return resp, nil
}

func (s *SyncService) pushCategory(ctx context.Context, q *dbsqlc.Queries, input PushCategory, now int64) (*Category, error) {
	existing, err := q.GetCategoryByClientID(ctx, input.ClientID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}

	if err == sql.ErrNoRows {
		row, err := q.CreateCategory(ctx, dbsqlc.CreateCategoryParams{
			ID:        uuid.New().String(),
			ClientID:  input.ClientID,
			Name:      input.Name,
			Icon:      input.Icon,
			Budget:    nullInt64(input.Budget),
			CreatedAt: now,
			UpdatedAt: now,
		})
		if err != nil {
			return nil, err
		}
		cat := categoryFromRow(row)
		return &cat, nil
	}

	// Exists — update if newer
	if input.UpdatedAt > existing.UpdatedAt {
		err = q.UpdateCategory(ctx, dbsqlc.UpdateCategoryParams{
			Name:      input.Name,
			Icon:      input.Icon,
			Budget:    nullInt64(input.Budget),
			UpdatedAt: now,
			ID:        existing.ID,
		})
		if err != nil {
			return nil, err
		}
	}

	updated, err := q.GetCategoryByClientID(ctx, existing.ClientID)
	if err != nil {
		return nil, err
	}
	cat := categoryFromRow(updated)
	return &cat, nil
}

func (s *SyncService) pushExpense(ctx context.Context, q *dbsqlc.Queries, input PushExpense, now int64) (*Expense, error) {
	existing, err := q.GetExpenseByClientID(ctx, input.ClientID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}

	source := input.Source
	if source == "" {
		source = "manual"
	}

	if err == sql.ErrNoRows {
		row, err := q.CreateExpense(ctx, dbsqlc.CreateExpenseParams{
			ID:          uuid.New().String(),
			ClientID:    input.ClientID,
			Amount:      input.Amount,
			Currency:    input.Currency,
			CategoryID:  input.CategoryID,
			Description: input.Description,
			Merchant:    input.Merchant,
			Date:        input.Date,
			Source:      source,
			CreatedAt:   now,
			UpdatedAt:   now,
		})
		if err != nil {
			return nil, err
		}
		exp := expenseFromRow(row, "")
		return &exp, nil
	}

	// Exists — update if newer
	if input.UpdatedAt > existing.UpdatedAt {
		err = q.UpdateExpense(ctx, dbsqlc.UpdateExpenseParams{
			Amount:      input.Amount,
			Currency:    input.Currency,
			CategoryID:  input.CategoryID,
			Description: input.Description,
			Merchant:    input.Merchant,
			Date:        input.Date,
			UpdatedAt:   now,
			ID:          existing.ID,
		})
		if err != nil {
			return nil, err
		}
	}

	updated, err := q.GetExpenseByClientID(ctx, existing.ClientID)
	if err != nil {
		return nil, err
	}
	exp := expenseFromRow(updated, "")
	return &exp, nil
}
