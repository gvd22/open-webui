<script lang="ts">
	import { getContext, afterUpdate } from 'svelte';
	import Spinner from '../../common/Spinner.svelte';
	import Tooltip from '../../common/Tooltip.svelte';
	import Dropdown from '$lib/components/common/Dropdown.svelte';
	import DropdownMenu from '$lib/components/common/DropdownMenu.svelte';
	import Icon from './Icon.svelte';

	const i18n: any = getContext('i18n');

	export let breadcrumbs: { label: string; path: string }[] = [];
	export let selectedFile: string | null = null;
	export let loading = false;
	export let writable = true;

	export let onNavigate: (path: string) => void = () => {};
	export let onRefresh: () => void = () => {};
	export let onNewFolder: () => void = () => {};
	export let onNewFile: () => void = () => {};
	export let onUploadFiles: (files: File[]) => void = () => {};
	export let onDownloadDir: () => void = () => {};
	export let onMove: (sources: string[], destFolder: string) => void | Promise<void> = () => {};
	export let allowDirectoryDownload = true;
	export let allowMove = true;
	export let showHidden = false;
	export let onToggleHidden: () => void = () => {};

	// Sort controls
	export let sortBy: 'name' | 'size' | 'date' = 'name';
	export let sortAsc: boolean = true;
	export let onSort: (mode: 'name' | 'size' | 'date') => void = () => {};

	// Back / forward navigation
	export let canGoBack = false;
	export let canGoForward = false;
	export let onGoBack: () => void = () => {};
	export let onGoForward: () => void = () => {};

	let dragOverCrumb: number | null = null;
	let sortMenuOpen = false;
	let actionsMenuOpen = false;

	let uploadInput: HTMLInputElement;
	let breadcrumbEl: HTMLDivElement;
	let visibleBreadcrumbs: { label: string; path: string }[] = [];
	$: {
		visibleBreadcrumbs =
			breadcrumbs[0]?.label.toLowerCase() === 'workspace'
				? [{ ...breadcrumbs[0], label: $i18n.t('Files') }, ...breadcrumbs.slice(1)]
				: breadcrumbs;
		if (visibleBreadcrumbs[0]?.label === '/') {
			visibleBreadcrumbs = [
				{ ...visibleBreadcrumbs[0], label: $i18n.t('Home') },
				...visibleBreadcrumbs.slice(1)
			];
		}
	}

	// Scroll breadcrumb to the end after every DOM update
	afterUpdate(() => {
		if (breadcrumbEl) breadcrumbEl.scrollLeft = breadcrumbEl.scrollWidth;
	});
</script>

<div
	class="flex h-9 shrink-0 items-center gap-2 border-b border-gray-100 bg-white px-2.5 dark:border-gray-800 dark:bg-gray-850"
