<script lang="ts">
	import Icon from './Icon.svelte';
	import { fileIconName, fileIconTone } from './fileIcon';

	export let name = '';
	export let type = 'file';
	export let size = 14;
	export let strokeWidth = 1.4;

	$: iconName = fileIconName(name, type);
	$: tone = fileIconTone(name, type);
</script>

<Icon name={iconName} {size} {strokeWidth} class={`shrink-0 ${tone}`} />
