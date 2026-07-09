<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	export let pulseKey = 0;
	export let active = false;
	export let mode: 'start' | 'ambient' = 'start';

	let rootElement: HTMLDivElement;
	let prefersReducedMotion = false;
	let pointerX = 0;
	let pointerY = 0;
	let animationFrame: number | null = null;
	let pulseVisible = false;
	let pulseTimer: ReturnType<typeof setTimeout> | null = null;
	let mediaQuery: MediaQueryList | null = null;

	$: if (pulseKey > 0) {
		triggerPulse();
	}

	$: isStartMode = mode === 'start';

	const setPointerVars = () => {
		if (!rootElement || prefersReducedMotion || !isStartMode) {
			animationFrame = null;
			return;
		}

		rootElement.style.setProperty('--ai-pointer-x', `${pointerX.toFixed(3)}`);
		rootElement.style.setProperty('--ai-pointer-y', `${pointerY.toFixed(3)}`);
		animationFrame = null;
	};

	const handlePointerMove = (event: PointerEvent) => {
		if (!isStartMode || prefersReducedMotion || event.pointerType === 'touch') {
			return;
		}

		pointerX = event.clientX / window.innerWidth - 0.5;
		pointerY = event.clientY / window.innerHeight - 0.5;

		if (!animationFrame) {
			animationFrame = requestAnimationFrame(setPointerVars);
		}
	};

	const triggerPulse = () => {
		if (prefersReducedMotion || !isStartMode) {
			return;
		}

		pulseVisible = false;
		requestAnimationFrame(() => {
			pulseVisible = true;

			if (pulseTimer) {
				clearTimeout(pulseTimer);
			}
			pulseTimer = setTimeout(() => {
				pulseVisible = false;
			}, 900);
		});
	};

	onMount(() => {
		mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		const updateMotionPreference = () => {
			prefersReducedMotion = mediaQuery?.matches ?? false;
		};

		updateMotionPreference();
		mediaQuery.addEventListener('change', updateMotionPreference);

		if (isStartMode) {
			window.addEventListener('pointermove', handlePointerMove, { passive: true });
		}

		return () => {
			mediaQuery?.removeEventListener('change', updateMotionPreference);
			if (isStartMode) {
				window.removeEventListener('pointermove', handlePointerMove);
			}
		};
	});

	onDestroy(() => {
		if (animationFrame) {
			cancelAnimationFrame(animationFrame);
		}
		if (pulseTimer) {
			clearTimeout(pulseTimer);
		}
	});
</script>

<div
	bind:this={rootElement}
	class:ai-start-bg--active={active}
	class:ai-start-bg--ambient={mode === 'ambient'}
	class="ai-start-bg"
	aria-hidden="true"
>
	<div class="ai-start-bg__halo ai-start-bg__halo--blue"></div>
	<div class="ai-start-bg__halo ai-start-bg__halo--red"></div>
	<div class="ai-start-bg__halo ai-start-bg__halo--white"></div>
	<div class="ai-start-bg__mesh"></div>
	<div class="ai-start-bg__wave"></div>
	<div class:pulse-visible={pulseVisible} class="ai-start-bg__pulse"></div>
</div>

