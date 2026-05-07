package service

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	dbsqlc "expense-tracker/internal/repository/sqlc"
	"expense-tracker/internal/timeutil"
)

type SyncService struct {
	queries  *dbsqlc.Queries
	tx       TxManager
	location *time.Location
}

func NewSyncService(q *dbsqlc.Queries, tx TxManager, timezone string) *SyncService {
	return &SyncService{queries: q, tx: tx, location: timeutil.LoadLocation(timezone, time.UTC)}
}

func (s *SyncService) UpdateTimezone(timezone string) {
	s.location = timeutil.LoadLocation(timezone, time.UTC)
}

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

func (p PushCategory) GetUpdatedAt() int64  { return p.UpdatedAt }
func (p PushCategory) GetDeletedAt() *int64 { return p.DeletedAt }

func (p PushExpense) GetUpdatedAt() int64  { return p.UpdatedAt }
func (p PushExpense) GetDeletedAt() *int64 { return p.DeletedAt }

func (p PushRecurringExpense) GetUpdatedAt() int64  { return p.UpdatedAt }
func (p PushRecurringExpense) GetDeletedAt() *int64 { return p.DeletedAt }

type PullResponse struct {
	Expenses          []Expense          `json:"expenses"`
	Categories        []Category         `json:"categories"`
	RecurringExpenses []RecurringExpense `json:"recurring_expenses"`
	ServerVersion     int64              `json:"server_version"`
	ServerTime        int64              `json:"server_time,omitempty"`
}

type PushResponse struct {
	Expenses          []Expense          `json:"expenses"`
	Categories        []Category         `json:"categories"`
	RecurringExpenses []RecurringExpense `json:"recurring_expenses"`
	ServerVersion     int64              `json:"server_version"`
	ServerTime        int64              `json:"server_time,omitempty"`
}

func (s *SyncService) Pull(ctx context.Context, since int64) (*PullResponse, error) {
	var resp *PullResponse
	err := s.tx.WithReadTx(ctx, func(qtx *dbsqlc.Queries) error {
		serverVersion, err := qtx.GetCurrentServerVersion(ctx)
		if err != nil {
			return err
		}

		var pullErr error
		resp, pullErr = pullResponse(ctx, qtx, since, serverVersion, time.Now().Unix())
		return pullErr
	})
	if err != nil {
		return nil, err
	}

	return resp, nil
}

func pullResponse(ctx context.Context, q *dbsqlc.Queries, since, serverVersion, serverTime int64) (*PullResponse, error) {
	expenses, err := q.ListExpensesUpdatedSince(ctx, since)
	if err != nil {
		return nil, err
	}
	categories, err := q.ListCategoriesUpdatedSince(ctx, since)
	if err != nil {
		return nil, err
	}
	recurringExpenses, err := listRecurringExpensesUpdatedSince(ctx, q, since)
	if err != nil {
		return nil, err
	}

	resp := &PullResponse{
		Expenses:          make([]Expense, 0, len(expenses)),
		Categories:        make([]Category, 0, len(categories)),
		RecurringExpenses: recurringExpenses,
		ServerVersion:     serverVersion,
		ServerTime:        serverTime,
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
		category, err := q.GetCategoryIncludingDeleted(ctx, r.CategoryID)
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
		category, err := q.GetCategoryIncludingDeleted(ctx, e.CategoryID)
		if err != nil {
			return nil, fmt.Errorf("loading category %q for expense %q: %w", e.CategoryID, e.ID, err)
		}
		resp.Categories = append(resp.Categories, categoryFromRow(category))
		includedCategoryIDs[e.CategoryID] = struct{}{}
	}

	return resp, nil
}

