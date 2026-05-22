<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { apiGet, apiWrite, exchangeSecret, ApiError } from '$lib/api';
	import { authState } from '$lib/stores';
	import { discard, drain, listAll, retry, type OutboxRecord } from '$lib/outbox';
	import type { Preferences } from '$lib/types';
	import { formatDateTime } from '$lib/util';

	const reauthHinted = $derived(page.url.searchParams.get('reauth') === '1');

	let secret = $state('');
	let secretMessage = $state('');
	let secretBusy = $state(false);

	let prefs = $state<Preferences | null>(null);
	let prefsMessage = $state('');
	let prefsBusy = $state(false);

	let failed = $state<OutboxRecord[]>([]);

	async function loadPrefs() {
		try {
			prefs = await apiGet<Preferences>('/api/preferences');
		} catch (e) {
			if (e instanceof ApiError) prefsMessage = e.message;
		}
	}

	async function refreshOutbox() {
		const all = await listAll();
		failed = all.filter((r) => r.status === 'failed').sort((a, b) => b.createdAt - a.createdAt);
	}

	async function saveSecret(event: SubmitEvent) {
		event.preventDefault();
		secretMessage = '';
		if (!secret.trim()) return;
		secretBusy = true;
		try {
			await exchangeSecret(secret.trim());
			secret = '';
			secretMessage = 'Secret saved. Reloading…';
			await loadPrefs();
			secretMessage = 'Secret saved.';
		} catch (e) {
			secretMessage = e instanceof ApiError ? e.message : String(e);
		} finally {
			secretBusy = false;
		}
	}

	async function savePrefs(event: SubmitEvent) {
		event.preventDefault();
		if (!prefs) return;
		prefsBusy = true;
		prefsMessage = '';
		const result = await apiWrite<Preferences>('PUT', '/api/preferences', prefs, 'preferences');
		prefsBusy = false;
		if (result.kind === 'error') {
			prefsMessage = result.error.message;
			return;
		}
		if (result.kind === 'ok') prefs = result.value;
		prefsMessage = 'Saved.';
	}

	async function onRetry(id: number) {
		await retry(id);
		await drain();
		await refreshOutbox();
	}

	async function onDiscard(id: number) {
		if (!confirm('Discard this failed write?')) return;
		await discard(id);
		await refreshOutbox();
	}

	onMount(async () => {
		await loadPrefs();
		await refreshOutbox();
	});

	$effect(() => {
		void $authState; // keep this component reactive to auth changes
	});
</script>

<h2>Settings</h2>

{#if reauthHinted || $authState === 'unauthenticated'}
	<p class="hint">Your session expired. Paste the sync secret to reconnect.</p>
{/if}

<section>
	<h3>Sync secret</h3>
	<form onsubmit={saveSecret}>
		<input
			type="password"
			placeholder="Paste secret"
			autocomplete="current-password"
			bind:value={secret}
		/>
		<button type="submit" disabled={secretBusy}>Save</button>
	</form>
	{#if secretMessage}<p class="msg">{secretMessage}</p>{/if}
</section>

<section>
	<h3>Preferences</h3>
	{#if prefs}
		<form onsubmit={savePrefs}>
			<label>
				<span>Currency</span>
				<input type="text" maxlength="3" bind:value={prefs.currency} />
			</label>
			<label>
				<span>Timezone</span>
				<input type="text" bind:value={prefs.timezone} />
			</label>
			<label>
				<span>Date format</span>
				<input type="text" bind:value={prefs.date_format} />
			</label>
			<button type="submit" disabled={prefsBusy}>Save</button>
		</form>
		{#if prefsMessage}<p class="msg">{prefsMessage}</p>{/if}
	{:else}
		<p>Loading…</p>
	{/if}
</section>

<section>
	<h3>Sync errors {#if failed.length > 0}({failed.length}){/if}</h3>
	{#if failed.length === 0}
		<p>No failed writes.</p>
	{:else}
		<ul>
			{#each failed as record (record.id)}
				<li>
					<div class="meta">
						<code>{record.method} {record.url}</code>
						<small>{formatDateTime(Math.floor(record.createdAt / 1000))}</small>
						{#if record.lastError}<p class="err">{record.lastError}</p>{/if}
					</div>
					<div class="row-actions">
						<button type="button" onclick={() => onRetry(record.id!)}>Retry</button>
						<button type="button" class="ghost" onclick={() => onDiscard(record.id!)}>Discard</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	section {
		margin-top: 20px;
		padding-top: 16px;
		border-top: 1px solid #d9e2ec;
	}
	h3 {
		margin: 0 0 10px;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	form > input,
	label > input {
		border: 1px solid #b8c4d2;
		border-radius: 8px;
		padding: 10px;
		background: white;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-weight: 600;
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
		gap: 8px;
	}
	li {
		background: white;
		border: 1px solid #fecaca;
		border-radius: 10px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	code {
		font-size: 13px;
	}
	small {
		color: #64748b;
	}
	.err {
		margin: 6px 0 0;
		color: #991b1b;
		font-size: 13px;
	}
	.row-actions {
		display: flex;
		gap: 8px;
	}
	.hint {
		background: #fef3c7;
		border: 1px solid #fde68a;
		border-radius: 8px;
		padding: 10px;
		color: #92400e;
	}
	.msg {
		color: #166534;
	}
</style>
