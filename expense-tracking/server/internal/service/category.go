package service

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	dbsqlc "expense-tracker/internal/repository/sqlc"

	"github.com/google/uuid"
)

type DefaultCategory struct {
	Name string
	Icon string
}

var defaultCategories = []DefaultCategory{
	{Name: "Food & Dining", Icon: "🍽️"},
	{Name: "Groceries", Icon: "🛒"},
	{Name: "Transport", Icon: "🚌"},
	{Name: "Shopping", Icon: "🛍️"},
	{Name: "Entertainment", Icon: "🎬"},
	{Name: "Bills", Icon: "📄"},
	{Name: "Health", Icon: "💊"},
	{Name: "Other", Icon: "📦"},
}

type CategoryService struct {
	queries *dbsqlc.Queries
}

func NewCategoryService(q *dbsqlc.Queries) *CategoryService {
	return &CategoryService{queries: q}
}

type CategoryInput struct {
	Name   string
	Icon   string
	Budget *int64
}

type Category struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Icon      string `json:"icon"`
	Budget    *int64 `json:"budget"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
	DeletedAt *int64 `json:"deleted_at,omitempty"`
}

func (s *CategoryService) EnsureDefaults(ctx context.Context) error {
	count, err := s.queries.CountActiveCategories(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	now := time.Now().Unix()
	for _, dc := range defaultCategories {
		id := uuid.New().String()
		_, err := s.queries.CreateCategory(ctx, dbsqlc.CreateCategoryParams{
			ID:        id,
			Name:      dc.Name,
			Icon:      dc.Icon,
			CreatedAt: now,
			UpdatedAt: now,
		})
		if err != nil {
			return fmt.Errorf("seeding category %s: %w", dc.Name, err)
		}
	}
	return nil
}

func (s *CategoryService) List(ctx context.Context) ([]Category, error) {
	rows, err := s.queries.ListCategories(ctx)
	if err != nil {
		return nil, err
	}
	cats := make([]Category, len(rows))
	for i, r := range rows {
		cats[i] = categoryFromRow(r)
	}
	return cats, nil
}

func (s *CategoryService) Create(ctx context.Context, input CategoryInput) (*Category, error) {
	if input.Name == "" {
		return nil, fmt.Errorf("category name is required")
	}

	now := time.Now().Unix()
	id := uuid.New().String()
	row, err := s.queries.CreateCategory(ctx, dbsqlc.CreateCategoryParams{
		ID:        id,
		Name:      input.Name,
		Icon:      input.Icon,
		Budget:    nullInt64(input.Budget),
		CreatedAt: now,
		UpdatedAt: now,
	})
	if err != nil {
		return nil, fmt.Errorf("creating category: %w", err)
	}
	cat := categoryFromRow(row)
	return &cat, nil
}

func (s *CategoryService) Update(ctx context.Context, id string, input CategoryInput) (*Category, error) {
	existing, err := s.queries.GetCategoryByID(ctx, id)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("category not found")
		}
		return nil, err
	}

	name := existing.Name
	if input.Name != "" {
		name = input.Name
	}
	icon := existing.Icon
	if input.Icon != "" {
		icon = input.Icon
	}
	budget := existing.Budget
	if input.Budget != nil {
		budget = nullInt64(input.Budget)
	}

	now := time.Now().Unix()
	err = s.queries.UpdateCategory(ctx, dbsqlc.UpdateCategoryParams{
		Name:      name,
		Icon:      icon,
		Budget:    budget,
		UpdatedAt: now,
		ID:        id,
	})
	if err != nil {
		return nil, fmt.Errorf("updating category: %w", err)
	}

	updated, err := s.queries.GetCategoryByID(ctx, id)
	if err != nil {
		return nil, err
	}
	cat := categoryFromRow(updated)
	return &cat, nil
}

func (s *CategoryService) Delete(ctx context.Context, id string) error {
	now := time.Now().Unix()
	return s.queries.SoftDeleteCategory(ctx, dbsqlc.SoftDeleteCategoryParams{
		DeletedAt: sql.NullInt64{Int64: now, Valid: true},
		UpdatedAt: now,
		ID:        id,
	})
}

func nullInt64(v *int64) sql.NullInt64 {
	if v == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *v, Valid: true}
}

func toInt64Ptr(v sql.NullInt64) *int64 {
	if !v.Valid {
		return nil
	}
	return &v.Int64
}

func categoryFromRow(r dbsqlc.Category) Category {
	cat := Category{
		ID:        r.ID,
		Name:      r.Name,
		Icon:      r.Icon,
		Budget:    toInt64Ptr(r.Budget),
		CreatedAt: r.CreatedAt,
		UpdatedAt: r.UpdatedAt,
		DeletedAt: toInt64Ptr(r.DeletedAt),
	}
	return cat
}
