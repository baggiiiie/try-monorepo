<script lang="ts">
	import { browser } from '$app/environment';

	const STORAGE_KEY = 'et:ios-install-hint-dismissed';

	type NavigatorWithStandalone = Navigator & { standalone?: boolean };

	function shouldShow(): boolean {
		if (!browser) return false;
		if (localStorage.getItem(STORAGE_KEY) === '1') return false;

		const ua = navigator.userAgent;
		const isIos = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);
		// iPadOS 13+ reports as Mac; detect via touch points.
		const isIpadOs = ua.includes('Macintosh') && navigator.maxTouchPoints > 1;
		if (!isIos && !isIpadOs) return false;

		// Safari only — Chrome / Firefox on iOS cannot install PWAs.
		const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
		if (!isSafari) return false;

		const standalone =
			window.matchMedia?.('(display-mode: standalone)').matches ||
			(navigator as NavigatorWithStandalone).standalone === true;
		if (standalone) return false;

		return true;
	}

	let visible = $state(false);

	$effect(() => {
		visible = shouldShow();
	});

	function dismiss() {
		if (browser) localStorage.setItem(STORAGE_KEY, '1');
		visible = false;
	}
</script>

{#if visible}
	<div class="sheet" role="dialog" aria-modal="false" aria-labelledby="ios-install-title">
		<div class="card">
			<h2 id="ios-install-title">Install Expenses</h2>
			<p>Add this app to your Home Screen for a full-screen, app-like experience.</p>
			<ol>
				<li>Tap the <strong>Share</strong> button in Safari's toolbar.</li>
				<li>Choose <strong>Add to Home Screen</strong>.</li>
				<li>Tap <strong>Add</strong>.</li>
			</ol>
			<button type="button" onclick={dismiss}>Got it</button>
		</div>
	</div>
{/if}

<style>
	.sheet {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		background: rgba(15, 23, 42, 0.35);
		padding: 16px;
		z-index: 90;
	}

	.card {
		width: 100%;
		max-width: 440px;
		background: white;
		color: #0f172a;
		border-radius: 16px;
		padding: 20px;
		box-shadow: 0 18px 40px rgba(15, 23, 42, 0.25);
	}

	h2 {
		margin: 0 0 8px;
	}

	p {
		margin: 0 0 12px;
		color: #334155;
	}

	ol {
		margin: 0 0 16px;
		padding-left: 20px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	button {
		width: 100%;
		border: 0;
		border-radius: 10px;
		padding: 12px;
		background: #0f172a;
		color: white;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}
</style>
