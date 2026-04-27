-- name: CreateCategory :one
INSERT INTO categories (id, name, icon, budget, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: GetCategoryByID :one
SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL;

-- name: GetCategoryIncludingDeleted :one
SELECT * FROM categories WHERE id = ?;

-- name: GetCategoryByName :one
SELECT * FROM categories WHERE name = ? AND deleted_at IS NULL;

-- name: ListCategories :many
SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY name;

-- name: UpdateCategory :exec
UPDATE categories SET name = ?, icon = ?, budget = ?, updated_at = ? WHERE id = ?;

-- name: SoftDeleteCategory :exec
UPDATE categories SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;

-- name: CountActiveCategories :one
SELECT COUNT(*) FROM categories WHERE deleted_at IS NULL;

-- name: ListCategoriesUpdatedSince :many
SELECT * FROM categories WHERE updated_at > ?;

-- name: ReconcileCategoryByName :exec
UPDATE categories
SET id = ?, name = ?, icon = ?, budget = ?, deleted_at = ?, updated_at = ?
WHERE id = ?;
