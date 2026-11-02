<script lang="ts">
	import { onMount } from 'svelte';
	import { theme } from '$lib/stores';

	export let pulseKey = 0;
	export let active = false;
	export let mode: 'start' | 'ambient' = 'start';

	let root: HTMLDivElement;
	let paused = true;

	onMount(() => {
		let visible = true;
		const updatePlayback = () => (paused = document.hidden || !visible);
		const observer = new IntersectionObserver(([entry]) => {
			visible = entry.isIntersecting;
			updatePlayback();
		});
		observer.observe(root);
		document.addEventListener('visibilitychange', updatePlayback);
		updatePlayback();
		return () => {
			observer.disconnect();
			document.removeEventListener('visibilitychange', updatePlayback);
		};
	});
</script>

<div
	bind:this={root}
	class="ai-start-bg"
	class:ai-start-bg--active={active}
	class:ai-start-bg--ambient={mode === 'ambient'}
	class:ai-start-bg--oled={$theme === 'oled-dark'}
	class:ai-start-bg--paused={paused}
	aria-hidden="true"
>
	<div class="ai-start-bg__layer"><div class="ai-start-bg__cloud"></div></div>
	<div class="ai-start-bg__layer ai-start-bg__pattern">
		<div class="ai-start-bg__cloud"></div>
	</div>
	{#key pulseKey}
		{#if pulseKey > 0}
			<div class="ai-start-bg__pulse"></div>
		{/if}
	{/key}
</div>

<style>
	.ai-start-bg {
		--welcome-opacity: 0.32;
		--cross-ink: rgb(5 40 86 / 0.075);
		--cross-light-opacity: 0.3;
		--cloud-move-amount: 1.3;
		--cloud-shape-amount: 0.3;
		--move-duration: 32s;
		--shape-duration: 47s;
		--limit-x: radial-gradient(ellipse 76% 80% at 50% 60%, black 12%, transparent 100%);
		--limit-y: linear-gradient(transparent, black 34%, black 74%, transparent);
		position: absolute;
		inset: 0;
		z-index: 0;
		overflow: hidden;
		pointer-events: none;
		transition: opacity 1.2s ease;
	}

	:global(.dark) .ai-start-bg {
		--welcome-opacity: 0.27;
		--cross-ink: rgb(226 235 255 / 0.065);
		--cross-light-opacity: 0.26;
	}

	:global(.dark) .ai-start-bg--oled {
		--welcome-opacity: 0.23;
	}

	.ai-start-bg__layer {
		position: absolute;
		inset: 0;
		container-type: size;
		-webkit-mask: var(--limit-y), var(--limit-x);
		-webkit-mask-composite: source-in;
		mask: var(--limit-y), var(--limit-x);
		mask-composite: intersect;
		transition: opacity 0.6s ease;
	}

	.ai-start-bg__cloud {
		position: absolute;
		inset: -7%;
		transform-origin: 50% 55%;
		opacity: var(--welcome-opacity);
		background:
			radial-gradient(ellipse 39% 58% at 30% 49%, #ff6d87 0%, transparent 100%),
			radial-gradient(ellipse 43% 46% at 44% 72%, #8060ef 0%, transparent 100%),
			radial-gradient(ellipse 47% 52% at 65% 64%, #479aff 0%, transparent 100%);
		animation:
			cloud-move-balanced var(--move-duration) ease-in-out infinite,
			cloud-shape var(--shape-duration) ease-in-out infinite;
	}

	.ai-start-bg__pattern {
		--cross: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='52' height='52'%3E%3Cpath d='M24.5 21h3v3.5h3.5v3h-3.5v3.5h-3v-3.5H21v-3h3.5z'/%3E%3C/svg%3E")
			0 0 / 52px 52px;
		--falloff: radial-gradient(ellipse 55% 48% at 50% 59%, black 22%, transparent 100%);
		/* Keep the texture out of the central reading and composing area. */
		--content-clearance: radial-gradient(ellipse 35% 42% at 50% 54%, transparent 75%, black 100%);
		background: var(--cross-ink);
		opacity: 0.75;
		-webkit-mask:
			var(--cross), var(--content-clearance), var(--falloff), var(--limit-y), var(--limit-x);
		-webkit-mask-composite: source-in, source-in, source-in, source-in;
		mask: var(--cross), var(--content-clearance), var(--falloff), var(--limit-y), var(--limit-x);
		mask-composite: intersect, intersect, intersect, intersect;
	}

	.ai-start-bg__pattern .ai-start-bg__cloud {
		opacity: var(--cross-light-opacity);
	}

	.ai-start-bg--active:not(.ai-start-bg--ambient) > .ai-start-bg__layer:first-child {
		opacity: 0.94;
	}

	.ai-start-bg__pulse {
		position: absolute;
		inset: 20%;
		opacity: 0;
		background: radial-gradient(ellipse, rgb(255 255 255 / 0.12), transparent 65%);
		animation: cloud-pulse 1.2s ease-out both;
	}

	.ai-start-bg--ambient {
		opacity: 0.22;
	}

	.ai-start-bg--ambient.ai-start-bg--active {
		opacity: 0.28;
	}

	.ai-start-bg--ambient .ai-start-bg__pattern,
	.ai-start-bg--ambient .ai-start-bg__pulse {
		display: none;
	}

	.ai-start-bg--paused .ai-start-bg__cloud,
	.ai-start-bg--paused .ai-start-bg__pattern,
	.ai-start-bg--paused .ai-start-bg__pulse {
		animation-play-state: paused;
	}

	@keyframes cloud-move-balanced {
		0%,
		100% {
			translate: 0 0;
		}
		20% {
			translate: calc(1.5cqw * var(--cloud-move-amount)) calc(-4cqh * var(--cloud-move-amount));
		}
		40% {
			translate: calc(3.75cqw * var(--cloud-move-amount)) calc(1cqh * var(--cloud-move-amount));
		}
		60% {
			translate: 0 calc(8cqh * var(--cloud-move-amount));
		}
		80% {
			translate: calc(-3.75cqw * var(--cloud-move-amount)) 0;
		}
	}

	@keyframes cloud-shape {
		0%,
		100% {
			scale: 1 1;
		}
		20% {
			scale: calc(1 + 0.25 * var(--cloud-shape-amount)) calc(1 - 0.3 * var(--cloud-shape-amount));
		}
		40% {
			scale: calc(1 - 0.15 * var(--cloud-shape-amount)) calc(1 + 0.1 * var(--cloud-shape-amount));
		}
		60% {
			scale: calc(1 + 0.2 * var(--cloud-shape-amount)) calc(1 - 0.4 * var(--cloud-shape-amount));
		}
		80% {
			scale: calc(1 - 0.05 * var(--cloud-shape-amount)) calc(1 - 0.15 * var(--cloud-shape-amount));
		}
	}

	@keyframes cloud-pulse {
		0% {
			opacity: 0;
			scale: 0.8;
		}
		30% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			scale: 1.3;
		}
	}

	@media (max-width: 640px) {
		.ai-start-bg {
			--cloud-move-amount: 0.8;
			--move-duration: 48s;
			--shape-duration: 70s;
		}
		.ai-start-bg__pattern {
			opacity: 0.45;
		}
		.ai-start-bg__pattern .ai-start-bg__cloud {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ai-start-bg,
		.ai-start-bg__layer {
			transition: none;
		}
		.ai-start-bg__cloud,
		.ai-start-bg__pattern,
		.ai-start-bg__pulse {
			animation: none;
		}
	}
</style>
