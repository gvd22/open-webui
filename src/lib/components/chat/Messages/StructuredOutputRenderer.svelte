<script lang="ts">
	import Collapsible from '$lib/components/common/Collapsible.svelte';
	import ToolCallDisplay from '$lib/components/common/ToolCallDisplay.svelte';
	import TerminalOutputFile from './TerminalOutputFile.svelte';
	import { resolveChatMessageToolCall } from '$lib/apis/chats';
	import { settings, socket } from '$lib/stores';
	import { toast } from 'svelte-sonner';

	import Markdown from './Markdown.svelte';
	import CanvasActivity from './CanvasActivity.svelte';
	import CanvasPreview from './CanvasPreview.svelte';
	import WebPreviewCard from './WebPreviewCard.svelte';
	import WebPreviewActivity from './WebPreviewActivity.svelte';
	import ConsecutiveDetailsGroup from './Markdown/ConsecutiveDetailsGroup.svelte';
	import {
		buildOutputDisplayItems,
		dedupeCanvasDisplayItems,
		dedupeWebPreviewDisplayItems,
		type OutputDetailToken,
		type OutputDisplayItem,
		type OutputItem
	} from './structuredOutput';

	export let id = '';
	export let chatId = '';
	export let messageId = '';
	export let output: OutputItem[] = [];
	export let done = true;
	export let model = null;
	export let save = false;
	export let preview = false;
	export let compactPreview = false;
	export let renderMarkdown = true;
	export let editCodeBlock = true;
	export let topPadding = false;
	export let sourceIds: string[] = [];
	export let previousCanvasIds: string[] = [];
	export let previousWebPreviewIds: string[] = [];
	export let formatMessageContent: (content: string) => string = (content) => content;
	export let onSave: any = () => {};
	export let onSourceClick: any = () => {};
	export let onTaskClick: any = () => {};
	export let onUpdate: any = () => {};
	export let onPreview: any = () => {};
	export let onToolCallResolved: any = () => {};

	const getDetailTitle = (detailToken: OutputDetailToken): any => detailToken.summary;
	const getDetailAttributes = (detailToken: OutputDetailToken): any => detailToken.attributes;
	let resolvingCallId = '';

	const resolveToolCall = async (callId: string, approved: boolean) => {
		if (!chatId || !messageId || !callId || resolvingCallId) {
			return;
		}

		resolvingCallId = callId;
		try {
			const res = await resolveChatMessageToolCall(
				localStorage.token,
				chatId,
				messageId,
				callId,
				approved ? 'approve' : 'reject',
				{ session_id: $socket?.id }
			);
			onToolCallResolved(res);
		} catch (err) {
			toast.error(String(err));
		} finally {
			resolvingCallId = '';
		}
	};

	$: detailButtonClassName = `py-0.5 ${
		compactPreview ? 'text-xs' : 'text-[0.9375rem]'
	} text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition`;

	$: displayItems = dedupeWebPreviewDisplayItems(
		dedupeCanvasDisplayItems(buildOutputDisplayItems(output) as OutputDisplayItem[], previousCanvasIds),
		previousWebPreviewIds
	);
</script>

