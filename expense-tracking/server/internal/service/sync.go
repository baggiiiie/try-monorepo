package service

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	dbsqlc "expense-tracker/internal/repository/sqlc"
)

type SyncService struct {
	queries  *dbsqlc.Queries
	db       *sql.DB
	location *time.Location
}

func NewSyncService(q *dbsqlc.Queries, db *sql.DB, timezone string) *SyncService {
	return &SyncService{queries: q, db: db, location: loadLocation(timezone)}
}

func (s *SyncService) UpdateTimezone(timezone string) { s.location = loadLocation(timezone) }

type PushRequest struct {
	Expenses          []PushExpense          `json:"expenses"`
	Categories        []PushCategory         `json:"categories"`
	RecurringExpenses []PushRecurringExpense `json:"recurring_expenses"`
}

type PushExpense struct {
	ID          string `json:"id"`
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
	ID        string `json:"id"`
	Name      string `json:"name"`
	Icon      string `json:"icon"`
	Budget    *int64 `json:"budget,omitempty"`
	UpdatedAt int64  `json:"updated_at"`
	DeletedAt *int64 `json:"deleted_at,omitempty"`
}

type PullResponse struct {
	Expenses          []Expense          `json:"expenses"`
	Categories        []Category         `json:"categories"`
	RecurringExpenses []RecurringExpense `json:"recurring_expenses"`
	ServerTime        int64              `json:"server_time"`
}

type PushResponse struct {
	Expenses          []Expense          `json:"expenses"`
	Categories        []Category         `json:"categories"`
	RecurringExpenses []RecurringExpense `json:"recurring_expenses"`
	ServerTime        int64              `json:"server_time"`
}

