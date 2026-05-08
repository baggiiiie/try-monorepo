-- +goose Up
-- ADR 004: Categories are identified by their UUID, period.
--   * Drop the active-name unique index. With deterministic UUIDs for default
--     categories and random UUIDs for user-created ones, two devices may
--     legitimately create distinct categories that happen to share a name.
--   * Rewrite the IDs of existing default-named categories to the deterministic
--     UUIDs both clients now seed with, so the splice-by-name path is no
--     longer needed at sync time. FK references in expenses and
--     recurring_expenses are repointed under deferred FK enforcement.
DROP INDEX IF EXISTS idx_categories_name_active;

PRAGMA defer_foreign_keys = ON;

-- (name, deterministic UUIDv5 from URL namespace + "expense-tracker:default-category:<name>")
CREATE TEMP TABLE default_category_ids (
    name TEXT PRIMARY KEY,
    id   TEXT NOT NULL
);

INSERT INTO default_category_ids (name, id) VALUES
    ('Bills',         '63734549-381d-5655-ace8-afe849c5dde5'),
    ('Entertainment', '2216ebc9-f734-5d97-a90b-463c4a3ecc69'),
    ('Food & Dining', 'fa9fc4ac-bdb6-577f-8429-6f582a7827b4'),
    ('Groceries',     '950515de-0d1a-5ccb-bc81-868badd1a6fc'),
    ('Health',        '375b4aa5-cb75-5f1b-b905-cde070cd073c'),
    ('Other',         '5768cc36-cb19-599b-8af8-6dbfefc98840'),
    ('Shopping',      '7276fe9b-6a9a-5297-8935-f28f145cded6'),
    ('Transport',     '6abd2b4f-6db1-5fbc-acc4-f66b8184919d');

-- For each (name, target_id): pick exactly one existing active category row
-- with that name (lowest id wins, deterministic) and remap it to target_id.
-- If the target_id row already exists, leave the legacy duplicate alone — it
-- remains a regular row by UUID. Only the active row matters; soft-deleted
-- rows are left untouched.
CREATE TEMP TABLE category_id_remap (
    old_id TEXT PRIMARY KEY,
    new_id TEXT NOT NULL
);

INSERT INTO category_id_remap (old_id, new_id)
SELECT c.id, d.id
FROM default_category_ids d
JOIN categories c ON c.name = d.name AND c.deleted_at IS NULL
WHERE c.id != d.id
  AND NOT EXISTS (SELECT 1 FROM categories x WHERE x.id = d.id)
  AND c.id = (
      SELECT min(c2.id)
      FROM categories c2
      WHERE c2.name = d.name AND c2.deleted_at IS NULL
  );

UPDATE expenses
SET category_id = (SELECT new_id FROM category_id_remap WHERE old_id = expenses.category_id)
WHERE category_id IN (SELECT old_id FROM category_id_remap);

UPDATE recurring_expenses
SET category_id = (SELECT new_id FROM category_id_remap WHERE old_id = recurring_expenses.category_id)
WHERE category_id IN (SELECT old_id FROM category_id_remap);

UPDATE categories
SET id = (SELECT new_id FROM category_id_remap WHERE old_id = categories.id)
WHERE id IN (SELECT old_id FROM category_id_remap);

DROP TABLE category_id_remap;
DROP TABLE default_category_ids;

-- +goose Down
-- Recreate the unique-name index. We do not undo the ID rewrites because
-- they are content-preserving and the previous random IDs were not recorded.
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_active
    ON categories(name) WHERE deleted_at IS NULL;
