<script lang="ts">
	import { getContext, onDestroy, onMount } from 'svelte';

	import { getListeningPorts, type ListeningPort } from '$lib/apis/terminal';
	import ArrowPath from '$lib/components/icons/ArrowPath.svelte';
	import GlobeAlt from '$lib/components/icons/GlobeAlt.svelte';
	import TerminalIcon from '$lib/components/icons/Terminal.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import {
		artifactCode,
		selectedTerminalId,
		terminalServers,
		workspaceTerminalConnectionId
	} from '$lib/stores';

	import PortPreview from '../FileNav/PortPreview.svelte';
	import {
		isKeyboardActivationClick,
		resolveBoundWorkspaceTerminal,
		WORKSPACE_TERMINAL_ID
	} from './workspace';

	const i18n = getContext('i18n');

	export let overlay = false;
	export let terminalId: string | null = null;

	let ports: ListeningPort[] = [];
	let selectedPort: number | null = null;
	let loading = false;
	let loadError = '';
	let loadedTerminalUrl = '';
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let portsRequestSequence = 0;

	$: terminal = resolveBoundWorkspaceTerminal($terminalServers, terminalId);

	const loadPorts = async (showLoading = true) => {
		const requestId = ++portsRequestSequence;
		const requestedTerminal = terminal;
		if (!requestedTerminal) {
			ports = [];
			selectedPort = null;
			loadError = $i18n.t('This Terminal connection is unavailable');
			return;
		}
		if (showLoading) loading = true;
		try {
			const nextPorts = await getListeningPorts(requestedTerminal.url, localStorage.token, {
				throwOnError: true
			});
			if (requestId !== portsRequestSequence || terminal?.id !== requestedTerminal.id) return;
			ports = nextPorts;
			loadError = '';
			if (selectedPort !== null && !ports.some((port) => port.port === selectedPort)) {
				selectedPort = null;
			}
		} catch {
			if (requestId !== portsRequestSequence || terminal?.id !== requestedTerminal.id) return;
			ports = [];
			selectedPort = null;
			loadError = $i18n.t('Terminal is currently unavailable');
		} finally {
			if (showLoading && requestId === portsRequestSequence) loading = false;
		}
	};

	const openTerminal = () => {
		if (!terminal?.id) return;
		selectedTerminalId.set(terminal.id);
		workspaceTerminalConnectionId.set(terminal.id);
		artifactCode.set(WORKSPACE_TERMINAL_ID);
	};

	const onKeyboardClick = (event: MouseEvent, action: () => void) => {
		if (isKeyboardActivationClick(event.detail)) action();
	};

	$: if (terminal?.url && terminal.url !== loadedTerminalUrl) {
		loadedTerminalUrl = terminal.url;
		loadPorts();
	}

	$: if (!terminal && loadedTerminalUrl) {
		portsRequestSequence += 1;
		loadedTerminalUrl = '';
		ports = [];
		selectedPort = null;
		loading = false;
		loadError = $i18n.t('This Terminal connection is unavailable');
	}

	$: if (!terminal && !loadedTerminalUrl) {
		loadError = $i18n.t('This Terminal connection is unavailable');
	}

	onMount(() => {
		pollTimer = setInterval(() => void loadPorts(false), 4000);
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
	});
</script>

