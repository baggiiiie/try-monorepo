<script lang="ts">
	import { browser } from '$app/environment';

	type SyncState = 'Synced' | 'Offline' | 'Syncing' | 'Sync errors';

	let status = $state<SyncState>(browser && navigator.onLine ? 'Synced' : 'Offline');
	let secret = $state('');
	let message = $state('');

	async function exchangeSecret() {
		status = 'Syncing';
		message = '';
		const response = await fetch('/api/auth/exchange', {
			method: 'POST',
			headers: { Authorization: `Bearer ${secret}` },
			credentials: 'same-origin'
		});
		if (!response.ok) {
			status = 'Sync errors';
			message = 'Secret rejected.';
			return;
		}
		secret = '';
		status = browser && navigator.onLine ? 'Synced' : 'Offline';
		message = 'Secret saved.';
	}

	$effect(() => {
		if (!browser) return;
		const online = () => (status = 'Synced');
		const offline = () => (status = 'Offline');
		window.addEventListener('online', online);
		window.addEventListener('offline', offline);
		return () => {
			window.removeEventListener('online', online);
			window.removeEventListener('offline', offline);
		};
	});
</script>

<svelte:head>
	<title>Expenses</title>
</svelte:head>

<main class="app">
	<header class="top">
		<div>
			<h1>Expenses</h1>
			<p>{message || 'Web client shell'}</p>
		</div>
		<span class:error={status === 'Sync errors'} class:offline={status === 'Offline'}>{status}</span>
	</header>

	<section>
		<h2>Settings</h2>
		<form onsubmit={(event) => { event.preventDefault(); void exchangeSecret(); }}>
			<label for="secret">Sync secret</label>
			<div class="row">
				<input id="secret" bind:value={secret} type="password" autocomplete="current-password" />
				<button type="submit">Save</button>
			</div>
		</form>
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		background: #f8fafc;
		color: #0f172a;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}

	.app {
		max-width: 760px;
		margin: 0 auto;
		padding: 16px;
	}

	.top,
	.row {
		display: flex;
		gap: 12px;
		align-items: center;
		justify-content: space-between;
	}

	.top {
		position: sticky;
		top: 0;
		padding: 12px 0;
		background: rgba(248, 250, 252, 0.94);
		border-bottom: 1px solid #d9e2ec;
		backdrop-filter: blur(12px);
	}

	h1,
	p {
		margin: 0;
	}

	section {
		margin-top: 24px;
		padding: 16px 0;
		border-top: 1px solid #d9e2ec;
	}

	label {
		display: block;
		margin-bottom: 8px;
		font-weight: 700;
	}

	input {
		min-width: 0;
		flex: 1;
		border: 1px solid #b8c4d2;
		border-radius: 8px;
		padding: 10px;
		font: inherit;
	}

	button,
	span {
		border: 0;
		border-radius: 8px;
		padding: 10px 12px;
		background: #0f172a;
		color: white;
		font-weight: 700;
	}

	span {
		background: #dcfce7;
		color: #166534;
	}

	span.offline {
		background: #fef3c7;
		color: #92400e;
	}

	span.error {
		background: #fee2e2;
		color: #991b1b;
	}
</style>
