<script lang="ts">
	import { onMount } from 'svelte';
	import { apiGet, apiWrite, ApiError } from '$lib/api';
	import type { Category, Expense, Preferences, WalletSuggestion } from '$lib/types';
	import { formatDateTime, formatMoney, newId, nowMillis } from '$lib/util';
	import ExpenseForm from '$lib/ExpenseForm.svelte';

	let suggestions = $state<WalletSuggestion[]>([]);
	let categories = $state<Category[]>([]);
	let prefs = $state<Preferences | null>(null);
	let loading = $state(true);
	let error = $state('');
	let active = $state<WalletSuggestion | null>(null);

	async function load() {
		loading = true;
		try {
			const [s, c, p] = await Promise.all([
				apiGet<{ wallet_suggestions: WalletSuggestion[] }>('/api/wallet-suggestions?status=pending'),
				apiGet<{ categories: Category[] }>('/api/categories'),
				apiGet<Preferences>('/api/preferences')
			]);
			suggestions = s.wallet_suggestions ?? [];
			categories = (c.categories ?? []).filter((x) => !x.deleted_at);
			prefs = p;
		} catch (e) {
			if (e instanceof ApiError && e.status !== 401) error = e.message;
		} finally {
			loading = false;
		}
	}

	async function confirm(value: {
		amount: number;
		currency: string;
		category_id: string;
		merchant: string;
		description: string;
		date: number;
	}) {
		if (!active) return;
		const body = { ...value, id: newId(), client_updated_at: nowMillis() };
		const result = await apiWrite<{ wallet_suggestion: WalletSuggestion; expense: Expense }>(
			'POST',
			`/api/wallet-suggestions/${active.id}/confirm`,
			body,
			`wallet_suggestion:${active.id}`
		);
		if (result.kind === 'error') {
			error = result.error.message;
			return;
		}
		active = null;
		await load();
	}

	async function dismiss(id: string) {
		const result = await apiWrite<WalletSuggestion>(
			'POST',
			`/api/wallet-suggestions/${id}/dismiss`,
			null,
			`wallet_suggestion:${id}`
		);
		if (result.kind === 'error') {
			error = result.error.message;
			return;
		}
		if (active?.id === id) active = null;
		await load();
	}

	onMount(load);
</script>

<h2>Wallet suggestions</h2>

{#if loading}
	<p>Loading…</p>
{:else if error}
	<p class="error">{error}</p>
{:else if active && prefs}
	<a href="/" onclick={(e) => { e.preventDefault(); active = null; }}>← Back to list</a>
	<p class="captured">Captured {formatDateTime(active.captured_at)} via {active.source}</p>
	<ExpenseForm
		initial={{
			amount: active.amount ?? 0,
			currency: active.currency,
			merchant: active.merchant,
			date: active.captured_at
		}}
		{categories}
		defaultCurrency={prefs.currency}
		submitLabel="Confirm & save"
		onSubmit={confirm}
		onCancel={() => (active = null)}
	/>
	<button type="button" class="dismiss" onclick={() => dismiss(active!.id)}>Dismiss instead</button>
{:else if suggestions.length === 0}
	<p>No pending suggestions.</p>
{:else}
	<ul>
		{#each suggestions as s (s.id)}
			<li>
				<button type="button" class="row" onclick={() => (active = s)}>
					<div>
						<div class="merchant">{s.merchant}</div>
						<div class="sub">
							{formatDateTime(s.captured_at)}
							{#if s.card_name}· {s.card_name}{/if}
						</div>
					</div>
					<div class="amount">{formatMoney(s.amount ?? null, s.currency)}</div>
				</button>
				<button type="button" class="del" onclick={() => dismiss(s.id)} aria-label="Dismiss">×</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	li {
		display: flex;
		gap: 6px;
	}
	.row {
		flex: 1;
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: white;
		color: inherit;
		border: 1px solid #e2e8f0;
		border-radius: 10px;
		padding: 12px 14px;
		text-align: left;
		cursor: pointer;
	}
	.merchant {
		font-weight: 700;
	}
	.sub {
		color: #64748b;
		font-size: 13px;
	}
	.amount {
		font-weight: 700;
	}
	.del {
		background: #fee2e2;
		color: #991b1b;
		font-size: 18px;
		padding: 0 14px;
		border-radius: 10px;
		border: 0;
		cursor: pointer;
	}
	.dismiss {
		margin-top: 12px;
		display: block;
		width: 100%;
		border: 1px solid #fecaca;
		background: white;
		color: #991b1b;
		padding: 10px;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
	}
	.captured {
		color: #64748b;
		font-size: 13px;
		margin: 8px 0 16px;
	}
	.error {
		color: #991b1b;
	}
</style>