{#if selectedPort !== null && terminal}
	<PortPreview
		baseUrl={terminal.url}
		port={selectedPort}
		{overlay}
		onClose={() => (selectedPort = null)}
	/>
{:else}
	<div class="flex h-full flex-col">
		<div class="flex-1 overflow-y-auto">
			{#if loading}
				<div class="flex h-40 items-center justify-center"><Spinner className="size-4" /></div>
			{:else if loadError}
				<div class="flex h-full min-h-64 flex-col items-center justify-center px-8 text-center">
					<div class="text-sm font-medium text-gray-800 dark:text-gray-200">{loadError}</div>
					<div class="mt-1 max-w-sm text-xs leading-5 text-gray-400 dark:text-gray-500">
						{$i18n.t('Check the configured Terminal service, then try again.')}
					</div>
					<button
						type="button"
						class="mt-4 flex h-8 items-center gap-1.5 rounded-md bg-gray-100 px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
						on:mousedown|preventDefault|stopPropagation={() => loadPorts()}
						on:click={(event) => onKeyboardClick(event, () => loadPorts())}
					>
						<ArrowPath className="size-3.5" />
						<span>{$i18n.t('Try again')}</span>
					</button>
				</div>
			{:else if ports.length > 0}
				<div class="px-3 py-3">
					<div class="mb-2 flex h-8 items-center justify-between px-1">
						<div>
							<div class="text-sm font-medium text-gray-800 dark:text-gray-200">
								{$i18n.t('Available web apps')}
							</div>
							<div class="text-[11px] text-gray-400 dark:text-gray-500">
								{$i18n.t('Running on this workspace')}
							</div>
						</div>
						<button
							type="button"
							class="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
							on:mousedown|preventDefault|stopPropagation={() => loadPorts()}
							on:click={(event) => onKeyboardClick(event, () => loadPorts())}
						>
							<ArrowPath className="size-3.5" />
							<span>{$i18n.t('Check again')}</span>
						</button>
					</div>
					<div class="space-y-1">
						{#each ports as port (port.port)}
							<button
								type="button"
								class="flex h-12 w-full items-center gap-3 rounded-lg border border-transparent px-3 text-left transition hover:border-gray-100 hover:bg-gray-50 dark:hover:border-gray-800 dark:hover:bg-gray-800/60"
								on:mousedown|preventDefault|stopPropagation={() => (selectedPort = port.port)}
								on:click={(event) => onKeyboardClick(event, () => (selectedPort = port.port))}
							>
								<GlobeAlt className="size-4 text-gray-400" strokeWidth="1.6" />
								<div class="min-w-0 flex-1">
									<div class="truncate text-sm text-gray-700 dark:text-gray-200">
										localhost:{port.port}
									</div>
									{#if port.process}
										<div class="truncate text-xs text-gray-400">{port.process}</div>
									{/if}
								</div>
							</button>
						{/each}
					</div>
				</div>
			{:else}
				<div class="flex h-full min-h-64 flex-col items-center justify-center px-8 text-center">
					<div
						class="flex size-10 items-center justify-center rounded-lg bg-gray-50 text-gray-400 dark:bg-gray-800/70 dark:text-gray-500"
					>
						<GlobeAlt className="size-5" strokeWidth="1.5" />
					</div>
					<div class="mt-3 text-sm font-medium text-gray-800 dark:text-gray-200">
						{$i18n.t('Preview a local web app')}
					</div>
					<div class="mt-1 max-w-sm text-xs leading-5 text-gray-400 dark:text-gray-500">
						{$i18n.t(
							'Start a web app in Terminal and make it listen on a local port. It will appear here automatically.'
						)}
					</div>
					<div class="mt-4 flex items-center gap-1">
						<button
							type="button"
							class="flex h-8 items-center gap-1.5 rounded-md bg-gray-100 px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
							disabled={!terminal?.id}
							on:mousedown|preventDefault|stopPropagation={openTerminal}
							on:click={(event) => onKeyboardClick(event, openTerminal)}
						>
							<TerminalIcon className="size-3.5" strokeWidth="1.7" />
							<span>{$i18n.t('Open terminal')}</span>
						</button>
						<button
							type="button"
							class="flex h-8 items-center gap-1.5 rounded-md px-3 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
							on:mousedown|preventDefault|stopPropagation={() => loadPorts()}
							on:click={(event) => onKeyboardClick(event, () => loadPorts())}
						>
							<ArrowPath className="size-3.5" />
							<span>{$i18n.t('Check again')}</span>
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}
