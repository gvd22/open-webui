<script lang="ts">
	import { getContext, onDestroy, onMount } from 'svelte';
	import { getPortProxyUrl } from '$lib/apis/terminal';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import { getPortPreviewFrameBlockReason } from './portPreviewSecurity';

	const i18n = getContext('i18n');

	export let baseUrl: string;
	export let port: number;
	export let path: string = '';
	export let onClose: () => void = () => {};
	export let overlay = false;

	let urlInput: string = '';
	let iframeKey = 0;
	let isLoading = false;
	let previewReady = false;
	let previewError = '';
	let previewErrorHelp = '';
	let previewRequest: AbortController | null = null;

	// ── Navigation history ──────────────────────────────────────────────
	let history: string[] = [path];
	let historyIndex = 0;

	$: canGoBack = historyIndex > 0;
	$: canGoForward = historyIndex < history.length - 1;

	const pushHistory = (newPath: string) => {
		if (historyIndex < history.length - 1) {
			history = history.slice(0, historyIndex + 1);
		}
		history = [...history, newPath];
		historyIndex = history.length - 1;
	};

	const goBack = () => {
		if (!canGoBack) return;
		historyIndex -= 1;
		path = history[historyIndex];
		syncUrlBar();
		void loadPreview();
	};

	const goForward = () => {
		if (!canGoForward) return;
		historyIndex += 1;
		path = history[historyIndex];
		syncUrlBar();
		void loadPreview();
	};

	// ── URLs ─────────────────────────────────────────────────────────────
	$: proxyUrl = getPortProxyUrl(baseUrl, port, path);

	const makeDisplayUrl = (p: string) => `localhost:${port}${p ? '/' + p : ''}`;
	const syncUrlBar = () => {
		urlInput = makeDisplayUrl(path);
	};
	urlInput = makeDisplayUrl(path);

	const loadPreview = async () => {
		previewRequest?.abort();
		const request = new AbortController();
		previewRequest = request;
		const requestedUrl = proxyUrl;
		isLoading = true;
		previewReady = false;
		previewError = '';
		previewErrorHelp = '';
		let timedOut = false;
		const timeout = window.setTimeout(() => {
			timedOut = true;
			request.abort();
		}, 12_000);

		try {
			// The iframe cannot add a bearer header. Verify the exact cookie-authenticated
			// navigation it will perform before displaying an otherwise opaque error page.
			const response = await fetch(requestedUrl, {
				credentials: 'include',
				cache: 'no-store',
				signal: request.signal
			});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const frameBlockReason = getPortPreviewFrameBlockReason(
				response.headers,
				requestedUrl,
				window.location.origin
			);
			if (frameBlockReason) {
				previewError = $i18n.t('This local app does not allow embedded previews.');
				previewErrorHelp = $i18n.t('Open it in a new tab to continue.');
				return;
			}
			if (request.signal.aborted || requestedUrl !== proxyUrl) return;
			previewReady = true;
			iframeKey += 1;
		} catch (error) {
			if (request.signal.aborted && !timedOut) return;
			previewError = $i18n.t(
				'The local app could not be opened through the authenticated workspace proxy.'
			);
			previewErrorHelp = timedOut
				? $i18n.t('The Terminal service did not respond in time.')
				: $i18n.t('Check your session and the Terminal service, then try again.');
		} finally {
			window.clearTimeout(timeout);
			if (previewRequest === request) {
				previewRequest = null;
				if (!previewReady) isLoading = false;
			}
		}
	};

	const refresh = () => void loadPreview();

	const openExternal = () => {
		window.open(proxyUrl, '_blank', 'noopener,noreferrer');
	};

	const navigateUrl = () => {
		const localhostPrefix = `localhost:${port}`;
		const stripped = urlInput.trim();
		let newPath = '';

		if (stripped.startsWith(localhostPrefix)) {
			newPath = stripped.slice(localhostPrefix.length).replace(/^\//, '');
		} else if (stripped.startsWith('/') || !stripped.includes(':')) {
			newPath = stripped.replace(/^\//, '');
		}

		if (newPath !== path) {
			path = newPath;
			pushHistory(path);
		}
		syncUrlBar();
		void loadPreview();
	};

	const onIframeLoad = () => {
		isLoading = false;
	};

	onMount(() => void loadPreview());
	onDestroy(() => previewRequest?.abort());
</script>

<div class="flex flex-col h-full min-h-0">
	<!-- Browser chrome -->
	<div
		class="flex h-11 shrink-0 items-center gap-2 border-b border-gray-100 bg-white px-2.5 dark:border-gray-800 dark:bg-gray-850"
	>
		<div class="flex shrink-0 items-center gap-0.5">
			<!-- Back -->
			<Tooltip content={$i18n.t('Back')}>
				<button
					class="flex size-7 shrink-0 items-center justify-center rounded-md transition {canGoBack
						? 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
						: 'cursor-default text-gray-200 dark:text-gray-700'}"
					on:click={goBack}
					disabled={!canGoBack}
					aria-label={$i18n.t('Back')}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="size-3.5"
					>
						<path
							fill-rule="evenodd"
							d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z"
							clip-rule="evenodd"
						/>
					</svg>
				</button>
			</Tooltip>

			<!-- Forward -->
			<Tooltip content={$i18n.t('Forward')}>
				<button
					class="flex size-7 shrink-0 items-center justify-center rounded-md transition {canGoForward
						? 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
						: 'cursor-default text-gray-200 dark:text-gray-700'}"
					on:click={goForward}
					disabled={!canGoForward}
					aria-label={$i18n.t('Forward')}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="size-3.5"
					>
						<path
							fill-rule="evenodd"
							d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 1 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z"
							clip-rule="evenodd"
						/>
					</svg>
				</button>
			</Tooltip>
		</div>

		<!-- URL bar -->
		<form class="h-8 min-w-0 flex-1" on:submit|preventDefault={navigateUrl}>
			<input
				type="text"
				bind:value={urlInput}
				class="h-8 w-full rounded-md bg-gray-50 px-2.5 font-mono text-xs text-gray-600 outline-none transition placeholder:text-gray-300 focus:bg-gray-100 focus:ring-1 focus:ring-gray-300 dark:bg-gray-800/60 dark:text-gray-300 dark:placeholder:text-gray-600 dark:focus:bg-gray-800 dark:focus:ring-gray-700"
				placeholder="localhost:{port}"
			/>
		</form>

		<div
			class="flex shrink-0 items-center gap-0.5 border-l border-gray-100 pl-2 dark:border-gray-800"
		>
			<!-- Refresh -->
			<Tooltip content={$i18n.t('Refresh')}>
				<button
					class="flex size-7 shrink-0 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
					on:click={refresh}
					aria-label={$i18n.t('Refresh')}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="size-3.5"
						class:animate-spin={isLoading}
					>
						<path
							fill-rule="evenodd"
							d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.451a.75.75 0 0 0 0-1.5H4.5a.75.75 0 0 0-.75.75v3.75a.75.75 0 0 0 1.5 0v-2.127l.13.13a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm-10.624-2.85a5.5 5.5 0 0 1 9.201-2.465l.312.31H11.75a.75.75 0 0 0 0 1.5h3.75a.75.75 0 0 0 .75-.75V3.42a.75.75 0 0 0-1.5 0v2.126l-.13-.129A7 7 0 0 0 3.239 8.555a.75.75 0 0 0 1.449.39Z"
							clip-rule="evenodd"
						/>
					</svg>
				</button>
			</Tooltip>

			<!-- Open in new tab -->
			<Tooltip content={$i18n.t('Open in new tab')}>
				<button
					class="flex size-7 shrink-0 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
					on:click={openExternal}
					aria-label={$i18n.t('Open in new tab')}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="size-3.5"
					>
						<path
							fill-rule="evenodd"
							d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Zm7.5-3.5a.75.75 0 0 0 0 1.5h2.69l-4.72 4.72a.75.75 0 0 0 1.06 1.06l4.72-4.72v2.69a.75.75 0 0 0 1.5 0v-5.25a.75.75 0 0 0-.75-.75h-5.25Z"
							clip-rule="evenodd"
						/>
					</svg>
				</button>
			</Tooltip>

			<!-- Close -->
			<Tooltip content={$i18n.t('Close')}>
				<button
					class="flex size-7 shrink-0 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
					on:click={onClose}
					aria-label={$i18n.t('Close')}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="size-3.5"
					>
						<path
							d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"
						/>
					</svg>
				</button>
			</Tooltip>
		</div>
	</div>

	<!-- Loading bar -->
	{#if isLoading}
		<div class="h-0.5 bg-gray-100 dark:bg-gray-800 shrink-0 overflow-hidden">
			<div class="h-full bg-blue-500 animate-loading-bar rounded-full"></div>
		</div>
	{/if}
	{#if previewReady}
		<div
			class="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-[11px] text-gray-500 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-400"
			role="note"
		>
			<span class="min-w-0 truncate">
				{$i18n.t(
					'Isolated preview. Apps that require signed-in API requests must be opened in a new tab.'
				)}
			</span>
			<button
				type="button"
				class="shrink-0 font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
				on:click={openExternal}
			>
				{$i18n.t('Open full app')}
			</button>
		</div>
	{/if}

	<!-- Iframe -->
	<div class="flex-1 min-h-0 relative">
		{#if overlay}
			<div class="absolute inset-0 z-10"></div>
		{/if}
		{#if previewError}
			<div class="flex h-full min-h-64 flex-col items-center justify-center px-8 text-center">
				<div class="text-sm font-medium text-gray-800 dark:text-gray-200">{previewError}</div>
				<div class="mt-1 max-w-sm text-xs leading-5 text-gray-400 dark:text-gray-500">
					{previewErrorHelp}
				</div>
				<div class="mt-4 flex items-center gap-2">
					<button
						type="button"
						class="h-8 rounded-md bg-gray-100 px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
						on:click={refresh}
					>
						{$i18n.t('Try again')}
					</button>
					<button
						type="button"
						class="h-8 rounded-md px-3 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
						on:click={openExternal}
					>
						{$i18n.t('Open in new tab')}
					</button>
				</div>
			</div>
		{:else if previewReady}
			{#key iframeKey}
				<iframe
					src={proxyUrl}
					title="Port {port} preview"
					class="w-full h-full border-0 bg-white"
					sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads"
					referrerpolicy="no-referrer"
					on:load={onIframeLoad}
				></iframe>
			{/key}
		{/if}
	</div>
</div>

<style>
	@keyframes loading-bar {
		0% {
			width: 0;
			margin-left: 0;
		}
		50% {
			width: 60%;
			margin-left: 20%;
		}
		100% {
			width: 0;
			margin-left: 100%;
		}
	}
	.animate-loading-bar {
		animation: loading-bar 1.5s ease-in-out infinite;
	}
</style>