>
	<div class="flex shrink-0 items-center gap-0.5 px-1">
		<!-- Back -->
		<Tooltip content={$i18n.t('Back')}>
			<button
				class="shrink-0 flex size-7 items-center justify-center rounded-md transition-colors duration-100 {canGoBack
					? 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
					: 'text-gray-200 dark:text-gray-700 cursor-default'}"
				on:click={onGoBack}
				disabled={!canGoBack}
				aria-label={$i18n.t('Back')}
			>
				<Icon name="chevron-left" size={14} strokeWidth={1.5} />
			</button>
		</Tooltip>

		<!-- Forward -->
		<Tooltip content={$i18n.t('Forward')}>
			<button
				class="shrink-0 flex size-7 items-center justify-center rounded-md transition-colors duration-100 {canGoForward
					? 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
					: 'text-gray-200 dark:text-gray-700 cursor-default'}"
				on:click={onGoForward}
				disabled={!canGoForward}
				aria-label={$i18n.t('Forward')}
			>
				<Icon name="chevron-right" size={14} strokeWidth={1.5} />
			</button>
		</Tooltip>
	</div>

	<div
		bind:this={breadcrumbEl}
		class="scrollbar-none flex h-6 min-w-0 flex-1 items-center overflow-x-auto rounded-md bg-gray-50 px-2 dark:bg-gray-800/60"
	>
		<Icon name="folder" size={14} class="mr-1.5 shrink-0 text-gray-400 dark:text-gray-500" />
		{#each visibleBreadcrumbs as crumb, i}
			{#if i > 0}
				<span class="mx-0.5 shrink-0 select-none text-xs text-gray-300 dark:text-gray-600">/</span>
			{/if}
			<button
				class="shrink-0 rounded px-1 py-0.5 text-xs transition hover:bg-gray-200/60 dark:hover:bg-gray-700/70
					{!selectedFile && i === visibleBreadcrumbs.length - 1
					? 'text-gray-700 dark:text-gray-300'
					: 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400'}
					{dragOverCrumb === i
					? 'bg-blue-50 dark:bg-blue-900/30 ring-1 ring-blue-400 dark:ring-blue-500'
					: ''}"
				on:click={() => onNavigate(crumb.path)}
				on:dragover={(e) => {
					if (!writable || !allowMove) return;
					if (!e.dataTransfer?.types.includes('application/x-terminal-file-move')) return;
					e.preventDefault();
					e.stopPropagation();
					dragOverCrumb = i;
				}}
				on:dragleave={() => {
					if (dragOverCrumb === i) dragOverCrumb = null;
				}}
				on:drop={async (e) => {
					if (!writable || !allowMove) return;
					const raw = e.dataTransfer?.getData('application/x-terminal-file-move');
					if (!raw) return;
					e.preventDefault();
					e.stopPropagation();
					dragOverCrumb = null;
					try {
						const data = JSON.parse(raw);
						const paths = (data.paths || (data.path ? [data.path] : [])) as string[];
						await onMove(paths, crumb.path);
					} catch {}
				}}
			>
				{crumb.label}
			</button>
		{/each}
		{#if selectedFile}
			<span class="mx-0.5 shrink-0 select-none text-xs text-gray-300 dark:text-gray-600">/</span>
			<span class="shrink-0 px-1.5 py-0.5 text-xs text-gray-700 dark:text-gray-300">
				{selectedFile.split('/').pop()}
			</span>
		{/if}
	</div>
	{#if !writable}
		<span class="text-[0.625rem] text-gray-400 dark:text-gray-500 shrink-0"> Read-only </span>
	{/if}

	<Tooltip content={$i18n.t('Refresh')}>
		<button
			class="shrink-0 flex size-7 items-center justify-center rounded-md transition-colors duration-100 text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300"
			on:click={onRefresh}
			aria-label={$i18n.t('Refresh')}
		>
			<Icon name="refresh" size={14} strokeWidth={1.4} class={loading ? 'animate-spin' : ''} />
		</button>
	</Tooltip>

	{#if !selectedFile}
		<Dropdown bind:show={sortMenuOpen} align="end" sideOffset={4}>
			<Tooltip content={$i18n.t('Sort')}>
				<button
					class="shrink-0 flex size-7 items-center justify-center rounded-md transition-colors duration-100 text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300"
					aria-label={$i18n.t('Sort')}
				>
					<Icon name="sort" size={14} strokeWidth={1.4} />
				</button>
			</Tooltip>

			<div slot="content">
				<DropdownMenu className="min-w-[9.375rem] z-[9999999]">
					<button
						type="button"
						class="select-none flex h-7 w-full items-center gap-2 rounded-lg px-2 text-xs hover:bg-gray-50/40 dark:hover:bg-white/4 transition"
						on:click={() => {
							onSort('name');
							sortMenuOpen = false;
						}}
					>
						<span class="flex-1 text-left">{$i18n.t('Name')}</span>
						{#if sortBy === 'name'}
							<Icon
								name="chevron-up"
								size={12}
								strokeWidth={1.5}
								class="text-gray-500 dark:text-gray-400 transition-transform {sortAsc
									? ''
									: 'rotate-180'}"
							/>
						{/if}
					</button>
					<button
						type="button"
						class="select-none flex h-7 w-full items-center gap-2 rounded-lg px-2 text-xs hover:bg-gray-50/40 dark:hover:bg-white/4 transition"
						on:click={() => {
							onSort('size');
							sortMenuOpen = false;
						}}
					>
						<span class="flex-1 text-left">{$i18n.t('Size')}</span>
						{#if sortBy === 'size'}
							<Icon
								name="chevron-up"
								size={12}
								strokeWidth={1.5}
								class="text-gray-500 dark:text-gray-400 transition-transform {sortAsc
									? ''
									: 'rotate-180'}"
							/>
						{/if}
					</button>
					<button
						type="button"
						class="select-none flex h-7 w-full items-center gap-2 rounded-lg px-2 text-xs hover:bg-gray-50/40 dark:hover:bg-white/4 transition"
						on:click={() => {
							onSort('date');
							sortMenuOpen = false;
						}}
					>
						<span class="flex-1 text-left">{$i18n.t('Date Modified')}</span>
						{#if sortBy === 'date'}
							<Icon
								name="chevron-up"
								size={12}
								strokeWidth={1.5}
								class="text-gray-500 dark:text-gray-400 transition-transform {sortAsc
									? ''
									: 'rotate-180'}"
							/>
						{/if}
					</button>
				</DropdownMenu>
			</div>
		</Dropdown>
		<Dropdown bind:show={actionsMenuOpen} align="end" sideOffset={4}>
			<Tooltip content={$i18n.t('Actions')}>
				<button
					class="shrink-0 flex size-7 items-center justify-center rounded-md transition-colors duration-100 text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300"
					aria-label={$i18n.t('Actions')}
				>
					<Icon name="three-dots" size={14} strokeWidth={1.4} />
				</button>
			</Tooltip>

			<div slot="content">
				<DropdownMenu className="min-w-[9.375rem] z-[9999999]">
					<button
						type="button"
						class="select-none flex h-7 w-full items-center gap-2 rounded-lg px-2 text-xs hover:bg-gray-50/40 dark:hover:bg-white/4 transition disabled:opacity-40 disabled:hover:bg-transparent"
						on:click={() => {
							onNewFolder();
							actionsMenuOpen = false;
						}}
						disabled={!writable}
					>
						<Icon name="folder" size={12} strokeWidth={1.4} />
						<span>{$i18n.t('New Folder')}</span>
					</button>
					<button
						type="button"
						class="select-none flex h-7 w-full items-center gap-2 rounded-lg px-2 text-xs hover:bg-gray-50/40 dark:hover:bg-white/4 transition disabled:opacity-40 disabled:hover:bg-transparent"
						on:click={() => {
							onNewFile();
							actionsMenuOpen = false;
						}}
						disabled={!writable}
					>
						<Icon name="empty-page" size={12} strokeWidth={1.4} />
						<span>{$i18n.t('New File')}</span>
					</button>
					<button
						type="button"
						class="select-none flex h-7 w-full items-center gap-2 rounded-lg px-2 text-xs hover:bg-gray-50/40 dark:hover:bg-white/4 transition disabled:opacity-40 disabled:hover:bg-transparent"
						on:click={() => {
							actionsMenuOpen = false;
							uploadInput?.click();
						}}
						disabled={!writable}
					>
						<Icon name="upload" size={12} strokeWidth={1.4} />
						<span>{$i18n.t('Upload')}</span>
					</button>
					{#if allowDirectoryDownload}
						<button
							type="button"
							class="select-none flex h-7 w-full items-center gap-2 rounded-lg px-2 text-xs hover:bg-gray-50/40 dark:hover:bg-white/4 transition"
							on:click={() => {
								onDownloadDir();
								actionsMenuOpen = false;
							}}
						>
							<Icon name="download" size={12} strokeWidth={1.4} />
							<span>{$i18n.t('Download')}</span>
						</button>
					{/if}
					<button
						type="button"
						class="select-none flex h-7 w-full items-center gap-2 rounded-lg px-2 text-xs hover:bg-gray-50/40 dark:hover:bg-white/4 transition"
						on:click={() => {
							onToggleHidden();
							actionsMenuOpen = false;
						}}
					>
						<Icon name="eye" size={12} strokeWidth={1.4} />
						<span>{showHidden ? $i18n.t('Hide Hidden Files') : $i18n.t('Show Hidden Files')}</span>
					</button>
				</DropdownMenu>
			</div>
		</Dropdown>
		<input
			bind:this={uploadInput}
			type="file"
			multiple
			hidden
			on:change={async () => {
				if (!writable || !uploadInput?.files?.length) return;
				onUploadFiles(Array.from(uploadInput.files));
				uploadInput.value = '';
			}}
		/>
	{:else}
		<slot />
	{/if}
</div>
