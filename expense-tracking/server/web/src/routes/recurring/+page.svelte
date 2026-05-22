<script lang="ts">
	import { onMount } from 'svelte';
	import { apiGet, apiWrite, ApiError } from '$lib/api';
	import type { Category, Preferences, RecurringExpense } from '$lib/types';
	import {
		dateInputValue,
		formatDate,
		formatMoney,
		nowMillis,
		nowSeconds,
		parseAmount,
		unixFromDateInput
	} from '$lib/util';

	let rows = $state<RecurringExpense[]>([]);
	let categories = $state<Category[]>([]);
	let prefs = $state<Preferences | null>(null);
	let loading = $state(true);
	let error = $state('');

	let editingId = $state<string | null>(null);
	let amountText = $state('');
	let currency = $state('USD');
	let categoryId = $state('');
	let merchant = $state('');
	let description = $state('');
	let frequency = $state<'weekly' | 'monthly' | 'yearly'>('monthly');
	let dayOfMonthText = $state('');
	let startDate = $state(dateInputValue(nowSeconds()));
	let endDate = $state('');
	let busy = $state(false);

	const categoryName = $derived((id: string) => categories.find((c) => c.id === id)?.name ?? '—');

	async function load() {
		loading = true;
		try {
			const [r, c, p] = await Promise.all([
				apiGet<{ recurring_expenses: RecurringExpense[] }>('/api/recurring-expenses'),
				apiGet<{ categories: Category[] }>('/api/categories'),
				apiGet<Preferences>('/api/preferences')
			]);
			rows = (r.recurring_expenses ?? []).filter((x) => !x.deleted_at);
			categories = (c.categories ?? []).filter((x) => !x.deleted_at);
			prefs = p;
			if (!currency || currency === 'USD') currency = p.currency;
			if (!categoryId && categories[0]) categoryId = categories[0].id;
		} catch (e) {
			if (e instanceof ApiError && e.status !== 401) error = e.message;
		} finally {
			loading = false;
		}
	}

	function reset() {
		editingId = null;
		amountText = '';
		merchant = '';
		description = '';
		frequency = 'monthly';
		dayOfMonthText = '';
		startDate = dateInputValue(nowSeconds());
		endDate = '';
		error = '';
	}

	function startEdit(row: RecurringExpense) {
		editingId = row.id;
		amountText = (row.amount / 100).toFixed(2);
		currency = row.currency;
		categoryId = row.category_id;
		merchant = row.merchant;
		description = row.description;
		frequency = (row.frequency as 'weekly' | 'monthly' | 'yearly') || 'monthly';
		dayOfMonthText = row.day_of_month != null ? String(row.day_of_month) : '';
		startDate = dateInputValue(row.start_date);
		endDate = row.end_date != null ? dateInputValue(row.end_date) : '';
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		const amount = parseAmount(amountText);
		if (amount == null || amount <= 0) {
			error = 'Enter an amount greater than zero.';
			return;
		}
		if (!categoryId) {
			error = 'Pick a category.';
			return;
		}
		busy = true;

		const dayOfMonth =
			frequency === 'monthly' && dayOfMonthText.trim() !== ''
				? Number(dayOfMonthText)
				: null;

		const body = {
			amount,
			currency: currency.toUpperCase(),
			category_id: categoryId,
			merchant: merchant.trim(),
			description: description.trim(),
			frequency,
			day_of_month: dayOfMonth,
			start_date: unixFromDateInput(startDate),
			end_date: endDate ? unixFromDateInput(endDate) : null,
			client_updated_at: nowMillis()
		};

		const url = editingId ? `/api/recurring-expenses/${editingId}` : '/api/recurring-expenses';
		const method = editingId ? 'PUT' : 'POST';
		const targetKey = `recurring:${editingId ?? 'new'}:${nowMillis()}`;

		const result = await apiWrite<RecurringExpense>(method, url, body, targetKey);
		busy = false;
		if (result.kind === 'error') {
			error = result.error.message;
			return;
		}
		reset();
		await load();
	}

	async function remove(id: string) {
		if (!confirm('Delete this recurring expense?')) return;
		const before = rows;
		rows = rows.filter((r) => r.id !== id);
		const result = await apiWrite<void>('DELETE', `/api/recurring-expenses/${id}`, null, `recurring:${id}`);
		if (result.kind === 'error') {
			rows = before;
			error = result.error.message;
		}
	}

	onMount(load);
</script>

<h2>Recurring</h2>

<form onsubmit={submit}>
	<label>
		<span>Amount</span>
		<input type="number" step="0.01" min="0" inputmode="decimal" bind:value={amountText} required />
	</label>
	<label>
		<span>Currency</span>
		<input type="text" maxlength="3" bind:value={currency} required />
	</label>
	<label>
		<span>Category</span>
		<select bind:value={categoryId} required>
			{#each categories as cat}
				<option value={cat.id}>{cat.icon} {cat.name}</option>
			{/each}
		</select>
	</label>
	<label>
		<span>Merchant</span>
		<input type="text" bind:value={merchant} />
	</label>
	<label>
		<span>Note</span>
		<input type="text" bind:value={description} />
	</label>
	<label>
		<span>Frequency</span>
		<select bind:value={frequency}>
			<option value="weekly">Weekly</option>
			<option value="monthly">Monthly</option>
			<option value="yearly">Yearly</option>
		</select>
	</label>
	{#if frequency === 'monthly'}
		<label>
			<span>Day of month (optional)</span>
			<input type="number" min="1" max="31" bind:value={dayOfMonthText} />
		</label>
	{/if}
	<label>
		<span>Start date</span>
		<input type="date" bind:value={startDate} required />
	</label>
	<label>
		<span>End date (optional)</span>
		<input type="date" bind:value={endDate} />
	</label>

	{#if error}<p class="error">{error}</p>{/if}

	<div class="actions">
		<button type="submit" disabled={busy}>{editingId ? 'Save' : 'Add'}</button>
		{#if editingId}
			<button type="button" class="ghost" onclick={reset}>Cancel</button>
		{/if}
	</div>
</form>

{#if loading}
	<p>Loading…</p>
{:else if rows.length === 0}
	<p>No recurring expenses yet.</p>
{:else}
	<ul>
		{#each rows as row (row.id)}
			<li>
				<button type="button" class="row" onclick={() => startEdit(row)}>
					<div>
						<div class="merchant">{row.merchant || row.description || categoryName(row.category_id)}</div>
						<div class="sub">
							{row.frequency} · next {formatDate(row.next_run_date)}
						</div>
					</div>
					<div class="amount">{formatMoney(row.amount, row.currency)}</div>
				</button>
				<button type="button" class="del" onclick={() => remove(row.id)} aria-label="Delete">×</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-bottom: 16px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-weight: 600;
	}
	input,
	select {
		border: 1px solid #b8c4d2;
		border-radius: 8px;
		padding: 10px;
		background: white;
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	button {
		flex: 1;
		border: 0;
		border-radius: 8px;
		padding: 12px;
		background: #0f172a;
		color: white;
		font-weight: 700;
		cursor: pointer;
	}
	button.ghost {
		background: #e2e8f0;
		color: #0f172a;
	}
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
		flex: none;
	}
	.error {
		color: #991b1b;
	}
</style>
