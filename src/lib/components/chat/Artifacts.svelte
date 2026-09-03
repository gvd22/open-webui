<script lang="ts">
	import WorkspaceHost from './Artifacts/WorkspaceHost.svelte';

	export let overlay = false;
	export let history: Record<string, any> | null = null;
	export let showFiles = false;
</script>

<WorkspaceHost {overlay} {history} {showFiles} on:close />
