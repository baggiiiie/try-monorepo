<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { apiGet, apiWrite, ApiError } from '$lib/api';
	import type { Category, Expense, Preferences } from '$lib/types';
	import { newId, nowMillis } from '$lib/util';
	import ExpenseForm from '$lib/ExpenseForm.svelte';

	let categories = $state<Category[]>([]);
	let prefs = $state<Preferences | null>(null);
	let error = $state('');
	let ready = $state(false);

	onMount(async () => {
		try {
			const [c, p] = await Promise.all([
				apiGet<{ categories: Category[] }>('/api/categories'),
				apiGet<Preferences>('/api/preferences')
			]);
			categories = (c.categories ?? []).filter((cat) => !cat.deleted_at);
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
		const id = newId();
		const body = { ...value, id, client_updated_at: nowMillis() };
		const result = await apiWrite<Expense>('POST', '/api/expenses', body, `expense:${id}`);
		if (result.kind === 'error') {
			error = result.error.message;
			return;
		}
		await goto('/');
	}
</script>

<a href="/">← Back</a>
<h2>Add expense</h2>

{#if !ready}
	<p>Loading…</p>
{:else if !prefs}
	<p class="error">{error || 'Could not load preferences.'}</p>
{:else if categories.length === 0}
	<p>No categories yet. <a href="/categories">Add one</a> first.</p>
{:else}
	{#if error}<p class="error">{error}</p>{/if}
	<ExpenseForm
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
