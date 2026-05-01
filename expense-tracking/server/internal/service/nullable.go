package service

import "database/sql"

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

func int64PtrEqual(a, b *int64) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func nullInt64Equal(existing sql.NullInt64, incoming *int64) bool {
	if incoming == nil {
		return !existing.Valid
	}
	return existing.Valid && existing.Int64 == *incoming
}

// deletedStateEqual reports "is-deleted-or-not" parity between an
// existing row and an incoming push. Timestamps are not compared —
// LWW only cares whether the rows agree on deletion.
func deletedStateEqual(existing sql.NullInt64, incoming *int64) bool {
	return existing.Valid == (incoming != nil)
}

// deletedAtNullInt64 returns the sql.NullInt64 to write at
// insert/update time given whether the incoming row is deleted.
// When deleted, the server stamps `now` rather than echoing the
// client's timestamp (consistent with SoftDelete).
func deletedAtNullInt64(deleted bool, now int64) sql.NullInt64 {
	if !deleted {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: now, Valid: true}
}
