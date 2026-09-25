<script lang="ts">
	import { getContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { generateCanvasTitle, type CanvasNoteArtifact } from '../Artifacts/canvas';
	import { openCanvasArtifact } from './workspaceArtifactOpen';
	import ArtifactActivity from './ArtifactActivity.svelte';
	const i18n = getContext<any>('i18n');
	export let name = '';
	export let done = false;
	export let artifact: CanvasNoteArtifact | undefined = undefined;
	export let error = '';
</script>

<ArtifactActivity
	{name}
	{done}
	{error}
	title={artifact ? generateCanvasTitle(artifact.content, artifact.title) : ''}
	canOpen={!!artifact}
	onOpen={() =>
		artifact &&
		openCanvasArtifact(artifact, () => toast.error($i18n.t('Document could not be opened')))}
/>
