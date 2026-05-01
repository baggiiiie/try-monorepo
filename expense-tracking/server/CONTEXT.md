# Server domain language

Lazy glossary — terms are added when they're first named in code or docs.

## LWWMerge

Last-write-wins reconciliation of a single client-pushed record against the
server row. Owns the create / update / soft-delete decision for one entity
in a `Push` request.

**Rule** — given an incoming record `I` and a (possibly absent) existing row
`E`:

1. If `E` does not exist → create from `I` (with `DeletedAt` carried in if
   present); return the new row.
2. Else apply iff `I.UpdatedAt > E.UpdatedAt`, *or* the timestamps are
   equal *and* `I` differs from `E` in normalized state (everything except
   `UpdatedAt`; the deleted-state comparison is the boolean
   "is-deleted-or-not", not the timestamp).
3. If applying and `I.DeletedAt` is set → soft-delete `E` (idempotent if
   already deleted).
4. Otherwise → update `E` with `I`'s fields.

**Adapters**: categories, expenses, recurring expenses
(`server/internal/service/sync.go`).

**Out of scope for LWWMerge**:

- Category-by-name reconciliation (resolves an alias *before* LWW runs).
- Response projection (e.g. joining `category_name` onto an expense for the
  HTTP response shape).
- Foreign-key dependency hydration on Pull.

LWWMerge runs inside a single `Push` transaction; ordering between
adapters is the caller's concern.
