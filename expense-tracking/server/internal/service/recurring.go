package service

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	dbsqlc "expense-tracker/internal/repository/sqlc"

	"github.com/google/uuid"
)

type RecurringExpense struct {
	ID          string `json:"id"`
	Amount      int64  `json:"amount"`
	Currency    string `json:"currency"`
	CategoryID  string `json:"category_id"`
	Description string `json:"description"`
	Merchant    string `json:"merchant"`
	Frequency   string `json:"frequency"`
	DayOfMonth  *int64 `json:"day_of_month,omitempty"`
	StartDate   int64  `json:"start_date"`
	EndDate     *int64 `json:"end_date,omitempty"`
	NextRunDate int64  `json:"next_run_date"`
	LastRunDate *int64 `json:"last_run_date,omitempty"`
	CreatedAt   int64  `json:"created_at"`
	UpdatedAt   int64  `json:"updated_at"`
	DeletedAt   *int64 `json:"deleted_at,omitempty"`
}

type PushRecurringExpense struct {
	ID          string `json:"id"`
	Amount      int64  `json:"amount"`
	Currency    string `json:"currency"`
	CategoryID  string `json:"category_id"`
	Description string `json:"description"`
	Merchant    string `json:"merchant"`
	Frequency   string `json:"frequency"`
	DayOfMonth  *int64 `json:"day_of_month,omitempty"`
	StartDate   int64  `json:"start_date"`
	EndDate     *int64 `json:"end_date,omitempty"`
	NextRunDate int64  `json:"next_run_date"`
	LastRunDate *int64 `json:"last_run_date,omitempty"`
	UpdatedAt   int64  `json:"updated_at"`
	DeletedAt   *int64 `json:"deleted_at,omitempty"`
}

type RecurringService struct {
	queries  *dbsqlc.Queries
	location *time.Location
}

func NewRecurringService(db *sql.DB, timezone string) *RecurringService {
	return &RecurringService{queries: dbsqlc.New(db), location: loadLocation(timezone)}
}

func (s *RecurringService) UpdateTimezone(timezone string) { s.location = loadLocation(timezone) }

func (s *RecurringService) MaterializeDue(ctx context.Context, now time.Time) error {
	return materializeDueRecurringExpenses(ctx, s.queries, now, s.location)
}

func materializeDueRecurringExpenses(ctx context.Context, q *dbsqlc.Queries, now time.Time, location *time.Location) error {
	today := startOfDay(now, location).Unix()
	rows, err := q.ListDueRecurringExpenses(ctx, today)
	if err != nil {
		return err
	}

	for _, row := range rows {
		r := recurringExpenseFromRow(row)
		if err := materializeRecurringExpense(ctx, q, r, today, now.Unix(), location); err != nil {
			return fmt.Errorf("materializing recurring expense %q: %w", r.ID, err)
		}
	}
	return nil
}

func materializeRecurringExpense(ctx context.Context, q *dbsqlc.Queries, r RecurringExpense, today, now int64, location *time.Location) error {
	next := r.NextRunDate
	guard := 0
	var last *int64
	for next <= today && guard < 120 {
		if r.EndDate != nil && next > *r.EndDate {
			break
		}
		expenseID, runID := recurringIDs(r.ID, next)
		if err := q.InsertRecurringExpenseRunExpense(ctx, dbsqlc.InsertRecurringExpenseRunExpenseParams{
			ID:          expenseID,
			Amount:      r.Amount,
			Currency:    r.Currency,
			CategoryID:  r.CategoryID,
			Description: r.Description,
			Merchant:    r.Merchant,
			Date:        next,
			CreatedAt:   now,
			UpdatedAt:   now,
		}); err != nil {
			return err
		}
		if err := q.InsertRecurringExpenseRun(ctx, dbsqlc.InsertRecurringExpenseRunParams{
			ID:                 runID,
			RecurringExpenseID: r.ID,
			ExpenseID:          expenseID,
			OccurrenceDate:     next,
			CreatedAt:          now,
		}); err != nil {
			return err
		}
		occurrence := next
		last = &occurrence
		next = nextRunDate(next, r.Frequency, r.DayOfMonth, location)
		guard++
	}
	if last == nil {
		return nil
	}
	return q.UpdateRecurringExpenseRunDates(ctx, dbsqlc.UpdateRecurringExpenseRunDatesParams{
		LastRunDate: nullInt64(last),
		NextRunDate: next,
		UpdatedAt:   now,
		ID:          r.ID,
	})
}

func nextRunDate(after int64, frequency string, dayOfMonth *int64, location *time.Location) int64 {
	t := time.Unix(after, 0).In(location)
	switch frequency {
	case "weekly":
		return t.AddDate(0, 0, 7).Unix()
	case "yearly":
		return clampDay(t.Year()+1, t.Month(), intDay(t.Day(), dayOfMonth), location).Unix()
	default:
		month := t.Month() + 1
		year := t.Year()
		if month > 12 {
			month = 1
			year++
		}
		return clampDay(year, month, intDay(t.Day(), dayOfMonth), location).Unix()
	}
}

func intDay(fallback int, day *int64) int {
	if day != nil {
		return int(*day)
	}
	return fallback
}

func recurringIDs(recurringExpenseID string, occurrenceDate int64) (expenseID string, runID string) {
	key := fmt.Sprintf("%s:%d", recurringExpenseID, occurrenceDate)
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("expense:"+key)).String(),
		uuid.NewSHA1(uuid.NameSpaceOID, []byte("run:"+key)).String()
}

func clampDay(year int, month time.Month, day int, location *time.Location) time.Time {
	if day < 1 {
		day = 1
	}
	last := time.Date(year, month+1, 0, 0, 0, 0, 0, location).Day()
	if day > last {
		day = last
	}
	return time.Date(year, month, day, 0, 0, 0, 0, location)
}

func startOfDay(t time.Time, location *time.Location) time.Time {
	u := t.In(location)
	return time.Date(u.Year(), u.Month(), u.Day(), 0, 0, 0, 0, location)
}

func loadLocation(timezone string) *time.Location {
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return time.UTC
	}
	return location
}

func recurringExpenseFromRow(r dbsqlc.RecurringExpense) RecurringExpense {
	return RecurringExpense{
		ID:          r.ID,
		Amount:      r.Amount,
		Currency:    r.Currency,
		CategoryID:  r.CategoryID,
		Description: r.Description,
		Merchant:    r.Merchant,
		Frequency:   r.Frequency,
		DayOfMonth:  toInt64Ptr(r.DayOfMonth),
		StartDate:   r.StartDate,
		EndDate:     toInt64Ptr(r.EndDate),
		NextRunDate: r.NextRunDate,
		LastRunDate: toInt64Ptr(r.LastRunDate),
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
		DeletedAt:   toInt64Ptr(r.DeletedAt),
	}
}
