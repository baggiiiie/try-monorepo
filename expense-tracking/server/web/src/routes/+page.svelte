<script lang="ts">
	import { onMount } from 'svelte';
	import { apiGet, apiWrite, ApiError } from '$lib/api';
	import type { Expense, ExpenseListResponse } from '$lib/types';
	import { dayKey, formatDate, formatMoney } from '$lib/util';

	let expenses = $state<Expense[]>([]);
	let cursor = $state<number | undefined>(undefined);
	let loading = $state(true);
	let loadingMore = $state(false);
	let error = $state('');

	type Group = { dayKey: string; date: number; items: Expense[] };
	const groups: Group[] = $derived.by(() => {
		const map = new Map<string, Group>();
		for (const e of expenses) {
			const key = dayKey(e.date);
			const existing = map.get(key);
			if (existing) {
				existing.items.push(e);
			} else {
				map.set(key, { dayKey: key, date: e.date, items: [e] });
			}
		}
		return Array.from(map.values()).sort((a, b) => b.date - a.date);
	});

	async function loadFirstPage() {
		loading = true;
		error = '';
		try {
			const data = await apiGet<ExpenseListResponse>('/api/expenses');
			expenses = data.expenses ?? [];
			cursor = data.next_before;
		} catch (e) {
			if (e instanceof ApiError && e.status !== 401) error = e.message;
			else if (!(e instanceof ApiError)) error = String(e);
		} finally {
			loading = false;
		}
	}

	async function loadMore() {
		if (loadingMore || cursor == null) return;
		loadingMore = true;
		try {
			const data = await apiGet<ExpenseListResponse>(`/api/expenses?before=${cursor}`);
			expenses = [...expenses, ...(data.expenses ?? [])];
			cursor = data.next_before;
		} catch (e) {
			if (e instanceof ApiError && e.status !== 401) error = e.message;
		} finally {
			loadingMore = false;
		}
	}

	async function remove(id: string) {
		if (!confirm('Delete this expense?')) return;
		const before = expenses;
		expenses = expenses.filter((e) => e.id !== id);
		const result = await apiWrite<void>('DELETE', `/api/expenses/${id}`, null, `expense:${id}`);
		if (result.kind === 'error') {
			expenses = before;
			error = result.error.message;
		}
	}

	onMount(loadFirstPage);
</script>

<div class="bar">
	<h2>Expenses</h2>
	<a class="primary" href="/expenses/new">+ Add</a>
</div>

{#if loading}
	<p>Loading…</p>
{:else if error}
	<p class="error">{error} <button type="button" onclick={loadFirstPage}>Retry</button></p>
{:else if expenses.length === 0}
	<p>No expenses yet.</p>
{:else}
	{#each groups as group (group.dayKey)}
		<section>
			<h3>{formatDate(group.date)}</h3>
			<ul>
				{#each group.items as exp (exp.id)}
					<li>
						<a class="row" href={`/expenses/${exp.id}`}>
							<div>
								<div class="merchant">{exp.merchant || exp.description || exp.category}</div>
								<div class="sub">{exp.category}</div>
							</div>
							<div class="amount">{formatMoney(exp.amount, exp.currency)}</div>
						</a>
						<button type="button" class="del" onclick={() => remove(exp.id)} aria-label="Delete">×</button>
					</li>
				{/each}
			</ul>
		</section>
	{/each}

	{#if cursor != null}
		<button type="button" class="loadmore" onclick={loadMore} disabled={loadingMore}>
			{loadingMore ? 'Loading…' : 'Load older'}
		</button>
	{/if}
{/if}

<style>
	.bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 16px;
	}
	.bar h2 {
		margin: 0;
	}
	.primary {
		background: #0f172a;
		color: white;
		text-decoration: none;
		padding: 8px 12px;
		border-radius: 8px;
		font-weight: 700;
	}
	section {
		margin-top: 16px;
	}
	h3 {
		font-size: 13px;
		text-transform: uppercase;
		color: #64748b;
		margin: 0 0 6px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	li {
		display: flex;
		gap: 6px;
		align-items: stretch;
	}
	.row {
		flex: 1;
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: white;
		padding: 12px 14px;
		border-radius: 10px;
		text-decoration: none;
		color: inherit;
		border: 1px solid #e2e8f0;
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
		border: 0;
		border-radius: 10px;
		padding: 0 12px;
		background: #fee2e2;
		color: #991b1b;
		font-size: 18px;
		font-weight: 700;
		cursor: pointer;
	}
	.loadmore {
		display: block;
		margin: 16px auto;
		padding: 10px 16px;
		border: 1px solid #cbd5e1;
		background: white;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
	}
	.error {
		color: #991b1b;
	}
</style>
