<script lang="ts">
	import WorkspaceHost from './Artifacts/WorkspaceHost.svelte';

	export let overlay = false;
	export let history: Record<string, any> | null = null;
	export let showFiles = false;
	export let codeInterpreterEnabled = false;
</script>

<WorkspaceHost {overlay} {history} {showFiles} {codeInterpreterEnabled} on:close />
