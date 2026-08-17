<script lang="ts">
	import { onDestroy, getContext, createEventDispatcher } from 'svelte';
	import type { ListeningPort } from '$lib/apis/terminal';
	import { getListeningPorts, getPortProxyUrl } from '$lib/apis/terminal';
	import Tooltip from '$lib/components/common/Tooltip.svelte';

	const i18n = getContext('i18n');
	const dispatch = createEventDispatcher<{ previewPort: number }>();

	export let baseUrl: string;
	export let apiKey: string;

	let ports: ListeningPort[] = [];
	let expanded = false;
	let loading = false;
	let loadError = false;
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	const loadPorts = async () => {
		loading = true;
		try {
			ports = await getListeningPorts(baseUrl, apiKey, { throwOnError: true });
			loadError = false;
		} catch {
			ports = [];
			loadError = true;
		} finally {
			loading = false;
		}
	};

	const startPolling = () => {
		stopPolling();
		loadPorts();
		pollTimer = setInterval(loadPorts, 5000);
	};

	const stopPolling = () => {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	};

	const previewPort = (port: number) => {
		dispatch('previewPort', port);
	};

	const openPortExternal = (port: number) => {
		const url = getPortProxyUrl(baseUrl, port);
		window.open(url, '_blank', 'noopener,noreferrer');
	};

	// Start polling when baseUrl is available
	$: if (baseUrl) {
		startPolling();
	}

	onDestroy(() => {
		stopPolling();
	});
</script>

{#if ports.length > 0 || loadError}
	<div class="border-t border-gray-100 px-2 py-1 dark:border-gray-800">
		<div class="flex items-center gap-1">
			<button
				type="button"
				class="flex min-w-0 flex-1 items-center gap-1 text-xs font-normal text-gray-500 transition hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
				on:click={() => (expanded = !expanded)}
				aria-expanded={expanded}
				aria-controls="terminal-port-list"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 20 20"
					fill="currentColor"
					class="size-3 transition-transform {expanded ? '' : '-rotate-90'}"
				>
					<path
						fill-rule="evenodd"
						d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
						clip-rule="evenodd"
					/>
				</svg>
				<span class="truncate">{$i18n.t('Ports')}</span>
				{#if ports.length > 0}
					<span
						class="ml-auto rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400"
					>
						{ports.length}
					</span>
				{/if}
			</button>
			<Tooltip content={$i18n.t('Refresh')}>
				<button
					type="button"
					class="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-400"
					on:click={loadPorts}
					aria-label={$i18n.t('Refresh')}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="size-3 {loading ? 'animate-spin' : ''}"
					>
						<path
							fill-rule="evenodd"
							d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.451a.75.75 0 0 0 0-1.5H4.5a.75.75 0 0 0-.75.75v3.75a.75.75 0 0 0 1.5 0v-2.127l.13.13a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm-10.624-2.85a5.5 5.5 0 0 1 9.201-2.465l.312.31H11.75a.75.75 0 0 0 0 1.5h3.75a.75.75 0 0 0 .75-.75V3.42a.75.75 0 0 0-1.5 0v2.126l-.13-.129A7 7 0 0 0 3.239 8.555a.75.75 0 0 0 1.449.39Z"
							clip-rule="evenodd"
						/>
					</svg>
				</button>
			</Tooltip>
		</div>

		{#if expanded}
			<div id="terminal-port-list" class="mt-1 max-h-[150px] space-y-0.5 overflow-y-auto">
				{#if loadError}
					<div class="px-1.5 py-1 text-xs text-gray-400 dark:text-gray-500">
						{$i18n.t('Terminal is currently unavailable')}
					</div>
				{/if}
				{#each ports as port}
					<div class="group flex items-center rounded hover:bg-gray-100 dark:hover:bg-gray-800">
						<button
							type="button"
							class="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-xs"
							on:click={() => previewPort(port.port)}
						>
							<span class="font-mono text-blue-500 dark:text-blue-400 shrink-0">
								:{port.port}
							</span>
							<span class="text-gray-500 dark:text-gray-400 truncate flex-1 text-left">
								{port.process ?? ''}
							</span>
						</button>
						<Tooltip content={$i18n.t('Open in new tab')}>
							<button
								type="button"
								class="mr-1 shrink-0 rounded p-0.5 text-gray-400 opacity-70 transition hover:bg-gray-200 hover:text-gray-600 focus-visible:opacity-100 group-hover:opacity-100 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
								on:click={() => openPortExternal(port.port)}
								aria-label={`${$i18n.t('Open in new tab')}: ${port.port}`}
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 20 20"
									fill="currentColor"
									class="size-3"
								>
									<path
										fill-rule="evenodd"
										d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Zm7.5-3.5a.75.75 0 0 0 0 1.5h2.69l-4.72 4.72a.75.75 0 0 0 1.06 1.06l4.72-4.72v2.69a.75.75 0 0 0 1.5 0v-5.25a.75.75 0 0 0-.75-.75h-5.25Z"
										clip-rule="evenodd"
									/>
								</svg>
							</button>
						</Tooltip>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
