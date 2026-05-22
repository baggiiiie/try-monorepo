<script lang="ts">
	import { untrack } from 'svelte';
	import type { Category, Expense } from './types';
	import { dateInputValue, parseAmount, unixFromDateInput } from './util';

	type FormValue = {
		amount: number;
		currency: string;
		category_id: string;
		merchant: string;
		description: string;
		date: number;
	};

	let {
		initial,
		categories,
		defaultCurrency,
		submitLabel = 'Save',
		onSubmit,
		onCancel
	}: {
		initial?: Partial<Expense>;
		categories: Category[];
		defaultCurrency: string;
		submitLabel?: string;
		onSubmit: (value: FormValue) => void | Promise<void>;
		onCancel?: () => void;
	} = $props();

	// Snapshot the props once: the form is recreated when the user navigates
	// to a different expense, so reactively re-initializing on every prop
	// change would clobber in-progress edits.
	let amountText = $state(
		untrack(() => (initial?.amount != null ? (initial.amount / 100).toFixed(2) : ''))
	);
	let currency = $state(untrack(() => initial?.currency || defaultCurrency));
	let categoryId = $state(untrack(() => initial?.category_id || categories[0]?.id || ''));
	let merchant = $state(untrack(() => initial?.merchant || ''));
	let description = $state(untrack(() => initial?.description || ''));
	let dateValue = $state(
		untrack(() => dateInputValue(initial?.date ?? Math.floor(Date.now() / 1000)))
	);

	let error = $state('');
	let busy = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		const amount = parseAmount(amountText);
		if (amount == null || amount <= 0) {
			error = 'Enter an amount greater than zero.';
			return;
		}
		if (!categoryId) {
			error = 'Pick a category first (add one under the Categories tab).';
			return;
		}
		busy = true;
		try {
			await onSubmit({
				amount,
				currency: currency.toUpperCase(),
				category_id: categoryId,
				merchant: merchant.trim(),
				description: description.trim(),
				date: unixFromDateInput(dateValue)
			});
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit}>
	<label>
		<span>Amount</span>
		<input
			type="number"
			step="0.01"
			min="0"
			inputmode="decimal"
			bind:value={amountText}
			required
		/>
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
		<span>Date</span>
		<input type="date" bind:value={dateValue} required />
	</label>

	{#if error}<p class="error">{error}</p>{/if}

	<div class="actions">
		<button type="submit" disabled={busy}>{submitLabel}</button>
		{#if onCancel}
			<button type="button" class="ghost" onclick={onCancel} disabled={busy}>Cancel</button>
		{/if}
	</div>
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 14px;
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
		margin-top: 8px;
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
	button[disabled] {
		opacity: 0.6;
	}
	.ghost {
		background: #e2e8f0;
		color: #0f172a;
	}
	.error {
		margin: 0;
		color: #991b1b;
		font-weight: 600;
	}
</style>
