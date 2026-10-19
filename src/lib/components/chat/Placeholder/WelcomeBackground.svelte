<script lang="ts" context="module">
	// When the colour fade-in started; a remount right after (new chat ↔ folder routes
	// remount the page) continues the running fade instead of starting from zero.
	let fadeStartedAt = -Infinity;
	const FADE_MS = 1500;
	// last cut-out image, so a remount starts with the cut-outs already in place
	let lastHolesUrl = '';
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import WelcomeBackgroundDebug from './WelcomeBackgroundDebug.svelte';

	// AI-2390: decorative gradient cloud behind the welcome screen. A warm (red) and a
	// cool (blue) side slowly swap places around the content; each blob also
	// wanders on its own slow, irregular path, so the cloud keeps changing shape.
	// Pure CSS, transform-only animation, frozen under prefers-reduced-motion. The
	// colours fade in slowly when the screen opens.

	const sinceFade = performance.now() - fadeStartedAt;
	const fadeDelay = sinceFade < FADE_MS ? -sinceFade : 0;
	if (!fadeDelay) fadeStartedAt = performance.now();
	// leaving into a project: short fade-out instead of vanishing at once. Local on
	// purpose: a |global outro also ran on route changes and kept the whole old page
	// in the DOM next to the new one until it finished.
	const fadeOutMs = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250;

	// Tie the animation to the wall clock instead of the mount time: when the page
	// remounts (e.g. new chat ↔ folder route) the cloud continues where it was instead
	// of jumping back to its start. Modulo a day keeps the delay small enough for
	// float precision in CSS time values.
	const clockOffset = `${-((Date.now() / 1000) % 86400)}s`;

	// The crosses may come close to the content but never get cut by it.
	// Every element we must not draw under (greeting, input, "Suggested" label, each
	// card) gets its own soft cut-out: we measure the elements and draw them as
	// blurred rounded boxes into an SVG that is subtracted from the cross pattern.
	// Re-measured when the layout or the content changes.
	const AVOID = '#welcome-greeting, #message-input-container, [data-welcome-avoid]';
	let root: HTMLElement;
	let holesUrl = lastHolesUrl;
	// A freshly swapped-in mask image is not decoded yet and would leave the crosses
	// uncut for a frame (they flashed under the cards). The previous image therefore
	// stays in the mask as well until the new one is decoded.
	let prevHolesUrl = '';
	let dropPrev: ReturnType<typeof setTimeout>;

	const measureHoles = () => {
		const base = root?.getBoundingClientRect();
		if (!base?.width) return;
		const rects = [...(root.parentElement?.querySelectorAll<HTMLElement>(AVOID) ?? [])]
			.map((el) => el.getBoundingClientRect())
			.filter((box) => box.width && box.height)
			.map(
				(box) =>
					// box grown by 14px: fully clear right at the element, faded out ~26px away
					`<rect x='${Math.round(box.left - base.left - 14)}' y='${Math.round(box.top - base.top - 14)}' width='${Math.round(box.width + 28)}' height='${Math.round(box.height + 28)}' rx='24'/>`
			)
			.join('');
		const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${Math.round(base.width)}' height='${Math.round(base.height)}'><filter id='b' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='6'/></filter><g filter='url(#b)'>${rects}</g></svg>`;
		const url = rects ? `data:image/svg+xml,${encodeURIComponent(svg)}` : '';
		if (url === holesUrl) return;

		prevHolesUrl = holesUrl;
		holesUrl = lastHolesUrl = url;
		clearTimeout(dropPrev);
		if (!url) return;
		const img = new Image();
		img.src = url;
		img
			.decode()
			.catch(() => {})
			.finally(() => {
				dropPrev = setTimeout(() => {
					if (holesUrl === url) prevHolesUrl = '';
				}, 150);
			});
	};

	$: holesStyle = holesUrl
		? `--welcome-holes: url("${holesUrl}");` +
			(prevHolesUrl ? ` --welcome-holes-prev: url("${prevHolesUrl}");` : '')
		: '';

	onMount(() => {
		const parent = root.parentElement;
		let pending: ReturnType<typeof setTimeout>;
		const remeasure = () => {
			clearTimeout(pending);
			pending = setTimeout(measureHoles, 60);
		};
		const resize = new ResizeObserver(remeasure);
		// the parent (window size) and the welcome content next to us (content size)
		[...(parent?.children ?? [])].forEach((el) => resize.observe(el));
		// content swapped in or out (cards, greeting)
		const mutation = new MutationObserver(remeasure);
		if (parent) mutation.observe(parent, { childList: true, subtree: true });
		// once more after the content's fade/slide-in has settled
		const settle = setTimeout(measureHoles, 600);
		measureHoles();
		return () => {
			resize.disconnect();
			mutation.disconnect();
			clearTimeout(settle);
			clearTimeout(pending);
			clearTimeout(dropPrev);
		};
	});

	// warm and cool side orbit opposite each other, so red and blue swap sides by
	// making room instead of passing through each other (which mixed violet)
	// dev only: ?welcome-debug shows controls to scrub / speed up the animation
	const debug = import.meta.env.DEV && new URLSearchParams(location.search).has('welcome-debug');

	const groups = {
		warm: ['red-1', 'red-2'],
		cool: ['blue-1', 'blue-2', 'blue-3', 'blue-4', 'blue-5']
	};
</script>

<div
	bind:this={root}
	class="welcome-bg"
	style="--welcome-clock: {clockOffset}; --welcome-fade: {FADE_MS}ms; --welcome-fade-delay: {fadeDelay}ms"
	out:fade={{ duration: fadeOutMs }}
	aria-hidden="true"
>
	<div class="layer">
		<div class="cloud">
			{#each Object.entries(groups) as [side, blobs]}
				<div class="side {side}">
					{#each blobs as blob}<div class="wander {blob}"><div class="wander-y"><div class="blob"></div></div></div>{/each}
				</div>
			{/each}
		</div>
	</div>
	<!-- same blobs again, cut to Swiss-cross marks: marks only show (and move) where the colour is -->
	<div class="layer grid" class:holes={holesUrl} style={holesStyle}>
		<div class="cloud">
			{#each Object.entries(groups) as [side, blobs]}
				<div class="side {side}">
					{#each blobs as blob}<div class="wander {blob}"><div class="wander-y"><div class="blob"></div></div></div>{/each}
				</div>
			{/each}
		</div>
	</div>
	<!-- dark mode only: fine static grain that hides gradient banding -->
	<div class="dither"></div>
</div>

{#if debug && root}
	<WelcomeBackgroundDebug target={root} />
{/if}

<style>
	.welcome-bg {
		/* federal red, Tailwind blue-500 and blue-400 (indigo read as violet) */
		--welcome-red: 255 0 0;
		--welcome-blue-deep: 59 130 246;
		--welcome-blue: 96 165 250;
		/* edge tints: blobs fade into these pale tones, so where red and blue meet only
		   two near-white tints mix (no violet) */
		--welcome-red-tint: 255 205 205;
		--welcome-blue-tint: 205 222 255;
		/* strength per theme / screen size */
		--welcome-opacity: 0.8;
		/* motion and shape tunables (defaults = the designed look; also driven by the
		   dev-only debug panel) */
		--red-strength: 1;
		--blue-strength: 1;
		--blob-scale: 1;
		--top-dim: 0.3;
		--cross-strength: 1;
		--orbit-duration: 150s;
		--orbit-rx: 14cqw;
		--orbit-ry: 9cqh;
		--presence-duration: 70s;
		--presence-min: 0.55;
		--cloud-move-duration: 61s;
		--cloud-move-amount: 1;
		--cloud-shape-duration: 47s;
		--cloud-shape-amount: 1;
		--wander-time: 1;
		--wander-amount: 1;
		--breathe-time: 1;
		--breathe-amount: 1;
		--welcome-t0: var(--welcome-clock, 0s);

		position: absolute;
		inset: 0;
		z-index: 0;
		overflow: hidden;
		pointer-events: none;
		/* colours come up slowly when the screen opens; hides any build-up jank */
		animation: welcome-in var(--welcome-fade) ease-out var(--welcome-fade-delay) both;
	}

	@keyframes welcome-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	/* dark mode: deep blue (blue-600 / blue-700) laid over plainly;
	   lighter blues or a screen blend turned into a grey haze on dark backgrounds */
	:global(.dark) .welcome-bg {
		--welcome-opacity: 0.36;
		/* red-600: pure federal red glows too much on black */
		--welcome-red: 220 38 38;
		--welcome-blue: 37 99 235;
		--welcome-blue-deep: 29 78 216;
		/* muted, greyish edges on dark backgrounds */
		--welcome-red-tint: 70 52 56;
		--welcome-blue-tint: 52 60 80;
	}

	/* OLED (dark without the SDS theme, pure black): red and blue halves looked too
	   harsh, so weaker and a warmer, slightly orange red */
	:global(.dark:not(.sds)) .welcome-bg {
		--welcome-opacity: 0.26;
		--welcome-red: 230 72 40;
	}

	/* on smaller screens the cloud covers relatively more, so tone it down */
	@media (max-width: 1024px) {
		.welcome-bg {
			--welcome-opacity: 0.65;
		}

		:global(.dark) .welcome-bg {
			--welcome-opacity: 0.3;
		}
	}

	@media (max-width: 640px) {
		.welcome-bg {
			--welcome-opacity: 0.52;
		}

		:global(.dark) .welcome-bg {
			--welcome-opacity: 0.25;
		}
	}

	/* size container: sizes and paths are in cqw/cqh */
	.layer {
		position: absolute;
		inset: 0;
		container-type: size;
		/* hard maximum: wherever the blobs drift, the colour fades out before the screen
		   edges. A soft rectangle (horizontal ∩ vertical band) rather than an oval, so it
		   does not force the cloud into a round shape. */
		--limit-x: linear-gradient(to right, transparent 6%, black 22%, black 78%, transparent 94%);
		/* faint at the top, behind the greeting; full from the input down */
		--limit-y: linear-gradient(
			to bottom,
			transparent 8%,
			rgb(0 0 0 / var(--top-dim)) 26%,
			rgb(0 0 0 / calc(var(--top-dim) + 0.15)) 36%,
			black 48%,
			black 84%,
			transparent 97%
		);
		-webkit-mask: var(--limit-y), var(--limit-x);
		-webkit-mask-composite: source-in;
		mask: var(--limit-y), var(--limit-x);
		mask-composite: intersect;
	}

	/* Swiss cross mark in official proportions: arms 1/6 longer than wide
	   (here 3px wide, 3.5px long, 10px overall), every 56px; fainter toward the
	   middle (25%), full strength on the outer ring */
	.grid {
		--cross: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56'%3E%3Cpath d='M26.5 23h3v3.5h3.5v3h-3.5v3.5h-3v-3.5H23v-3h3.5z'/%3E%3C/svg%3E")
			0 0 / 56px 56px;
		--falloff: radial-gradient(ellipse 40% 44% at 50% 55%, rgb(0 0 0 / 0.25) 20%, black 60%);

		opacity: var(--cross-strength);
		filter: saturate(1.3) brightness(0.92);
		-webkit-mask: var(--cross), var(--falloff), var(--limit-y), var(--limit-x);
		-webkit-mask-composite: source-in, source-in, source-in;
		mask: var(--cross), var(--falloff), var(--limit-y), var(--limit-x);
		mask-composite: intersect, intersect, intersect;
	}

	/* no extra saturation on dark backgrounds: the marks would glow */
	:global(.dark) .grid {
		filter: none;
	}

	/* soft cut-outs around the content elements (see measureHoles):
	   cross ∩ falloff ∩ limit-y ∩ (limit-x − (holes ∪ previous holes)) */
	.grid.holes {
		-webkit-mask:
			var(--cross),
			var(--falloff),
			var(--limit-y),
			var(--limit-x),
			var(--welcome-holes) 0 0 / 100% 100% no-repeat,
			var(--welcome-holes-prev, none) 0 0 / 100% 100% no-repeat;
		-webkit-mask-composite: source-in, source-in, source-in, source-out, source-over;
		mask:
			var(--cross),
			var(--falloff),
			var(--limit-y),
			var(--limit-x),
			var(--welcome-holes) 0 0 / 100% 100% no-repeat,
			var(--welcome-holes-prev, none) 0 0 / 100% 100% no-repeat;
		mask-composite: intersect, intersect, intersect, subtract, add;
	}

	/* Dark backgrounds show 8-bit gradient steps as rings; a faint static grain
	   (±~2 levels) breaks them up. Masked to the cloud area so the plain page
	   background stays untouched. */
	.dither {
		display: none;
		position: absolute;
		inset: 0;
		opacity: 0.04;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
		-webkit-mask: radial-gradient(closest-side at 50% 55%, black 45%, transparent);
		mask: radial-gradient(closest-side at 50% 55%, black 45%, transparent);
	}

	:global(.dark) .dither {
		display: block;
	}

	/* The whole cloud drifts toward the top, the sides and the bottom and stretches
	   or squashes, on two unrelated periods, so its overall shape keeps changing
	   while the blobs inside stay connected. */
	.cloud {
		position: absolute;
		inset: 0;
		transform-origin: 50% 55%;
		animation:
			cloud-move var(--cloud-move-duration) ease-in-out var(--welcome-t0) infinite,
			cloud-shape var(--cloud-shape-duration) ease-in-out var(--welcome-t0) infinite;
	}

	@keyframes cloud-move {
		0%,
		100% {
			translate: 0 0;
		}
		20% {
			translate: calc(2cqw * var(--cloud-move-amount)) calc(-4cqh * var(--cloud-move-amount));
		}
		40% {
			translate: calc(5cqw * var(--cloud-move-amount)) calc(1cqh * var(--cloud-move-amount));
		}
		60% {
			translate: 0 calc(8cqh * var(--cloud-move-amount));
		}
		80% {
			translate: calc(-5cqw * var(--cloud-move-amount)) 0;
		}
	}

	/* width and height change independently: round, long and flat (e.g. only along
	   the bottom), tall and narrow … */
	@keyframes cloud-shape {
		0%,
		100% {
			scale: 1 1;
		}
		20% {
			scale: calc(1 + 0.25 * var(--cloud-shape-amount)) calc(1 + -0.3 * var(--cloud-shape-amount));
		}
		40% {
			scale: calc(1 + -0.15 * var(--cloud-shape-amount)) calc(1 + 0.1 * var(--cloud-shape-amount));
		}
		60% {
			scale: calc(1 + 0.2 * var(--cloud-shape-amount)) calc(1 + -0.4 * var(--cloud-shape-amount));
		}
		80% {
			scale: calc(1 + -0.05 * var(--cloud-shape-amount)) calc(1 + -0.15 * var(--cloud-shape-amount));
		}
	}

	/* The warm (red) and the cool (blue) side circle the content on a flat ellipse,
	   always opposite each other: they swap sides by passing above and below the
	   content, so they only blend at their edges. */
	.side {
		position: absolute;
		inset: 0;
		animation:
			side-orbit var(--orbit-duration) linear
				calc(var(--orbit-duration) * var(--side-phase) + var(--welcome-t0)) infinite,
			side-presence var(--presence-duration) ease-in-out
				calc(var(--presence-duration) * var(--side-phase) + var(--welcome-t0)) infinite;
	}

	.warm {
		--side-phase: 0;
	}

	/* half a cycle ahead: opposite side, opposite strength */
	.cool {
		--side-phase: -0.5;
	}

	/* one colour leads for a while, then the other; both stay visible, so red and
	   blue are always there, just more or less of each */
	@keyframes side-presence {
		0%,
		40%,
		100% {
			opacity: 1;
		}
		50%,
		90% {
			opacity: var(--presence-min);
		}
	}

	@keyframes side-orbit {
		0.00% {
			translate: calc(var(--orbit-rx) * -1.0000) calc(var(--orbit-ry) * 0.0000);
		}
		4.17% {
			translate: calc(var(--orbit-rx) * -0.9659) calc(var(--orbit-ry) * -0.2588);
		}
		8.33% {
			translate: calc(var(--orbit-rx) * -0.8660) calc(var(--orbit-ry) * -0.5000);
		}
		12.50% {
			translate: calc(var(--orbit-rx) * -0.7071) calc(var(--orbit-ry) * -0.7071);
		}
		16.67% {
			translate: calc(var(--orbit-rx) * -0.5000) calc(var(--orbit-ry) * -0.8660);
		}
		20.83% {
			translate: calc(var(--orbit-rx) * -0.2588) calc(var(--orbit-ry) * -0.9659);
		}
		25.00% {
			translate: calc(var(--orbit-rx) * -0.0000) calc(var(--orbit-ry) * -1.0000);
		}
		29.17% {
			translate: calc(var(--orbit-rx) * 0.2588) calc(var(--orbit-ry) * -0.9659);
		}
		33.33% {
			translate: calc(var(--orbit-rx) * 0.5000) calc(var(--orbit-ry) * -0.8660);
		}
		37.50% {
			translate: calc(var(--orbit-rx) * 0.7071) calc(var(--orbit-ry) * -0.7071);
		}
		41.67% {
			translate: calc(var(--orbit-rx) * 0.8660) calc(var(--orbit-ry) * -0.5000);
		}
		45.83% {
			translate: calc(var(--orbit-rx) * 0.9659) calc(var(--orbit-ry) * -0.2588);
		}
		50.00% {
			translate: calc(var(--orbit-rx) * 1.0000) calc(var(--orbit-ry) * -0.0000);
		}
		54.17% {
			translate: calc(var(--orbit-rx) * 0.9659) calc(var(--orbit-ry) * 0.2588);
		}
		58.33% {
			translate: calc(var(--orbit-rx) * 0.8660) calc(var(--orbit-ry) * 0.5000);
		}
		62.50% {
			translate: calc(var(--orbit-rx) * 0.7071) calc(var(--orbit-ry) * 0.7071);
		}
		66.67% {
			translate: calc(var(--orbit-rx) * 0.5000) calc(var(--orbit-ry) * 0.8660);
		}
		70.83% {
			translate: calc(var(--orbit-rx) * 0.2588) calc(var(--orbit-ry) * 0.9659);
		}
		75.00% {
			translate: calc(var(--orbit-rx) * 0.0000) calc(var(--orbit-ry) * 1.0000);
		}
		79.17% {
			translate: calc(var(--orbit-rx) * -0.2588) calc(var(--orbit-ry) * 0.9659);
		}
		83.33% {
			translate: calc(var(--orbit-rx) * -0.5000) calc(var(--orbit-ry) * 0.8660);
		}
		87.50% {
			translate: calc(var(--orbit-rx) * -0.7071) calc(var(--orbit-ry) * 0.7071);
		}
		91.67% {
			translate: calc(var(--orbit-rx) * -0.8660) calc(var(--orbit-ry) * 0.5000);
		}
		95.83% {
			translate: calc(var(--orbit-rx) * -0.9659) calc(var(--orbit-ry) * 0.2588);
		}
		100.00% {
			translate: calc(var(--orbit-rx) * -1.0000) calc(var(--orbit-ry) * 0.0000);
		}
	}

	/* Each blob wanders on its own: x and y swing independently with different,
	   unrelated periods around its centre (--cx, --cy) relative to its side, so the
	   paths never repeat. */
	.wander {
		position: absolute;
		left: 50%;
		top: 55%;
		/* slightly oval; never taller than wide (phones would get tall streaks) */
		width: calc(max(var(--w), calc(var(--h) * 1.4)) * var(--blob-scale));
		height: calc(var(--h) * var(--blob-scale));
		animation: wander-x calc(var(--tx) * var(--wander-time)) ease-in-out
			calc(var(--ox) * var(--wander-time) + var(--welcome-t0)) infinite alternate;
	}

	.wander-y {
		width: 100%;
		height: 100%;
		animation: wander-y calc(var(--ty) * var(--wander-time)) ease-in-out
			calc(var(--oy) * var(--wander-time) + var(--welcome-t0)) infinite alternate;
	}

	.blob {
		width: 100%;
		height: 100%;
		/* bell-shaped falloff (1 - t²)², core colour turning into a pale tint toward
		   the edge: neighbouring colours meet as near-white tints instead of mixing
		   violet; wide soft edges and no visible outer edge (rings) */
		background: radial-gradient(
			closest-side,
			rgb(var(--c) / calc(var(--a) * var(--welcome-opacity))),
			rgb(var(--c) / calc(var(--a) * var(--welcome-opacity) * 0.980)) 10%,
			rgb(var(--c) / calc(var(--a) * var(--welcome-opacity) * 0.922)) 20%,
			rgb(var(--c) / calc(var(--a) * var(--welcome-opacity) * 0.828)) 30%,
			rgb(var(--c) / calc(var(--a) * var(--welcome-opacity) * 0.706)) 40%,
			color-mix(in oklab, rgb(var(--c) / calc(var(--a) * var(--welcome-opacity) * 0.562)) 67%, rgb(var(--c2) / calc(var(--a) * var(--welcome-opacity) * 0.562))) 50%,
			color-mix(in oklab, rgb(var(--c) / calc(var(--a) * var(--welcome-opacity) * 0.410)) 33%, rgb(var(--c2) / calc(var(--a) * var(--welcome-opacity) * 0.410))) 60%,
			rgb(var(--c2) / calc(var(--a) * var(--welcome-opacity) * 0.260)) 70%,
			rgb(var(--c2) / calc(var(--a) * var(--welcome-opacity) * 0.130)) 80%,
			rgb(var(--c2) / calc(var(--a) * var(--welcome-opacity) * 0.036)) 90%,
			rgb(var(--c2) / 0)
		);
		animation: breathe calc(var(--b) * var(--breathe-time)) ease-in-out var(--welcome-t0) infinite
			alternate;
	}

	/* only two red blobs: close together, a short wander and nearly the same tilt
	   and strength, so they always melt into one soft mass (different tilts or
	   strengths showed as separate lobes) */
	.red-1 {
		--c: var(--welcome-red);
		--c2: var(--welcome-red-tint);
		--a: calc(0.38 * var(--red-strength));
		--w: 54cqw;
		--h: 38cqh;
		--r: -4deg;
		--cx: 0cqw;
		--cy: -1cqh;
		--ax: 4cqw;
		--ay: 3cqh;
		--tx: 37s;
		--ty: 23s;
		--ox: -29.6s;
		--oy: -4.6s;
		--b: 13s;
	}
	.red-2 {
		--c: var(--welcome-red);
		--c2: var(--welcome-red-tint);
		--a: calc(0.38 * var(--red-strength));
		--w: 48cqw;
		--h: 42cqh;
		--r: 4deg;
		--cx: 0cqw;
		--cy: 2cqh;
		--ax: 4cqw;
		--ay: 3cqh;
		--tx: 29s;
		--ty: 41s;
		--ox: -40.6s;
		--oy: -24.6s;
		--b: 11s;
	}
	.blue-4 {
		--c: var(--welcome-blue-deep);
		--c2: var(--welcome-blue-tint);
		--a: calc(0.35 * var(--blue-strength));
		--w: 60cqw;
		--h: 36cqh;
		--r: -6deg;
		--cx: -4cqw;
		--cy: -8cqh;
		--ax: 9cqw;
		--ay: 7cqh;
		--tx: 43s;
		--ty: 31s;
		--ox: -17.2s;
		--oy: -49.6s;
		--b: 14s;
	}
	.blue-5 {
		--c: var(--welcome-blue-deep);
		--c2: var(--welcome-blue-tint);
		--a: calc(0.38 * var(--blue-strength));
		--w: 52cqw;
		--h: 42cqh;
		--r: 12deg;
		--cx: -2cqw;
		--cy: 9cqh;
		--ax: 9cqw;
		--ay: 7cqh;
		--tx: 34s;
		--ty: 47s;
		--ox: -61.2s;
		--oy: -47.0s;
		--b: 12s;
	}
	.blue-1 {
		--c: var(--welcome-blue);
		--c2: var(--welcome-blue-tint);
		--a: calc(0.34 * var(--blue-strength));
		--w: 62cqw;
		--h: 34cqh;
		--r: 8deg;
		--cx: 4cqw;
		--cy: 4cqh;
		--ax: 9cqw;
		--ay: 7cqh;
		--tx: 47s;
		--ty: 27s;
		--ox: -47.0s;
		--oy: -10.8s;
		--b: 15s;
	}
	.blue-2 {
		--c: var(--welcome-blue);
		--c2: var(--welcome-blue-tint);
		--a: calc(0.38 * var(--blue-strength));
		--w: 54cqw;
		--h: 40cqh;
		--r: -14deg;
		--cx: 6cqw;
		--cy: -3cqh;
		--ax: 9cqw;
		--ay: 7cqh;
		--tx: 31s;
		--ty: 39s;
		--ox: -6.2s;
		--oy: -46.8s;
		--b: 13s;
	}
	.blue-3 {
		--c: var(--welcome-blue);
		--c2: var(--welcome-blue-tint);
		--a: calc(0.26 * var(--blue-strength));
		--w: 50cqw;
		--h: 32cqh;
		--r: 6deg;
		--cx: 1cqw;
		--cy: -11cqh;
		--ax: 9cqw;
		--ay: 7cqh;
		--tx: 41s;
		--ty: 35s;
		--ox: -49.2s;
		--oy: -63.0s;
		--b: 16s;
	}

	@keyframes wander-x {
		from {
			transform: translate(calc(-50% + var(--cx) - var(--ax) * var(--wander-amount)), -50%);
		}
		to {
			transform: translate(calc(-50% + var(--cx) + var(--ax) * var(--wander-amount)), -50%);
		}
	}

	@keyframes wander-y {
		from {
			transform: translateY(calc(var(--cy) - var(--ay) * var(--wander-amount)));
		}
		to {
			transform: translateY(calc(var(--cy) + var(--ay) * var(--wander-amount)));
		}
	}

	/* each blob slowly changes between a rounder and a more stretched shape, on its
	   own period, so the two colours rarely look alike at the same time */
	@keyframes breathe {
		from {
			transform: rotate(var(--r))
				scale(calc(1 - 0.1 * var(--breathe-amount)), calc(1 + 0.12 * var(--breathe-amount)));
		}
		to {
			transform: rotate(var(--r))
				scale(calc(1 + 0.22 * var(--breathe-amount)), calc(1 - 0.15 * var(--breathe-amount)));
		}
	}

	/* paused, not removed: the negative delays keep every blob at its own place;
	   no clock offset, so the frozen layout is the same on every mount */
	@media (prefers-reduced-motion: reduce) {
		.welcome-bg {
			--welcome-t0: 0s;
			animation: none;
		}

		.cloud,
		.side,
		.wander,
		.wander-y,
		.blob {
			animation-play-state: paused;
		}
	}
</style>
