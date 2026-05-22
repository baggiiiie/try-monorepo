// Wire types for the JSON the Go server emits. Names mirror the JSON tags in
// server/internal/service/*.go — keep them in sync when those structs change.

export type Expense = {
	id: string;
	amount: number; // cents
	currency: string;
	category_id: string;
	category: string;
	description: string;
	merchant: string;
	date: number; // unix seconds
	source: string;
	created_at: number;
	updated_at: number;
	client_updated_at: number;
	deleted_at?: number | null;
};

export type Category = {
	id: string;
	name: string;
	icon: string;
	budget: number | null;
	created_at: number;
	updated_at: number;
	client_updated_at: number;
	deleted_at?: number | null;
};

export type RecurringExpense = {
	id: string;
	amount: number;
	currency: string;
	category_id: string;
	description: string;
	merchant: string;
	frequency: string;
	day_of_month?: number | null;
	start_date: number;
	end_date?: number | null;
	next_run_date: number;
	last_run_date?: number | null;
	created_at: number;
	updated_at: number;
	client_updated_at: number;
	deleted_at?: number | null;
};

export type WalletSuggestion = {
	id: string;
	amount?: number | null;
	currency: string;
	merchant: string;
	card_name?: string | null;
	captured_at: number;
	source: string;
	status: 'pending' | 'accepted' | 'dismissed';
	linked_expense_id?: string | null;
	created_at: number;
	updated_at: number;
	client_updated_at: number;
	server_version: number;
};

export type Preferences = {
	currency: string;
	timezone: string;
	date_format: string;
};

export type ExpenseListResponse = {
	expenses: Expense[];
	count: number;
	next_before?: number;
};