func (s *SyncService) Pull(ctx context.Context, since int64) (*PullResponse, error) {
	if err := materializeDueRecurringExpenses(ctx, s.queries, time.Now(), s.location); err != nil {
		return nil, err
	}

	expenses, err := s.queries.ListExpensesUpdatedSince(ctx, since)
	if err != nil {
		return nil, err
	}
	categories, err := s.queries.ListCategoriesUpdatedSince(ctx, since)
	if err != nil {
		return nil, err
	}

	recurringExpenses, err := s.listRecurringExpensesUpdatedSince(ctx, since)
	if err != nil {
		return nil, err
	}

	resp := &PullResponse{
		Expenses:          make([]Expense, 0, len(expenses)),
		Categories:        make([]Category, 0, len(categories)),
		RecurringExpenses: recurringExpenses,
		ServerTime:        time.Now().Unix(),
	}

	includedCategoryIDs := make(map[string]struct{}, len(categories)+len(expenses)+len(recurringExpenses))
	for _, c := range categories {
		resp.Categories = append(resp.Categories, categoryFromRow(c))
		includedCategoryIDs[c.ID] = struct{}{}
	}

	// A delta pull can include an expense whose category was created/updated
	// before the client's `since` cursor. Include those referenced categories
	// as dependency rows so SQLite foreign keys are satisfied on the client.
	for _, r := range recurringExpenses {
		if _, ok := includedCategoryIDs[r.CategoryID]; ok {
			continue
		}
		category, err := s.queries.GetCategoryIncludingDeleted(ctx, r.CategoryID)
		if err != nil {
			return nil, fmt.Errorf("loading category %q for recurring expense %q: %w", r.CategoryID, r.ID, err)
		}
		resp.Categories = append(resp.Categories, categoryFromRow(category))
		includedCategoryIDs[r.CategoryID] = struct{}{}
	}

	for _, e := range expenses {
		resp.Expenses = append(resp.Expenses, Expense{
			ID:          e.ID,
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
		})

		if _, ok := includedCategoryIDs[e.CategoryID]; ok {
			continue
		}
		category, err := s.queries.GetCategoryIncludingDeleted(ctx, e.CategoryID)
		if err != nil {
			return nil, fmt.Errorf("loading category %q for expense %q: %w", e.CategoryID, e.ID, err)
		}
		resp.Categories = append(resp.Categories, categoryFromRow(category))
		includedCategoryIDs[e.CategoryID] = struct{}{}
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
		Expenses:          make([]Expense, 0, len(req.Expenses)),
		Categories:        make([]Category, 0, len(req.Categories)),
		RecurringExpenses: make([]RecurringExpense, 0, len(req.RecurringExpenses)),
		ServerTime:        now,
	}
	categoryAliases := make(map[string]string, len(req.Categories)*2)

	for _, c := range req.Categories {
		if c.ID == "" {
			return nil, fmt.Errorf("category id is required")
		}
		cat, err := s.pushCategory(ctx, qtx, c, now)
		if err != nil {
			return nil, fmt.Errorf("pushing category: %w", err)
		}
		resp.Categories = append(resp.Categories, *cat)
		if c.ID != "" {
			categoryAliases[c.ID] = cat.ID
		}
	}

	for _, r := range req.RecurringExpenses {
		if r.ID == "" {
			return nil, fmt.Errorf("recurring expense id is required")
		}
		resolvedCategoryID, err := s.resolveCategoryID(ctx, qtx, r.CategoryID, categoryAliases)
		if err != nil {
			return nil, fmt.Errorf("resolving recurring category %q: %w", r.CategoryID, err)
		}
		r.CategoryID = resolvedCategoryID

		recurringExpense, err := s.pushRecurringExpense(ctx, qtx, r, now)
		if err != nil {
			return nil, fmt.Errorf("pushing recurring expense: %w", err)
		}
		resp.RecurringExpenses = append(resp.RecurringExpenses, *recurringExpense)
	}

	if err := materializeDueRecurringExpenses(ctx, qtx, time.Now(), s.location); err != nil {
		return nil, err
	}

	for _, e := range req.Expenses {
		if e.ID == "" {
			return nil, fmt.Errorf("expense id is required")
		}
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

	if _, err := q.GetCategoryIncludingDeleted(ctx, categoryID); err == nil {
		return categoryID, nil
	} else if err != sql.ErrNoRows {
		return "", err
	}

	return categoryID, nil
}

func (s *SyncService) pushCategory(ctx context.Context, q *dbsqlc.Queries, input PushCategory, now int64) (*Category, error) {
	existing, err := q.GetCategoryIncludingDeleted(ctx, input.ID)
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
					CategoryID:   targetID,
					CategoryID_2: byName.ID,
				}); err != nil {
					return nil, err
				}
			}

			if err := q.ReconcileCategoryByName(ctx, dbsqlc.ReconcileCategoryByNameParams{
				ID:        targetID,
				Name:      input.Name,
				Icon:      input.Icon,
				Budget:    nullInt64(input.Budget),
				DeletedAt: nullInt64(input.DeletedAt),
				UpdatedAt: now,
				ID_2:      byName.ID,
			}); err != nil {
				return nil, err
			}

			updated, err := q.GetCategoryIncludingDeleted(ctx, targetID)
			if err != nil {
				return nil, err
			}
			cat := categoryFromRow(updated)
			return &cat, nil
		} else if nameErr != sql.ErrNoRows {
			return nil, nameErr
		}

		row, err := q.CreateCategory(ctx, dbsqlc.CreateCategoryParams{
			ID:        input.ID,
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
			row, err = q.GetCategoryIncludingDeleted(ctx, input.ID)
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

	updated, err := q.GetCategoryIncludingDeleted(ctx, existing.ID)
	if err != nil {
		return nil, err
	}
	cat := categoryFromRow(updated)
	return &cat, nil
}

func (s *SyncService) pushExpense(ctx context.Context, q *dbsqlc.Queries, input PushExpense, now int64) (*Expense, error) {
	existing, err := q.GetExpenseIncludingDeleted(ctx, input.ID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}

	source := input.Source
	if source == "" {
		source = "manual"
	}

	if err == sql.ErrNoRows {
		row, err := q.CreateExpense(ctx, dbsqlc.CreateExpenseParams{
			ID:          input.ID,
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
			row, err = q.GetExpenseIncludingDeleted(ctx, input.ID)
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

	updated, err := q.GetExpenseIncludingDeleted(ctx, existing.ID)
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

func sameRecurringExpenseState(existing RecurringExpense, input PushRecurringExpense) bool {
	return existing.Amount == input.Amount &&
		existing.Currency == input.Currency &&
		existing.CategoryID == input.CategoryID &&
		existing.Description == input.Description &&
		existing.Merchant == input.Merchant &&
		existing.Frequency == input.Frequency &&
		int64PtrEqual(existing.DayOfMonth, input.DayOfMonth) &&
		existing.StartDate == input.StartDate &&
		int64PtrEqual(existing.EndDate, input.EndDate) &&
		existing.NextRunDate == input.NextRunDate &&
		int64PtrEqual(existing.LastRunDate, input.LastRunDate) &&
		int64PtrEqual(existing.DeletedAt, input.DeletedAt)
}

func int64PtrEqual(a, b *int64) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
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

func (s *SyncService) listRecurringExpensesUpdatedSince(ctx context.Context, since int64) ([]RecurringExpense, error) {
	rows, err := s.queries.ListRecurringExpensesUpdatedSince(ctx, since)
	if err != nil {
		return nil, err
	}

	recurringExpenses := make([]RecurringExpense, 0, len(rows))
	for _, row := range rows {
		recurringExpenses = append(recurringExpenses, recurringExpenseFromRow(row))
	}
	return recurringExpenses, nil
}

func (s *SyncService) pushRecurringExpense(ctx context.Context, q *dbsqlc.Queries, input PushRecurringExpense, now int64) (*RecurringExpense, error) {
	existing, err := s.getRecurringExpense(ctx, q, input.ID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}

	if err == sql.ErrNoRows {
		if err := q.CreateRecurringExpense(ctx, dbsqlc.CreateRecurringExpenseParams{
			ID:          input.ID,
			Amount:      input.Amount,
			Currency:    input.Currency,
			CategoryID:  input.CategoryID,
			Description: input.Description,
			Merchant:    input.Merchant,
			Frequency:   input.Frequency,
			DayOfMonth:  nullInt64(input.DayOfMonth),
			StartDate:   input.StartDate,
			EndDate:     nullInt64(input.EndDate),
			NextRunDate: input.NextRunDate,
			LastRunDate: nullInt64(input.LastRunDate),
			CreatedAt:   now,
			UpdatedAt:   now,
			DeletedAt:   nullInt64(input.DeletedAt),
		}); err != nil {
			return nil, err
		}
		return s.getRecurringExpense(ctx, q, input.ID)
	}

	shouldApply := input.UpdatedAt > existing.UpdatedAt || (input.UpdatedAt == existing.UpdatedAt && !sameRecurringExpenseState(*existing, input))
	if shouldApply {
		if err := q.UpdateRecurringExpense(ctx, dbsqlc.UpdateRecurringExpenseParams{
			Amount:      input.Amount,
			Currency:    input.Currency,
			CategoryID:  input.CategoryID,
			Description: input.Description,
			Merchant:    input.Merchant,
			Frequency:   input.Frequency,
			DayOfMonth:  nullInt64(input.DayOfMonth),
			StartDate:   input.StartDate,
			EndDate:     nullInt64(input.EndDate),
			NextRunDate: input.NextRunDate,
			LastRunDate: nullInt64(input.LastRunDate),
			UpdatedAt:   now,
			DeletedAt:   nullInt64(input.DeletedAt),
			ID:          input.ID,
		}); err != nil {
			return nil, err
		}
	}

	return s.getRecurringExpense(ctx, q, input.ID)
}

func (s *SyncService) getRecurringExpense(ctx context.Context, q *dbsqlc.Queries, id string) (*RecurringExpense, error) {
	row, err := q.GetRecurringExpense(ctx, id)
	if err != nil {
		return nil, err
	}
	r := recurringExpenseFromRow(row)
	return &r, nil
}
