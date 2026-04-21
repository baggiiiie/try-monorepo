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
	ID        string `json:"id,omitempty"`
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
	if _, err := tx.ExecContext(ctx, "PRAGMA defer_foreign_keys = ON"); err != nil {
		return nil, err
	}
	now := time.Now().Unix()

	resp := &PushResponse{
		Expenses:   make([]Expense, 0, len(req.Expenses)),
		Categories: make([]Category, 0, len(req.Categories)),
		ServerTime: now,
	}
	categoryAliases := make(map[string]string, len(req.Categories)*3)

	for _, c := range req.Categories {
		cat, err := s.pushCategory(ctx, qtx, c, now)
		if err != nil {
			return nil, fmt.Errorf("pushing category: %w", err)
		}
		resp.Categories = append(resp.Categories, *cat)
		for _, alias := range []string{c.ID, c.ClientID, cat.ID} {
			if alias != "" {
				categoryAliases[alias] = cat.ID
			}
		}
	}

	for _, e := range req.Expenses {
		resolvedCategoryID, err := s.resolveCategoryID(ctx, qtx, e.CategoryID, categoryAliases)
		if err != nil {
			return nil, fmt.Errorf("resolving category %q: %w", e.CategoryID, err)
		}
		e.CategoryID = resolvedCategoryID

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

func (s *SyncService) resolveCategoryID(ctx context.Context, q *dbsqlc.Queries, categoryID string, aliases map[string]string) (string, error) {
	if mappedID, ok := aliases[categoryID]; ok {
		return mappedID, nil
	}

	cat, err := q.GetCategoryByClientID(ctx, categoryID)
	if err == nil {
		return cat.ID, nil
	}
	if err != sql.ErrNoRows {
		return "", err
	}

	return categoryID, nil
}

func (s *SyncService) pushCategory(ctx context.Context, q *dbsqlc.Queries, input PushCategory, now int64) (*Category, error) {
	existing, err := q.GetCategoryByClientID(ctx, input.ClientID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}

	if err == sql.ErrNoRows {
		// Reconcile categories by active name as well so a fresh app install with
		// new local UUIDs can attach to the same logical server-side category.
		if byName, nameErr := q.GetCategoryByName(ctx, input.Name); nameErr == nil {
			targetID := byName.ID
			if input.ID != "" {
				targetID = input.ID
			}

			if targetID != byName.ID {
				if err := q.ReassignExpensesCategory(ctx, dbsqlc.ReassignExpensesCategoryParams{
					CategoryID:  targetID,
					CategoryID_2: byName.ID,
				}); err != nil {
					return nil, err
				}
			}

			if err := q.ReconcileCategoryByName(ctx, dbsqlc.ReconcileCategoryByNameParams{
				ID:        targetID,
				ClientID:  input.ClientID,
				Name:      input.Name,
				Icon:      input.Icon,
				Budget:    nullInt64(input.Budget),
				DeletedAt: nullInt64(input.DeletedAt),
				UpdatedAt: now,
				ID_2:      byName.ID,
			}); err != nil {
				return nil, err
			}

			updated, err := q.GetCategoryByClientID(ctx, input.ClientID)
			if err != nil {
				return nil, err
			}
			cat := categoryFromRow(updated)
			return &cat, nil
		} else if nameErr != sql.ErrNoRows {
			return nil, nameErr
		}

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
		if input.DeletedAt != nil {
			if err := q.SoftDeleteCategory(ctx, dbsqlc.SoftDeleteCategoryParams{
				DeletedAt: sql.NullInt64{Int64: now, Valid: true},
				UpdatedAt: now,
				ID:        row.ID,
			}); err != nil {
				return nil, err
			}
			row, err = q.GetCategoryByClientID(ctx, input.ClientID)
			if err != nil {
				return nil, err
			}
		}
		cat := categoryFromRow(row)
		return &cat, nil
	}

	shouldApply := input.UpdatedAt > existing.UpdatedAt || (input.UpdatedAt == existing.UpdatedAt && !sameCategoryState(existing, input))
	if shouldApply {
		if input.DeletedAt != nil {
			if !existing.DeletedAt.Valid {
				if err := q.SoftDeleteCategory(ctx, dbsqlc.SoftDeleteCategoryParams{
					DeletedAt: sql.NullInt64{Int64: now, Valid: true},
					UpdatedAt: now,
					ID:        existing.ID,
				}); err != nil {
					return nil, err
				}
			}
		} else {
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
		if input.DeletedAt != nil {
			if err := q.SoftDeleteExpense(ctx, dbsqlc.SoftDeleteExpenseParams{
				DeletedAt: sql.NullInt64{Int64: now, Valid: true},
				UpdatedAt: now,
				ID:        row.ID,
			}); err != nil {
				return nil, err
			}
			row, err = q.GetExpenseByClientID(ctx, input.ClientID)
			if err != nil {
				return nil, err
			}
		}
		cat, _ := q.GetCategoryIncludingDeleted(ctx, row.CategoryID)
		exp := expenseFromRow(row, cat.Name)
		return &exp, nil
	}

	shouldApply := input.UpdatedAt > existing.UpdatedAt || (input.UpdatedAt == existing.UpdatedAt && !sameExpenseState(existing, input, source))
	if shouldApply {
		if input.DeletedAt != nil {
			if !existing.DeletedAt.Valid {
				if err := q.SoftDeleteExpense(ctx, dbsqlc.SoftDeleteExpenseParams{
					DeletedAt: sql.NullInt64{Int64: now, Valid: true},
					UpdatedAt: now,
					ID:        existing.ID,
				}); err != nil {
					return nil, err
				}
			}
		} else {
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
	}

	updated, err := q.GetExpenseByClientID(ctx, existing.ClientID)
	if err != nil {
		return nil, err
	}
	cat, _ := q.GetCategoryIncludingDeleted(ctx, updated.CategoryID)
	exp := expenseFromRow(updated, cat.Name)
	return &exp, nil
}

func sameCategoryState(existing dbsqlc.Category, input PushCategory) bool {
	return existing.Name == input.Name &&
		existing.Icon == input.Icon &&
		nullInt64Equal(existing.Budget, input.Budget) &&
		deletedStateEqual(existing.DeletedAt, input.DeletedAt)
}

func sameExpenseState(existing dbsqlc.Expense, input PushExpense, source string) bool {
	return existing.Amount == input.Amount &&
		existing.Currency == input.Currency &&
		existing.CategoryID == input.CategoryID &&
		existing.Description == input.Description &&
		existing.Merchant == input.Merchant &&
		existing.Date == input.Date &&
		existing.Source == source &&
		deletedStateEqual(existing.DeletedAt, input.DeletedAt)
}

func nullInt64Equal(existing sql.NullInt64, incoming *int64) bool {
	if incoming == nil {
		return !existing.Valid
	}
	return existing.Valid && existing.Int64 == *incoming
}

func deletedStateEqual(existing sql.NullInt64, incoming *int64) bool {
	if incoming == nil {
		return !existing.Valid
	}
	return existing.Valid
}
