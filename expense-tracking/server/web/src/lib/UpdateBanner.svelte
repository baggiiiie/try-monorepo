<script lang="ts">
	import { updateAvailable, dismissUpdateBanner } from './sw-client';

	const state = $derived($updateAvailable);
</script>

{#if state.available}
	<div class="banner" role="status" aria-live="polite">
		<span>Update available.</span>
		<div class="actions">
			<button type="button" class="primary" onclick={() => state.apply()}>Reload</button>
			<button type="button" class="ghost" onclick={() => dismissUpdateBanner()}>Later</button>
		</div>
	</div>
{/if}

<style>
	.banner {
		position: fixed;
		left: 50%;
		bottom: max(16px, env(safe-area-inset-bottom));
		transform: translateX(-50%);
		display: flex;
		gap: 12px;
		align-items: center;
		padding: 10px 14px;
		border-radius: 999px;
		background: #0f172a;
		color: white;
		box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
		z-index: 100;
		font-weight: 600;
	}

	.actions {
		display: flex;
		gap: 8px;
	}

	button {
		border: 0;
		border-radius: 999px;
		padding: 6px 12px;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	.primary {
		background: #38bdf8;
		color: #0f172a;
	}

	.ghost {
		background: transparent;
		color: #cbd5f5;
	}
</style>
