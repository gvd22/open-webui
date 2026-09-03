<script lang="ts">
	import WorkspaceHost from './Artifacts/WorkspaceHost.svelte';

	export let overlay = false;
	export let history: Record<string, any> | null = null;
	export let showFiles = false;
	export let codeInterpreterEnabled = false;
	export let onAttach: ((blob: Blob, name: string, contentType: string) => void) | null = null;
</script>

<WorkspaceHost {overlay} {history} {showFiles} {codeInterpreterEnabled} {onAttach} on:close />
