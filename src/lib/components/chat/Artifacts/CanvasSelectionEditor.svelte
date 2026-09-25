<script lang="ts">
	import { getContext } from 'svelte';
	import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
	import XMark from '$lib/components/icons/XMark.svelte';
	import ChatBubbleOvalLeft from '$lib/components/icons/ChatBubbleOval.svelte';

	export let editor: any;
	export let selection = '';
	export let disabled = false;
	export let onAdd: (instruction: string) => Promise<boolean | void>;
	const i18n = getContext<any>('i18n');
	let instruction = '';
	let dismissed = false;
	let previousSelection = '';
	let busy = false;
	let menu: HTMLElement;
	$: if (selection !== previousSelection) {
		previousSelection = selection;
		dismissed = false;
		instruction = '';
	}
	const position = (element: HTMLElement) => {
		const reference = {
			contextElement: editor.view.dom,
			getBoundingClientRect: () => {
				const { from, to } = editor.state.selection;
				const start = editor.view.coordsAtPos(from),
					end = editor.view.coordsAtPos(to);
				return new DOMRect(
					start.left,
					start.top,
					Math.max(0, end.right - start.left),
					end.bottom - start.top
				);
			}
		};
		let disposed = false;
		const cleanup = autoUpdate(reference, element, () => {
			computePosition(reference, element, {
				placement: 'bottom-start',
				strategy: 'fixed',
				middleware: [offset(8), flip(), shift({ padding: 12 })]
			}).then(({ x, y }) => {
				if (!disposed)
					Object.assign(element.style, { left: `${x}px`, top: `${y}px`, visibility: 'visible' });
			});
		});
		return {
			destroy() {
				disposed = true;
				cleanup();
			}
		};
	};
	const add = async () => {
		if (busy) return;
		busy = true;
		try {
			if (await onAdd(instruction)) dismissed = true;
		} finally {
			busy = false;
		}
	};
	const outside = (event: PointerEvent) => {
		if (
			menu &&
			!menu.contains(event.target as Node) &&
			!editor?.view.dom.contains(event.target as Node)
		)
			dismissed = true;
	};
</script>

<svelte:window
	on:pointerdown={outside}
	on:keydown={(event) => {
		if (event.key === 'Escape') dismissed = true;
	}}
/>

{#if selection.trim() && !disabled && !dismissed}
	{#key selection}
		<form
			bind:this={menu}
			use:position
			on:submit|preventDefault={add}
			class="fixed z-50 w-80 max-w-[calc(100vw-24px)] rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-850"
			style:visibility="hidden"
			aria-label={$i18n.t('Edit selected passage')}
		>
			<div class="flex items-start gap-2">
				<textarea
					rows="2"
					class="min-w-0 flex-1 resize-none bg-transparent p-1 text-sm outline-none"
					aria-label={$i18n.t('Selection instruction')}
					placeholder={$i18n.t('What should change?')}
					maxlength="4000"
					bind:value={instruction}
					on:keydown={(event) => {
						if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
							event.preventDefault();
							void add();
						}
					}}
				></textarea>
				<button
					type="button"
					class="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
					aria-label={$i18n.t('Close')}
					on:click={() => (dismissed = true)}><XMark className="size-4" /></button
				>
			</div>
			<button
				type="submit"
				disabled={busy}
				class="mt-1 flex w-full items-center justify-center gap-2 rounded-md bg-gray-100 px-2 py-2 text-xs font-medium hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:hover:bg-gray-700"
			>
				<ChatBubbleOvalLeft className="size-4" />{$i18n.t(busy ? 'Preparing...' : 'Add to chat')}
			</button>
		</form>
	{/key}
{/if}
