<script lang="ts">
	import { getContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import type { WebPreviewArtifact } from '../Artifacts/webPreview';
	import { openWebPreviewArtifact } from './workspaceArtifactOpen';
	import ArtifactActivity from './ArtifactActivity.svelte';
	const i18n = getContext<any>('i18n');
	export let name = '';
	export let done = false;
	export let artifact: WebPreviewArtifact | undefined = undefined;
	export let error = '';
</script>

<ArtifactActivity
	{name}
	{done}
	{error}
	kind="web-preview"
	title={artifact?.title ?? ''}
	canOpen={!!artifact}
	onOpen={() =>
		artifact &&
		openWebPreviewArtifact(artifact, () => toast.error($i18n.t('Preview could not be refreshed')))}
/>
