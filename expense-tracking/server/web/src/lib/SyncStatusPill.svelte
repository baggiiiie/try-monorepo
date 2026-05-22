<script lang="ts">
	import { syncState } from './stores';

	const state = $derived($syncState);

	const labels = {
		synced: 'Synced',
		offline: 'Offline',
		syncing: 'Syncing',
		errors: 'Sync errors'
	} as const;

	const label = $derived(
		state.phase === 'errors'
			? `Sync errors (${state.failedWrites})`
			: state.phase === 'syncing' && state.pendingWrites > 0
				? `Syncing (${state.pendingWrites})`
				: labels[state.phase]
	);
</script>

<a href="/settings" class="pill" data-phase={state.phase}>{label}</a>

<style>
	.pill {
		text-decoration: none;
		border-radius: 999px;
		padding: 6px 10px;
		font-size: 12px;
		font-weight: 700;
		background: #dcfce7;
		color: #166534;
	}
	.pill[data-phase='offline'] {
		background: #fef3c7;
		color: #92400e;
	}
	.pill[data-phase='syncing'] {
		background: #dbeafe;
		color: #1e3a8a;
	}
	.pill[data-phase='errors'] {
		background: #fee2e2;
		color: #991b1b;
	}
</style>
