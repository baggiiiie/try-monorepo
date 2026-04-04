package service

import (
	"context"
	"time"

	"expense-tracker/internal/config"
	dbsqlc "expense-tracker/internal/repository/sqlc"
)

type ReportService struct {
	queries *dbsqlc.Queries
	prefs   *config.Preferences
}

func NewReportService(q *dbsqlc.Queries, prefs *config.Preferences) *ReportService {
	return &ReportService{queries: q, prefs: prefs}
}

func (s *ReportService) UpdatePreferences(p *config.Preferences) {
	s.prefs = p
}

type CategorySummary struct {
	CategoryID string `json:"category_id"`
	Name       string `json:"name"`
	Total      int64  `json:"total"`
}

type SummaryResult struct {
	Categories []CategorySummary `json:"categories"`
	Total      int64             `json:"total"`
	Month      string            `json:"month"`
}

type BudgetCategory struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Budget     int64  `json:"budget"`
	Spent      int64  `json:"spent"`
	Remaining  int64  `json:"remaining"`
	OverBudget bool   `json:"over_budget"`
}

type BudgetResult struct {
	Categories []BudgetCategory `json:"categories"`
	Month      string           `json:"month"`
}

func (s *ReportService) Summary(ctx context.Context, month string) (*SummaryResult, error) {
	loc := loadTimezone(s.prefs.Timezone)
	start, end, monthStr := monthRange(month, loc)

	rows, err := s.queries.SumExpensesByCategory(ctx, dbsqlc.SumExpensesByCategoryParams{
		Date:   start.Unix(),
		Date_2: end.Unix(),
	})
	if err != nil {
		return nil, err
	}

	result := &SummaryResult{
		Categories: make([]CategorySummary, 0, len(rows)),
		Month:      monthStr,
	}

	for _, r := range rows {
		total := int64(r.Total.Float64)
		cs := CategorySummary{
			CategoryID: r.CategoryID,
			Name:       r.CategoryName.String,
			Total:      total,
		}
		result.Categories = append(result.Categories, cs)
		result.Total += total
	}

	return result, nil
}

func (s *ReportService) Budget(ctx context.Context, month string) (*BudgetResult, error) {
	loc := loadTimezone(s.prefs.Timezone)
	start, end, monthStr := monthRange(month, loc)

	categories, err := s.queries.ListCategories(ctx)
	if err != nil {
		return nil, err
	}

	spending, err := s.queries.SumExpensesByCategory(ctx, dbsqlc.SumExpensesByCategoryParams{
		Date:   start.Unix(),
		Date_2: end.Unix(),
	})
	if err != nil {
		return nil, err
	}

	spendingMap := make(map[string]int64)
	for _, s := range spending {
		spendingMap[s.CategoryID] = int64(s.Total.Float64)
	}

	result := &BudgetResult{
		Categories: make([]BudgetCategory, 0),
		Month:      monthStr,
	}

	for _, cat := range categories {
		if !cat.Budget.Valid {
			continue
		}
		budget := cat.Budget.Int64
		spent := spendingMap[cat.ID]
		remaining := budget - spent
		if remaining < 0 {
			remaining = 0
		}
		result.Categories = append(result.Categories, BudgetCategory{
			ID:         cat.ID,
			Name:       cat.Name,
			Budget:     budget,
			Spent:      spent,
			Remaining:  remaining,
			OverBudget: spent > budget,
		})
	}

	return result, nil
}

func loadTimezone(tz string) *time.Location {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return time.FixedZone("UTC+8", 8*60*60)
	}
	return loc
}

func monthRange(month string, loc *time.Location) (time.Time, time.Time, string) {
	now := time.Now().In(loc)
	var start time.Time

	if month == "" {
		start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
	} else {
		t, err := time.ParseInLocation("2006-01", month, loc)
		if err != nil {
			start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
		} else {
			start = t
		}
	}
	end := start.AddDate(0, 1, 0)
	return start, end, start.Format("2006-01")
}