func (s *SyncService) Push(ctx context.Context, req PushRequest) (*PushResponse, error) {
	now := time.Now().Unix()
	resp := &PushResponse{
		Expenses:          make([]Expense, 0, len(req.Expenses)),
		Categories:        make([]Category, 0, len(req.Categories)),
		RecurringExpenses: make([]RecurringExpense, 0, len(req.RecurringExpenses)),
		ServerTime:        now,
	}

	err := s.tx.WithTx(ctx, func(qtx *dbsqlc.Queries) error {
		categoryAliases := make(map[string]string, len(req.Categories)*2)

		for _, c := range req.Categories {
			if c.ID == "" {
				return fmt.Errorf("category id is required")
			}
			cat, err := s.pushCategory(ctx, qtx, c, now)
			if err != nil {
				return fmt.Errorf("pushing category: %w", err)
			}
			resp.Categories = append(resp.Categories, *cat)
			if c.ID != "" {
				categoryAliases[c.ID] = cat.ID
			}
		}

		for _, r := range req.RecurringExpenses {
			if r.ID == "" {
				return fmt.Errorf("recurring expense id is required")
			}
			resolvedCategoryID, err := s.resolveCategoryID(ctx, qtx, r.CategoryID, categoryAliases)
			if err != nil {
				return fmt.Errorf("resolving recurring category %q: %w", r.CategoryID, err)
			}
			r.CategoryID = resolvedCategoryID

			recurringExpense, err := s.pushRecurringExpense(ctx, qtx, r, now)
			if err != nil {
				return fmt.Errorf("pushing recurring expense: %w", err)
			}
			resp.RecurringExpenses = append(resp.RecurringExpenses, *recurringExpense)
		}

		if err := materializeDueRecurringExpenses(ctx, qtx, time.Now(), s.location); err != nil {
			return err
		}

		for _, e := range req.Expenses {
			if e.ID == "" {
				return fmt.Errorf("expense id is required")
			}
			resolvedCategoryID, err := s.resolveCategoryID(ctx, qtx, e.CategoryID, categoryAliases)
			if err != nil {
				return fmt.Errorf("resolving category %q: %w", e.CategoryID, err)
			}
			e.CategoryID = resolvedCategoryID

			exp, err := s.pushExpense(ctx, qtx, e, now)
			if err != nil {
				return fmt.Errorf("pushing expense: %w", err)
			}
			resp.Expenses = append(resp.Expenses, *exp)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	serverVersion, err := s.queries.GetCurrentServerVersion(ctx)
	if err != nil {
		return nil, err
	}
	resp.ServerVersion = serverVersion

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

func nextServerVersion(ctx context.Context, q *dbsqlc.Queries) (int64, error) {
	// Allocate from a global monotonic cursor. Versions are allowed to have
	// gaps: a push can reserve a version before LWW determines the row is a
	// no-op, and SQLite triggers also reserve versions for non-sync writes.
	// Cursor correctness requires only monotonicity, not contiguity.
	return q.NextServerVersion(ctx)
}

func (s *SyncService) pushCategory(ctx context.Context, q *dbsqlc.Queries, input PushCategory, now int64) (*Category, error) {
	// Pre-step: by-name reconciliation. A fresh app install with new
	// local UUIDs may push a category that matches an existing server
	// row by *name*. Splice the IDs together rather than creating a
	// duplicate. Runs only when ID lookup misses.
	if reconciled, err := s.tryReconcileCategoryByName(ctx, q, input, now); err != nil {
		return nil, err
	} else if reconciled != nil {
		cat := categoryFromRow(*reconciled)
		return &cat, nil
	}

	serverVersion, err := nextServerVersion(ctx, q)
	if err != nil {
		return nil, err
	}
	row, err := ApplyLWW(ctx, q, categoryLWWHooks(serverVersion), input, now)
	if err != nil {
		return nil, err
	}
	cat := categoryFromRow(row)
	return &cat, nil
}

// categoryLWWHooks adapts categories onto LWWMerge.
func categoryLWWHooks(serverVersion int64) LWWHooks[dbsqlc.Category, PushCategory] {
	return LWWHooks[dbsqlc.Category, PushCategory]{
		Load: func(ctx context.Context, q *dbsqlc.Queries, in PushCategory) (dbsqlc.Category, bool, error) {
			row, err := q.GetCategoryIncludingDeleted(ctx, in.ID)
			if err == sql.ErrNoRows {
				return dbsqlc.Category{}, false, nil
			}
			if err != nil {
				return dbsqlc.Category{}, false, err
			}
			return row, true, nil
		},
		ExistingUpdatedAt: func(c dbsqlc.Category) int64 { return c.UpdatedAt },
		ExistingDeleted:   func(c dbsqlc.Category) bool { return c.DeletedAt.Valid },
		EqualState: func(c dbsqlc.Category, in PushCategory) bool {
			return c.Name == in.Name &&
				c.Icon == in.Icon &&
				nullInt64Equal(c.Budget, in.Budget) &&
				deletedStateEqual(c.DeletedAt, in.DeletedAt)
		},
		Create: func(ctx context.Context, q *dbsqlc.Queries, in PushCategory, now int64) (dbsqlc.Category, error) {
			return q.CreateCategory(ctx, dbsqlc.CreateCategoryParams{
				ID:        in.ID,
				Name:      in.Name,
				Icon:      in.Icon,
				Budget:    nullInt64(in.Budget),
				CreatedAt: now,
				UpdatedAt: now,
				DeletedAt: deletedAtNullInt64(in.DeletedAt != nil, now),
			})
		},
		Update: func(ctx context.Context, q *dbsqlc.Queries, existing dbsqlc.Category, in PushCategory, now int64) (dbsqlc.Category, error) {
			return q.UpdateCategoryReturning(ctx, dbsqlc.UpdateCategoryReturningParams{
				Name:          in.Name,
				Icon:          in.Icon,
				Budget:        nullInt64(in.Budget),
				UpdatedAt:     now,
				ServerVersion: serverVersion,
				ID:            existing.ID,
			})
		},
		SoftDelete: func(ctx context.Context, q *dbsqlc.Queries, existing dbsqlc.Category, now int64) (dbsqlc.Category, error) {
			return q.SoftDeleteCategoryReturning(ctx, dbsqlc.SoftDeleteCategoryReturningParams{
				DeletedAt:     sql.NullInt64{Int64: now, Valid: true},
				UpdatedAt:     now,
				ServerVersion: serverVersion,
				ID:            existing.ID,
			})
		},
	}
}

// tryReconcileCategoryByName handles the "fresh client UUID, same
// category name" splice. Returns nil if no by-name reconciliation
// applies and the caller should fall through to ApplyLWW.
func (s *SyncService) tryReconcileCategoryByName(ctx context.Context, q *dbsqlc.Queries, input PushCategory, now int64) (*dbsqlc.Category, error) {
	if _, err := q.GetCategoryIncludingDeleted(ctx, input.ID); err == nil {
		return nil, nil // ID exists — let LWW handle the update path.
	} else if err != sql.ErrNoRows {
		return nil, err
	}

	byName, err := q.GetCategoryByName(ctx, input.Name)
	if err == sql.ErrNoRows {
		return nil, nil // No by-name match — let LWW Create.
	}
	if err != nil {
		return nil, err
	}

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

	serverVersion, err := nextServerVersion(ctx, q)
	if err != nil {
		return nil, err
	}
	if err := q.ReconcileCategoryByName(ctx, dbsqlc.ReconcileCategoryByNameParams{
		ID:            targetID,
		Name:          input.Name,
		Icon:          input.Icon,
		Budget:        nullInt64(input.Budget),
		DeletedAt:     nullInt64(input.DeletedAt),
		UpdatedAt:     now,
		ServerVersion: serverVersion,
		ID_2:          byName.ID,
	}); err != nil {
		return nil, err
	}

	updated, err := q.GetCategoryIncludingDeleted(ctx, targetID)
	if err != nil {
		return nil, err
	}
	return &updated, nil
}

func (s *SyncService) pushExpense(ctx context.Context, q *dbsqlc.Queries, input PushExpense, now int64) (*Expense, error) {
	serverVersion, err := nextServerVersion(ctx, q)
	if err != nil {
		return nil, err
	}
	row, err := ApplyLWW(ctx, q, expenseLWWHooks(serverVersion), input, now)
	if err != nil {
		return nil, err
	}
	cat, _ := q.GetCategoryIncludingDeleted(ctx, row.CategoryID)
	exp := expenseFromRow(row, cat.Name)
	return &exp, nil
}

// expenseLWWHooks adapts expenses onto LWWMerge.
func expenseLWWHooks(serverVersion int64) LWWHooks[dbsqlc.Expense, PushExpense] {
	return LWWHooks[dbsqlc.Expense, PushExpense]{
		Load: func(ctx context.Context, q *dbsqlc.Queries, in PushExpense) (dbsqlc.Expense, bool, error) {
			row, err := q.GetExpenseIncludingDeleted(ctx, in.ID)
			if err == sql.ErrNoRows {
				return dbsqlc.Expense{}, false, nil
			}
			if err != nil {
				return dbsqlc.Expense{}, false, err
			}
			return row, true, nil
		},
		ExistingUpdatedAt: func(e dbsqlc.Expense) int64 { return e.UpdatedAt },
		ExistingDeleted:   func(e dbsqlc.Expense) bool { return e.DeletedAt.Valid },
		Normalize: func(in PushExpense) PushExpense {
			if in.Source == "" {
				in.Source = "manual"
			}
			return in
		},
		EqualState: func(e dbsqlc.Expense, in PushExpense) bool {
			return e.Amount == in.Amount &&
				e.Currency == in.Currency &&
				e.CategoryID == in.CategoryID &&
				e.Description == in.Description &&
				e.Merchant == in.Merchant &&
				e.Date == in.Date &&
				e.Source == in.Source &&
				deletedStateEqual(e.DeletedAt, in.DeletedAt)
		},
		Create: func(ctx context.Context, q *dbsqlc.Queries, in PushExpense, now int64) (dbsqlc.Expense, error) {
			return q.CreateExpense(ctx, dbsqlc.CreateExpenseParams{
				ID:          in.ID,
				Amount:      in.Amount,
				Currency:    in.Currency,
				CategoryID:  in.CategoryID,
				Description: in.Description,
				Merchant:    in.Merchant,
				Date:        in.Date,
				Source:      in.Source,
				CreatedAt:   now,
				UpdatedAt:   now,
				DeletedAt:   deletedAtNullInt64(in.DeletedAt != nil, now),
			})
		},
		Update: func(ctx context.Context, q *dbsqlc.Queries, existing dbsqlc.Expense, in PushExpense, now int64) (dbsqlc.Expense, error) {
			return q.UpdateExpenseReturning(ctx, dbsqlc.UpdateExpenseReturningParams{
				Amount:        in.Amount,
				Currency:      in.Currency,
				CategoryID:    in.CategoryID,
				Description:   in.Description,
				Merchant:      in.Merchant,
				Date:          in.Date,
				Source:        in.Source,
				UpdatedAt:     now,
				ServerVersion: serverVersion,
				ID:            existing.ID,
			})
		},
		SoftDelete: func(ctx context.Context, q *dbsqlc.Queries, existing dbsqlc.Expense, now int64) (dbsqlc.Expense, error) {
			return q.SoftDeleteExpenseReturning(ctx, dbsqlc.SoftDeleteExpenseReturningParams{
				DeletedAt:     sql.NullInt64{Int64: now, Valid: true},
				UpdatedAt:     now,
				ServerVersion: serverVersion,
				ID:            existing.ID,
			})
		},
	}
}

func listRecurringExpensesUpdatedSince(ctx context.Context, q *dbsqlc.Queries, since int64) ([]RecurringExpense, error) {
	rows, err := q.ListRecurringExpensesUpdatedSince(ctx, since)
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
	serverVersion, err := nextServerVersion(ctx, q)
	if err != nil {
		return nil, err
	}
	row, err := ApplyLWW(ctx, q, recurringExpenseLWWHooks(serverVersion), input, now)
	if err != nil {
		return nil, err
	}
	r := recurringExpenseFromRow(row)
	return &r, nil
}

// recurringExpenseLWWHooks adapts recurring expenses onto LWWMerge.
func recurringExpenseLWWHooks(serverVersion int64) LWWHooks[dbsqlc.RecurringExpense, PushRecurringExpense] {
	return LWWHooks[dbsqlc.RecurringExpense, PushRecurringExpense]{
		Load: func(ctx context.Context, q *dbsqlc.Queries, in PushRecurringExpense) (dbsqlc.RecurringExpense, bool, error) {
			row, err := q.GetRecurringExpense(ctx, in.ID)
			if err == sql.ErrNoRows {
				return dbsqlc.RecurringExpense{}, false, nil
			}
			if err != nil {
				return dbsqlc.RecurringExpense{}, false, err
			}
			return row, true, nil
		},
		ExistingUpdatedAt: func(r dbsqlc.RecurringExpense) int64 { return r.UpdatedAt },
		ExistingDeleted:   func(r dbsqlc.RecurringExpense) bool { return r.DeletedAt.Valid },
		EqualState: func(r dbsqlc.RecurringExpense, in PushRecurringExpense) bool {
			return r.Amount == in.Amount &&
				r.Currency == in.Currency &&
				r.CategoryID == in.CategoryID &&
				r.Description == in.Description &&
				r.Merchant == in.Merchant &&
				r.Frequency == in.Frequency &&
				nullInt64Equal(r.DayOfMonth, in.DayOfMonth) &&
				r.StartDate == in.StartDate &&
				nullInt64Equal(r.EndDate, in.EndDate) &&
				r.NextRunDate == in.NextRunDate &&
				nullInt64Equal(r.LastRunDate, in.LastRunDate) &&
				deletedStateEqual(r.DeletedAt, in.DeletedAt)
		},
		Create: func(ctx context.Context, q *dbsqlc.Queries, in PushRecurringExpense, now int64) (dbsqlc.RecurringExpense, error) {
			if err := q.CreateRecurringExpense(ctx, dbsqlc.CreateRecurringExpenseParams{
				ID:          in.ID,
				Amount:      in.Amount,
				Currency:    in.Currency,
				CategoryID:  in.CategoryID,
				Description: in.Description,
				Merchant:    in.Merchant,
				Frequency:   in.Frequency,
				DayOfMonth:  nullInt64(in.DayOfMonth),
				StartDate:   in.StartDate,
				EndDate:     nullInt64(in.EndDate),
				NextRunDate: in.NextRunDate,
				LastRunDate: nullInt64(in.LastRunDate),
				CreatedAt:   now,
				UpdatedAt:   now,
				DeletedAt:   deletedAtNullInt64(in.DeletedAt != nil, now),
			}); err != nil {
				return dbsqlc.RecurringExpense{}, err
			}
			// CreateRecurringExpense isn't a RETURNING query (the
			// hand-written column list predates the *Returning
			// convention); fetch the row we just wrote.
			return q.GetRecurringExpense(ctx, in.ID)
		},
		Update: func(ctx context.Context, q *dbsqlc.Queries, existing dbsqlc.RecurringExpense, in PushRecurringExpense, now int64) (dbsqlc.RecurringExpense, error) {
			return q.UpdateRecurringExpenseReturning(ctx, dbsqlc.UpdateRecurringExpenseReturningParams{
				Amount:        in.Amount,
				Currency:      in.Currency,
				CategoryID:    in.CategoryID,
				Description:   in.Description,
				Merchant:      in.Merchant,
				Frequency:     in.Frequency,
				DayOfMonth:    nullInt64(in.DayOfMonth),
				StartDate:     in.StartDate,
				EndDate:       nullInt64(in.EndDate),
				NextRunDate:   in.NextRunDate,
				LastRunDate:   nullInt64(in.LastRunDate),
				UpdatedAt:     now,
				ServerVersion: serverVersion,
				ID:            existing.ID,
			})
		},
		SoftDelete: func(ctx context.Context, q *dbsqlc.Queries, existing dbsqlc.RecurringExpense, now int64) (dbsqlc.RecurringExpense, error) {
			return q.SoftDeleteRecurringExpenseReturning(ctx, dbsqlc.SoftDeleteRecurringExpenseReturningParams{
				DeletedAt:     sql.NullInt64{Int64: now, Valid: true},
				UpdatedAt:     now,
				ServerVersion: serverVersion,
				ID:            existing.ID,
			})
		},
	}
}
