-- name: GetCurrentServerVersion :one
SELECT current_version FROM sync_state WHERE id = 1;

-- name: NextServerVersion :one
UPDATE sync_state
SET current_version = current_version + 1
WHERE id = 1
RETURNING current_version;
