<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { apiGet, apiWrite, ApiError } from '$lib/api';
	import type { Category, Expense, Preferences } from '$lib/types';
	import { nowMillis } from '$lib/util';
	import ExpenseForm from '$lib/ExpenseForm.svelte';

	const id = $derived(page.params.id as string);

	let expense = $state<Expense | null>(null);
	let categories = $state<Category[]>([]);
	let prefs = $state<Preferences | null>(null);
	let error = $state('');
	let ready = $state(false);

	onMount(async () => {
		try {
			const [exp, cats, p] = await Promise.all([
				apiGet<Expense>(`/api/expenses/${id}`),
				apiGet<{ categories: Category[] }>('/api/categories'),
				apiGet<Preferences>('/api/preferences')
			]);
			expense = exp;
			categories = (cats.categories ?? []).filter((c) => !c.deleted_at);
			prefs = p;
		} catch (e) {
			if (e instanceof ApiError && e.status !== 401) error = e.message;
		} finally {
			ready = true;
		}
	});

	async function submit(value: {
		amount: number;
		currency: string;
		category_id: string;
		merchant: string;
		description: string;
		date: number;
	}) {
		const body = { ...value, client_updated_at: nowMillis() };
		const result = await apiWrite<Expense>('PUT', `/api/expenses/${id}`, body, `expense:${id}`);
		if (result.kind === 'error') {
			error = result.error.message;
			return;
		}
		await goto('/');
	}
</script>

<a href="/">← Back</a>
<h2>Edit expense</h2>

{#if !ready}
	<p>Loading…</p>
{:else if !expense || !prefs}
	<p class="error">{error || 'Expense not found.'}</p>
{:else}
	{#if error}<p class="error">{error}</p>{/if}
	<ExpenseForm
		initial={expense}
		{categories}
		defaultCurrency={prefs.currency}
		submitLabel="Save"
		onSubmit={submit}
		onCancel={() => goto('/')}
	/>
{/if}

<style>
	.error {
		color: #991b1b;
	}
	h2 {
		margin-top: 8px;
	}
</style>
