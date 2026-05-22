<script lang="ts">
	import { onMount } from 'svelte';
	import { apiGet, apiWrite, ApiError } from '$lib/api';
	import type { Category } from '$lib/types';
	import { formatMoney, nowMillis, parseAmount } from '$lib/util';

	let categories = $state<Category[]>([]);
	let loading = $state(true);
	let error = $state('');

	// Form state — used for both add and edit (when editingId is set).
	let editingId = $state<string | null>(null);
	let name = $state('');
	let icon = $state('💸');
	let budgetText = $state('');
	let busy = $state(false);

	async function load() {
		loading = true;
		try {
			const data = await apiGet<{ categories: Category[] }>('/api/categories');
			categories = (data.categories ?? []).filter((c) => !c.deleted_at);
		} catch (e) {
			if (e instanceof ApiError && e.status !== 401) error = e.message;
		} finally {
			loading = false;
		}
	}

	function reset() {
		editingId = null;
		name = '';
		icon = '💸';
		budgetText = '';
		error = '';
	}

	function startEdit(cat: Category) {
		editingId = cat.id;
		name = cat.name;
		icon = cat.icon;
		budgetText = cat.budget != null ? (cat.budget / 100).toFixed(2) : '';
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) {
			error = 'Name is required.';
			return;
		}
		busy = true;
		const budget = budgetText.trim() === '' ? null : parseAmount(budgetText);
		const body = {
			name: name.trim(),
			icon: icon.trim() || '💸',
			budget,
			client_updated_at: nowMillis()
		};

		const url = editingId ? `/api/categories/${editingId}` : '/api/categories';
		const method = editingId ? 'PUT' : 'POST';
		const targetKey = `category:${editingId ?? name.toLowerCase()}`;

		const result = await apiWrite<Category>(method, url, body, targetKey);
		busy = false;
		if (result.kind === 'error') {
			error = result.error.message;
			return;
		}
		reset();
		await load();
	}

	async function remove(id: string) {
		if (!confirm('Delete this category?')) return;
		const before = categories;
		categories = categories.filter((c) => c.id !== id);
		const result = await apiWrite<void>('DELETE', `/api/categories/${id}`, null, `category:${id}`);
		if (result.kind === 'error') {
			categories = before;
			error = result.error.message;
		}
	}

	onMount(load);
</script>

<h2>Categories</h2>

<form onsubmit={submit}>
	<input type="text" placeholder="Icon" maxlength="4" bind:value={icon} />
	<input type="text" placeholder="Name" bind:value={name} required />
	<input
		type="number"
		step="0.01"
		min="0"
		inputmode="decimal"
		placeholder="Monthly budget (optional)"
		bind:value={budgetText}
	/>
	<div class="actions">
		<button type="submit" disabled={busy}>{editingId ? 'Save' : 'Add'}</button>
		{#if editingId}
			<button type="button" class="ghost" onclick={reset}>Cancel</button>
		{/if}
	</div>
</form>

{#if error}<p class="error">{error}</p>{/if}

{#if loading}
	<p>Loading…</p>
{:else if categories.length === 0}
	<p>No categories yet.</p>
{:else}
	<ul>
		{#each categories as cat (cat.id)}
			<li>
				<button type="button" class="row" onclick={() => startEdit(cat)}>
					<span class="icon">{cat.icon}</span>
					<span class="name">{cat.name}</span>
					<span class="budget">{cat.budget != null ? formatMoney(cat.budget) : ''}</span>
				</button>
				<button type="button" class="del" onclick={() => remove(cat.id)} aria-label="Delete">×</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	form {
		display: grid;
		grid-template-columns: 64px 1fr 1fr;
		gap: 8px;
		margin: 12px 0;
	}
	input {
		border: 1px solid #b8c4d2;
		border-radius: 8px;
		padding: 10px;
		background: white;
	}
	.actions {
		grid-column: 1 / -1;
		display: flex;
		gap: 8px;
	}
	button {
		border: 0;
		border-radius: 8px;
		padding: 10px 14px;
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
		display: grid;
		grid-template-columns: 32px 1fr auto;
		align-items: center;
		gap: 12px;
		background: white;
		color: inherit;
		border: 1px solid #e2e8f0;
		border-radius: 10px;
		padding: 12px;
		text-align: left;
		cursor: pointer;
	}
	.icon {
		font-size: 20px;
	}
	.name {
		font-weight: 700;
	}
	.budget {
		color: #64748b;
		font-size: 13px;
	}
	.del {
		background: #fee2e2;
		color: #991b1b;
		font-size: 18px;
		padding: 0 14px;
		border-radius: 10px;
	}
	.error {
		color: #991b1b;
	}
</style>
