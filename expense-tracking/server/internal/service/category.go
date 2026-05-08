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
	// ID is a deterministic UUIDv5 derived from
	// uuid.NameSpaceURL + "expense-tracker:default-category:" + Name.
	// Both the server and the iOS client must seed default categories with
	// the same fixed UUID per name (see ADR 004) so they collide on UUID
	// rather than on name and resolve through normal LWW.
	ID   string
	Name string
	Icon string
}

var defaultCategories = []DefaultCategory{
	{ID: "fa9fc4ac-bdb6-577f-8429-6f582a7827b4", Name: "Food & Dining", Icon: "🍽️"},
	{ID: "950515de-0d1a-5ccb-bc81-868badd1a6fc", Name: "Groceries", Icon: "🛒"},
	{ID: "6abd2b4f-6db1-5fbc-acc4-f66b8184919d", Name: "Transport", Icon: "🚌"},
	{ID: "7276fe9b-6a9a-5297-8935-f28f145cded6", Name: "Shopping", Icon: "🛍️"},
	{ID: "2216ebc9-f734-5d97-a90b-463c4a3ecc69", Name: "Entertainment", Icon: "🎬"},
	{ID: "63734549-381d-5655-ace8-afe849c5dde5", Name: "Bills", Icon: "📄"},
	{ID: "375b4aa5-cb75-5f1b-b905-cde070cd073c", Name: "Health", Icon: "💊"},
	{ID: "5768cc36-cb19-599b-8af8-6dbfefc98840", Name: "Other", Icon: "📦"},
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
		_, err := s.queries.CreateCategory(ctx, dbsqlc.CreateCategoryParams{
			ID:        dc.ID,
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