{#each displayItems as displayItem (displayItem.id)}
	{#if displayItem.type === 'message'}
		{#if renderMarkdown}
			<div class="markdown-prose">
				<Markdown
					id={`${id}-${displayItem.id}`}
					{chatId}
					{messageId}
					content={formatMessageContent(displayItem.text)}
					{model}
					{save}
					{preview}
					{compactPreview}
					{done}
					{editCodeBlock}
					{topPadding}
					{sourceIds}
					{onSourceClick}
					{onTaskClick}
					{onToolCallResolved}
					{onSave}
					{onUpdate}
					{onPreview}
				/>
			</div>
		{:else}
			<div class="whitespace-pre-wrap text-[0.9375rem]">{displayItem.text}</div>
		{/if}
	{:else if displayItem.type === 'canvas'}
		<CanvasPreview
			title={displayItem.artifact.title}
			content={displayItem.artifact.content}
				canvasId={displayItem.artifact.canvasId}
			noteId={displayItem.artifact.noteId ?? ''}
			{model}
			{save}
			{preview}
			{compactPreview}
			{done}
			{editCodeBlock}
			{topPadding}
			{sourceIds}
			{onSourceClick}
			{onTaskClick}
			{onSave}
			{onUpdate}
			{onPreview}
		/>
	{:else if displayItem.type === 'canvas_activity'}
		<CanvasActivity
			name={displayItem.name}
			done={displayItem.done}
			artifact={displayItem.artifact}
			error={displayItem.error ?? ''}
		/>
	{:else if displayItem.type === 'web_preview'}
		<WebPreviewCard artifact={displayItem.artifact} />
	{:else if displayItem.type === 'web_preview_activity'}
		<WebPreviewActivity
			name={displayItem.name}
			done={displayItem.done}
			artifact={displayItem.artifact}
			error={displayItem.error ?? ''}
		/>
	{:else if displayItem.type === 'detail_group'}
		<ConsecutiveDetailsGroup
			id={`${id}-${displayItem.id}`}
			tokens={displayItem.tokens}
			messageDone={done}
			{compactPreview}
			resolvable={!!chatId && !!messageId && save}
			{resolvingCallId}
			onResolve={resolveToolCall}
		>
			<div slot="content">
				{#each displayItem.tokens as detailToken, detailIndex}
					{#if detailToken.attributes?.type === 'tool_calls'}
						<ToolCallDisplay
							id={`${id}-${displayItem.id}-${detailIndex}-tool-call`}
							attributes={detailToken.attributes}
							resultContent={detailToken.text}
							grouped={true}
							resolvable={!!chatId && !!messageId && save}
							resolving={resolvingCallId === detailToken.attributes?.id}
							onResolve={(approved) => resolveToolCall(detailToken.attributes?.id ?? '', approved)}
							open={$settings?.expandDetails ?? false}
							className="w-full"
							buttonClassName={detailButtonClassName}
						/>
					{:else if detailToken.text?.length > 0}
						<Collapsible
							title={getDetailTitle(detailToken)}
							open={$settings?.expandDetails ?? false}
							attributes={getDetailAttributes(detailToken)}
							messageDone={done}
							className="w-full"
							buttonClassName={detailButtonClassName}
						>
							<div class="mb-1.5" slot="content">
								<div class="markdown-prose">
									<Markdown
										id={`${id}-${displayItem.id}-${detailIndex}-detail`}
										{chatId}
										{messageId}
										content={detailToken.text}
										{done}
										{save}
										{preview}
										{compactPreview}
										{editCodeBlock}
										{onToolCallResolved}
									/>
								</div>
							</div>
						</Collapsible>
					{:else}
						<Collapsible
							title={getDetailTitle(detailToken)}
							open={false}
							disabled={true}
							attributes={getDetailAttributes(detailToken)}
							messageDone={done}
							className="w-full"
							buttonClassName={detailButtonClassName}
						/>
					{/if}
				{/each}
			</div>
		</ConsecutiveDetailsGroup>
	{:else if displayItem.type === 'file'}
		{#if displayItem.item?.displayed || $settings?.terminalFileDisplay === 'inline'}
			<TerminalOutputFile item={displayItem.item} {chatId} />
		{/if}
	{:else}
		{@const detailToken = displayItem.token}
		{#if detailToken.attributes?.type === 'tool_calls'}
			<ToolCallDisplay
				id={`${id}-${displayItem.id}-tool-call`}
				attributes={detailToken.attributes}
				resultContent={detailToken.text}
				resolvable={!!chatId && !!messageId && save}
				resolving={resolvingCallId === detailToken.attributes?.id}
				onResolve={(approved) => resolveToolCall(detailToken.attributes?.id ?? '', approved)}
				open={$settings?.expandDetails ?? false}
				className="w-full space-y-2"
				buttonClassName={detailButtonClassName}
			/>
		{:else if detailToken.text?.length > 0}
			<Collapsible
				title={getDetailTitle(detailToken)}
				open={$settings?.expandDetails ?? false}
				attributes={getDetailAttributes(detailToken)}
				messageDone={done}
				className="w-full space-y-2"
				buttonClassName={detailButtonClassName}
			>
				<div class="mb-1.5" slot="content">
					<div class="markdown-prose">
						<Markdown
							id={`${id}-${displayItem.id}-detail`}
							{chatId}
							{messageId}
							content={detailToken.text}
							{done}
							{save}
							{preview}
							{compactPreview}
							{editCodeBlock}
							{onToolCallResolved}
						/>
					</div>
				</div>
			</Collapsible>
		{:else}
			<Collapsible
				title={getDetailTitle(detailToken)}
				open={false}
				disabled={true}
				attributes={getDetailAttributes(detailToken)}
				messageDone={done}
				className="w-full space-y-2"
				buttonClassName={detailButtonClassName}
			/>
		{/if}
	{/if}
{/each}
