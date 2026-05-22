<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { registerServiceWorker } from '$lib/sw-client';
	import { startOutboxDraining } from '$lib/outbox';
	import { syncState, setSyncPhase } from '$lib/stores';
	import UpdateBanner from '$lib/UpdateBanner.svelte';
	import IosInstallHint from '$lib/IosInstallHint.svelte';
	import SyncStatusPill from '$lib/SyncStatusPill.svelte';

	let { children } = $props();

	const tabs = [
		{ href: '/', label: 'Expenses', match: (path: string) => path === '/' || path.startsWith('/expenses') },
		{ href: '/categories', label: 'Categories', match: (path: string) => path.startsWith('/categories') },
		{ href: '/recurring', label: 'Recurring', match: (path: string) => path.startsWith('/recurring') },
		{ href: '/suggestions', label: 'Wallet', match: (path: string) => path.startsWith('/suggestions') },
		{ href: '/settings', label: 'Settings', match: (path: string) => path.startsWith('/settings') }
	];

	const path = $derived(page.url.pathname);

	onMount(() => {
		registerServiceWorker();
		startOutboxDraining();

		const online = () => setSyncPhase('synced');
		const offline = () => setSyncPhase('offline');
		window.addEventListener('online', online);
		window.addEventListener('offline', offline);
		return () => {
			window.removeEventListener('online', online);
			window.removeEventListener('offline', offline);
		};
	});

	$effect(() => {
		// Touch the sync state once so derived UI subscribes.
		void $syncState;
	});
</script>

<header class="header">
	<h1>Expenses</h1>
	<SyncStatusPill />
</header>

<main class="main">
	{@render children()}
</main>

<nav class="tabs" aria-label="Primary">
	{#each tabs as tab}
		<a href={tab.href} class:active={tab.match(path)}>{tab.label}</a>
	{/each}
</nav>

<UpdateBanner />
<IosInstallHint />

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		background: #f8fafc;
		color: #0f172a;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}

	:global(button),
	:global(input),
	:global(select),
	:global(textarea) {
		font: inherit;
	}

	:global(a) {
		color: #0f172a;
	}

	.header {
		position: sticky;
		top: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		background: rgba(248, 250, 252, 0.92);
		border-bottom: 1px solid #d9e2ec;
		backdrop-filter: blur(12px);
	}

	.header h1 {
		margin: 0;
		font-size: 18px;
	}

	.main {
		max-width: 720px;
		margin: 0 auto;
		padding: 16px;
		padding-bottom: 88px;
	}

	.tabs {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		background: white;
		border-top: 1px solid #d9e2ec;
		padding-bottom: env(safe-area-inset-bottom);
		z-index: 10;
	}

	.tabs a {
		text-decoration: none;
		padding: 10px 4px;
		text-align: center;
		font-size: 12px;
		font-weight: 600;
		color: #64748b;
	}

	.tabs a.active {
		color: #0f172a;
	}
</style>