<style>
	.ai-start-bg {
		--ai-pointer-x: 0;
		--ai-pointer-y: 0;
		--ai-bg-opacity: 0.68;
		--ai-bg-blur: 36px;
		--ai-bg-saturate: 1;
		--ai-blue: 5 40 86;
		--ai-blue-soft: 51 102 204;
		--ai-red: 185 32 44;
		--ai-red-soft: 232 83 72;
		--ai-white: 255 255 255;
		position: absolute;
		left: 50%;
		top: 50%;
		z-index: -1;
		width: min(1380px, 118vw);
		height: min(700px, 76vh);
		min-height: 390px;
		pointer-events: none;
		opacity: var(--ai-bg-opacity);
		transform: translate3d(
			calc(-50% + (var(--ai-pointer-x) * 18px)),
			calc(-50% + (var(--ai-pointer-y) * 14px)),
			0
		);
		filter: saturate(var(--ai-bg-saturate));
		overflow: hidden;
		contain: paint;
		mask-image:
			linear-gradient(
				90deg,
				transparent 0 4%,
				rgb(0 0 0 / 0.1) 14%,
				#000 32% 68%,
				rgb(0 0 0 / 0.1) 86%,
				transparent 96%
			),
			radial-gradient(ellipse at 50% 50%, #000 0 31%, rgb(0 0 0 / 0.34) 55%, transparent 78%);
		mask-composite: intersect;
		-webkit-mask-image:
			linear-gradient(
				90deg,
				transparent 0 4%,
				rgb(0 0 0 / 0.1) 14%,
				#000 32% 68%,
				rgb(0 0 0 / 0.1) 86%,
				transparent 96%
			),
			radial-gradient(ellipse at 50% 50%, #000 0 31%, rgb(0 0 0 / 0.34) 55%, transparent 78%);
		-webkit-mask-composite: source-in;
		transition:
			opacity 420ms ease,
			transform 260ms ease-out;
	}

	:global(html.dark) .ai-start-bg {
		--ai-bg-opacity: 0.74;
		--ai-bg-blur: 40px;
		--ai-bg-saturate: 1.08;
		--ai-blue: 5 40 86;
		--ai-blue-soft: 51 102 204;
		--ai-red: 196 28 44;
		--ai-red-soft: 242 76 68;
		--ai-white: 245 248 255;
	}

	.ai-start-bg--active {
		--ai-bg-opacity: 0.76;
		--ai-bg-saturate: 1.04;
	}

	:global(html.dark) .ai-start-bg--active {
		--ai-bg-opacity: 0.84;
		--ai-bg-saturate: 1.16;
	}

	.ai-start-bg--ambient {
		--ai-bg-opacity: 0.13;
		--ai-bg-blur: 28px;
		--ai-bg-saturate: 0.86;

		top: 46%;
		z-index: 0;
		width: min(1180px, 106vw);
		height: min(620px, 74vh);
		min-height: 360px;
		mask-image:
			linear-gradient(
				90deg,
				transparent 0 6%,
				rgb(0 0 0 / 0.08) 18%,
				#000 36% 64%,
				rgb(0 0 0 / 0.08) 82%,
				transparent 94%
			),
			radial-gradient(ellipse at 50% 50%, #000 0 24%, rgb(0 0 0 / 0.22) 50%, transparent 76%);
		-webkit-mask-image:
			linear-gradient(
				90deg,
				transparent 0 6%,
				rgb(0 0 0 / 0.08) 18%,
				#000 36% 64%,
				rgb(0 0 0 / 0.08) 82%,
				transparent 94%
			),
			radial-gradient(ellipse at 50% 50%, #000 0 24%, rgb(0 0 0 / 0.22) 50%, transparent 76%);
	}

	:global(html.dark) .ai-start-bg--ambient {
		--ai-bg-opacity: 0.18;
		--ai-bg-blur: 30px;
		--ai-bg-saturate: 0.96;
	}

	.ai-start-bg--ambient.ai-start-bg--active {
		--ai-bg-opacity: 0.16;
		--ai-bg-saturate: 0.92;
	}

	:global(html.dark) .ai-start-bg--ambient.ai-start-bg--active {
		--ai-bg-opacity: 0.24;
		--ai-bg-saturate: 1.02;
	}

	.ai-start-bg--ambient .ai-start-bg__halo--white,
	.ai-start-bg--ambient .ai-start-bg__wave,
	.ai-start-bg--ambient .ai-start-bg__pulse {
		display: none;
	}

	.ai-start-bg__halo,
	.ai-start-bg__mesh,
	.ai-start-bg__wave,
	.ai-start-bg__pulse {
		position: absolute;
		inset: 0;
		will-change: transform, opacity;
		transform: translateZ(0);
	}

	.ai-start-bg__halo--blue {
		background:
			radial-gradient(ellipse at 25% 70%, rgb(var(--ai-blue-soft) / 0.3), transparent 31%),
			radial-gradient(ellipse at 60% 30%, rgb(var(--ai-blue) / 0.24), transparent 35%);
		filter: blur(var(--ai-bg-blur));
		animation: aiFieldBlue 10s ease-in-out infinite;
	}

	.ai-start-bg__halo--red {
		background:
			radial-gradient(ellipse at 66% 56%, rgb(var(--ai-red) / 0.56), transparent 42%),
			radial-gradient(ellipse at 42% 58%, rgb(var(--ai-red-soft) / 0.32), transparent 38%);
		filter: blur(var(--ai-bg-blur));
		mix-blend-mode: screen;
		animation: aiFieldRed 13s ease-in-out infinite;
	}

	.ai-start-bg__halo--white {
		background:
			radial-gradient(ellipse at 46% 40%, rgb(var(--ai-white) / 0.42), transparent 20%),
			radial-gradient(ellipse at 56% 55%, rgb(var(--ai-white) / 0.2), transparent 30%);
		filter: blur(calc(var(--ai-bg-blur) * 0.78));
		animation: aiFieldWhite 16s ease-in-out infinite;
	}

	.ai-start-bg__mesh {
		opacity: 0.72;
		background: conic-gradient(
			from 142deg at 50% 50%,
			transparent,
			rgb(var(--ai-white) / 0.18),
			transparent 30%,
			rgb(var(--ai-red-soft) / 0.22),
			transparent 68%
		);
		filter: blur(18px);
		animation: aiMeshShift 18s ease-in-out infinite;
	}

	.ai-start-bg__wave {
		inset: -8% -10%;
		opacity: 0.36;
		background:
			radial-gradient(ellipse at 42% 38%, rgb(var(--ai-white) / 0.22), transparent 30%),
			conic-gradient(
				from 118deg at 50% 52%,
				transparent 0 14%,
				rgb(var(--ai-blue-soft) / 0.1) 21%,
				transparent 34% 47%,
				rgb(var(--ai-red-soft) / 0.22) 58%,
				transparent 72% 100%
			);
		filter: blur(26px);
		mix-blend-mode: screen;
		animation: aiWaveBreathe 12s ease-in-out infinite;
	}

	.ai-start-bg__pulse {
		inset: 23% 19%;
		border: 1px solid rgb(var(--ai-white) / 0.35);
		border-radius: 999px;
		opacity: 0;
		transform: scale3d(0.42, 0.42, 1);
		filter: blur(5px);
	}

	.ai-start-bg__pulse.pulse-visible {
		animation: aiSubmitPulse 900ms ease-out;
	}

	@keyframes aiFieldBlue {
		0% {
			transform: translate3d(-12%, 7%, 0) scale3d(0.92, 1.08, 1) rotate(-6deg);
			opacity: 0.68;
		}
		35% {
			transform: translate3d(2%, -5%, 0) scale3d(1.14, 0.96, 1) rotate(3deg);
			opacity: 0.96;
		}
		70% {
			transform: translate3d(12%, -7%, 0) scale3d(1.06, 1.02, 1) rotate(7deg);
			opacity: 0.9;
		}
		100% {
			transform: translate3d(-12%, 7%, 0) scale3d(0.92, 1.08, 1) rotate(-6deg);
			opacity: 0.68;
		}
	}

	@keyframes aiFieldRed {
		0% {
			transform: translate3d(12%, -6%, 0) scale3d(1.08, 0.92, 1) rotate(5deg);
			opacity: 0.6;
		}
		40% {
			transform: translate3d(0, 5%, 0) scale3d(0.92, 1.16, 1) rotate(-3deg);
			opacity: 0.95;
		}
		75% {
			transform: translate3d(-13%, 7%, 0) scale3d(1.08, 1.04, 1) rotate(-8deg);
			opacity: 0.84;
		}
		100% {
			transform: translate3d(12%, -6%, 0) scale3d(1.08, 0.92, 1) rotate(5deg);
			opacity: 0.6;
		}
	}

	@keyframes aiFieldWhite {
		0% {
			transform: translate3d(-3%, -6%, 0) scale3d(0.92, 1.08, 1) rotate(-3deg);
			opacity: 0.3;
		}
		50% {
			transform: translate3d(4%, 2%, 0) scale3d(1.16, 0.93, 1) rotate(5deg);
			opacity: 0.68;
		}
		100% {
			transform: translate3d(-3%, -6%, 0) scale3d(0.92, 1.08, 1) rotate(-3deg);
			opacity: 0.3;
		}
	}

	@keyframes aiMeshShift {
		0% {
			transform: scale3d(0.94, 1.08, 1) rotate(-10deg);
			opacity: 0.34;
		}
		50% {
			transform: scale3d(1.12, 0.92, 1) rotate(6deg);
			opacity: 0.82;
		}
		100% {
			transform: scale3d(0.94, 1.08, 1) rotate(-10deg);
			opacity: 0.34;
		}
	}

	@keyframes aiWaveBreathe {
		0% {
			transform: translate3d(-7%, 5%, 0) scale3d(0.9, 1.08, 1) rotate(-10deg);
			opacity: 0.16;
		}
		45% {
			transform: translate3d(7%, -5%, 0) scale3d(1.12, 0.92, 1) rotate(6deg);
			opacity: 0.44;
		}
		100% {
			transform: translate3d(-7%, 5%, 0) scale3d(0.9, 1.08, 1) rotate(-10deg);
			opacity: 0.16;
		}
	}

	@keyframes aiSubmitPulse {
		0% {
			opacity: 0;
			transform: scale3d(0.42, 0.42, 1);
		}
		24% {
			opacity: 0.72;
		}
		100% {
			opacity: 0;
			transform: scale3d(1.35, 1.35, 1);
		}
	}

	@media (max-width: 768px) {
		.ai-start-bg {
			width: min(650px, 100vw);
			height: min(560px, 72vh);
			min-height: 360px;
			--ai-bg-blur: 28px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ai-start-bg,
		.ai-start-bg__halo,
		.ai-start-bg__mesh,
		.ai-start-bg__wave,
		.ai-start-bg__pulse {
			animation: none !important;
			transition: none !important;
		}

		.ai-start-bg {
			transform: translate3d(-50%, -50%, 0);
			opacity: 0.5;
		}
	}
</style>
