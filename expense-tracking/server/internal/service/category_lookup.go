package service

import (
	"context"
	"database/sql"
	"fmt"

	dbsqlc "expense-tracker/internal/repository/sqlc"
)

func resolveActiveCategoryIDByName(ctx context.Context, q *dbsqlc.Queries, name string) (string, error) {
	categories, err := q.ListActiveCategoriesByName(ctx, name)
	if err != nil {
		return "", err
	}

	switch len(categories) {
	case 0:
		return "", sql.ErrNoRows
	case 1:
		return categories[0].ID, nil
	default:
		return "", fmt.Errorf("category %q is ambiguous; found %d active categories with that name, use category_id instead", name, len(categories))
	}
}

func validateActiveCategoryID(ctx context.Context, q *dbsqlc.Queries, id string) error {
	_, err := q.GetCategoryByID(ctx, id)
	if err == sql.ErrNoRows {
		return fmt.Errorf("category %q not found", id)
	}
	return err
}
