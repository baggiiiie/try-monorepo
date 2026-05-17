package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"expense-tracker/internal/repository"
	dbsqlc "expense-tracker/internal/repository/sqlc"
)

var (
	ErrWalletSuggestionNotFound   = errors.New("wallet suggestion not found")
	ErrWalletSuggestionNotPending = errors.New("wallet suggestion is not pending")
)

type WalletSuggestionService struct {
	queries  *dbsqlc.Queries
	store    *repository.Store
	expenses *ExpenseService
}

func NewWalletSuggestionService(q *dbsqlc.Queries, store *repository.Store, expenses *ExpenseService) *WalletSuggestionService {
	return &WalletSuggestionService{queries: q, store: store, expenses: expenses}
}

type WalletSuggestionInput struct {
	ID              string
	Amount          *int64
	Currency        string
	Merchant        string
	CardName        *string
	CapturedAt      int64
	Source          string
	ClientUpdatedAt int64
}

type WalletSuggestion struct {
	ID              string  `json:"id"`
	Amount          *int64  `json:"amount,omitempty"`
	Currency        string  `json:"currency"`
	Merchant        string  `json:"merchant"`
	CardName        *string `json:"card_name,omitempty"`
	CapturedAt      int64   `json:"captured_at"`
	Source          string  `json:"source"`
	Status          string  `json:"status"`
	LinkedExpenseID *string `json:"linked_expense_id,omitempty"`
	CreatedAt       int64   `json:"created_at"`
	UpdatedAt       int64   `json:"updated_at"`
	ClientUpdatedAt int64   `json:"client_updated_at"`
	ServerVersion   int64   `json:"server_version"`
}

func (s *WalletSuggestionService) Create(ctx context.Context, in WalletSuggestionInput) (*WalletSuggestion, error) {
	if in.ID == "" {
		return nil, fmt.Errorf("id is required")
	}
	if in.CapturedAt == 0 {
		return nil, fmt.Errorf("captured_at is required")
	}
	if in.Source == "" {
		in.Source = "shortcut"
	}
	now := time.Now().Unix()
	clientUpdatedAt := in.ClientUpdatedAt
	if clientUpdatedAt == 0 {
		clientUpdatedAt = now
	}
	err := s.queries.CreateWalletSuggestion(ctx, dbsqlc.CreateWalletSuggestionParams{ID: in.ID, Amount: nullInt64(in.Amount), Currency: in.Currency, Merchant: in.Merchant, CardName: nullString(in.CardName), CapturedAt: in.CapturedAt, Source: in.Source, CreatedAt: now, UpdatedAt: now, ClientUpdatedAt: clientUpdatedAt})
	if err != nil {
		return nil, err
	}
	row, err := s.queries.GetWalletSuggestion(ctx, in.ID)
	if err != nil {
		return nil, err
	}
	out := walletSuggestionFromRow(row)
	return &out, nil
}

func (s *WalletSuggestionService) List(ctx context.Context, status string) ([]WalletSuggestion, error) {
	if status == "" {
		status = "pending"
	}
	rows, err := s.queries.ListWalletSuggestionsByStatus(ctx, status)
	if err != nil {
		return nil, err
	}
	out := make([]WalletSuggestion, len(rows))
	for i, r := range rows {
		out[i] = walletSuggestionFromRow(r)
	}
	return out, nil
}

func (s *WalletSuggestionService) Dismiss(ctx context.Context, id string) (*WalletSuggestion, error) {
	now := time.Now().Unix()
	result, err := s.queries.DismissWalletSuggestion(ctx, dbsqlc.DismissWalletSuggestionParams{ID: id, UpdatedAt: now, ClientUpdatedAt: now})
	if err != nil {
		return nil, err
	}
	if err := ensureSuggestionChanged(ctx, s.queries, id, result); err != nil {
		return nil, err
	}
	row, err := s.queries.GetWalletSuggestion(ctx, id)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrWalletSuggestionNotFound
		}
		return nil, err
	}
	out := walletSuggestionFromRow(row)
	return &out, nil
}

func (s *WalletSuggestionService) Confirm(ctx context.Context, id string, expense ExpenseInput) (*WalletSuggestion, *Expense, error) {
	var suggestion *WalletSuggestion
	var created *Expense
	err := s.store.WithTx(ctx, func(q *dbsqlc.Queries) error {
		pending, err := q.GetWalletSuggestion(ctx, id)
		if err != nil {
			if err == sql.ErrNoRows {
				return ErrWalletSuggestionNotFound
			}
			return err
		}
		if pending.Status != "pending" {
			return ErrWalletSuggestionNotPending
		}

		exp, err := s.expenses.CreateWithQueries(ctx, q, expense)
		if err != nil {
			return err
		}
		now := time.Now().Unix()
		result, err := q.AcceptWalletSuggestion(ctx, dbsqlc.AcceptWalletSuggestionParams{ID: id, LinkedExpenseID: sql.NullString{String: exp.ID, Valid: true}, UpdatedAt: now, ClientUpdatedAt: now})
		if err != nil {
			return err
		}
		if err := ensureSuggestionChanged(ctx, q, id, result); err != nil {
			return err
		}
		row, err := q.GetWalletSuggestion(ctx, id)
		if err != nil {
			return err
		}
		ws := walletSuggestionFromRow(row)
		suggestion, created = &ws, exp
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	return suggestion, created, nil
}

func ensureSuggestionChanged(ctx context.Context, q *dbsqlc.Queries, id string, result sql.Result) error {
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 1 {
		return nil
	}
	if changed != 0 {
		return fmt.Errorf("wallet suggestion update affected %d rows", changed)
	}
	if _, err := q.GetWalletSuggestion(ctx, id); err != nil {
		if err == sql.ErrNoRows {
			return ErrWalletSuggestionNotFound
		}
		return err
	}
	return ErrWalletSuggestionNotPending
}

func walletSuggestionFromRow(r dbsqlc.WalletSuggestion) WalletSuggestion {
	return WalletSuggestion{ID: r.ID, Amount: toInt64Ptr(r.Amount), Currency: r.Currency, Merchant: r.Merchant, CardName: toStringPtr(r.CardName), CapturedAt: r.CapturedAt, Source: r.Source, Status: r.Status, LinkedExpenseID: toStringPtr(r.LinkedExpenseID), CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, ClientUpdatedAt: r.ClientUpdatedAt, ServerVersion: r.ServerVersion}
}
func nullString(v *string) sql.NullString {
	if v == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *v, Valid: true}
}
func toStringPtr(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	return &v.String
}
