<script lang="ts">
	// AI-2390: dev-only controls for the welcome background (enable with ?welcome-debug):
	// timeline (play/pause, speed, scrubbing) and live tuning of its CSS variables.
	import { onMount } from 'svelte';

	export let target: HTMLElement;

	type Control = { name: string; label: string; min: number; max: number; step: number; unit: string };
	const groups: { title: string; controls: Control[] }[] = [
		{
			title: 'Strength & shape',
			controls: [
				{ name: '--welcome-opacity', label: 'Overall strength', min: 0, max: 1.5, step: 0.01, unit: '' },
				{ name: '--red-strength', label: 'Red strength', min: 0, max: 2, step: 0.05, unit: '' },
				{ name: '--blue-strength', label: 'Blue strength', min: 0, max: 2, step: 0.05, unit: '' },
				{ name: '--blob-scale', label: 'Blob size', min: 0.3, max: 2, step: 0.05, unit: '' },
				{ name: '--top-dim', label: 'Colour behind greeting', min: 0, max: 1, step: 0.05, unit: '' },
				{ name: '--cross-strength', label: 'Swiss crosses', min: 0, max: 1.5, step: 0.05, unit: '' }
			]
		},
		{
			title: 'Red ↔ blue sides',
			controls: [
				{ name: '--orbit-duration', label: 'Swap sides: full turn', min: 10, max: 400, step: 5, unit: 's' },
				{ name: '--orbit-rx', label: 'Distance (horizontal)', min: 0, max: 30, step: 0.5, unit: 'cqw' },
				{ name: '--orbit-ry', label: 'Distance (vertical)', min: 0, max: 25, step: 0.5, unit: 'cqh' },
				{ name: '--presence-duration', label: 'Lead colour cycle', min: 10, max: 300, step: 5, unit: 's' },
				{ name: '--presence-min', label: 'Weaker side strength', min: 0, max: 1, step: 0.05, unit: '' }
			]
		},
		{
			title: 'Whole cloud',
			controls: [
				{ name: '--cloud-move-duration', label: 'Drift cycle', min: 5, max: 300, step: 1, unit: 's' },
				{ name: '--cloud-move-amount', label: 'Drift distance', min: 0, max: 3, step: 0.05, unit: '' },
				{ name: '--cloud-shape-duration', label: 'Stretch cycle', min: 5, max: 300, step: 1, unit: 's' },
				{ name: '--cloud-shape-amount', label: 'Stretch amount', min: 0, max: 2, step: 0.05, unit: '' }
			]
		},
		{
			title: 'Single blobs',
			controls: [
				{ name: '--wander-time', label: 'Wander slowness', min: 0.2, max: 4, step: 0.05, unit: '' },
				{ name: '--wander-amount', label: 'Wander distance', min: 0, max: 3, step: 0.05, unit: '' },
				{ name: '--breathe-time', label: 'Shape change slowness', min: 0.2, max: 4, step: 0.05, unit: '' },
				{ name: '--breathe-amount', label: 'Shape change amount', min: 0, max: 3, step: 0.05, unit: '' }
			]
		}
	];
	const colours = [
		{ name: '--welcome-red', label: 'Red' },
		{ name: '--welcome-red-tint', label: 'Red edge tint' },
		{ name: '--welcome-blue', label: 'Blue' },
		{ name: '--welcome-blue-deep', label: 'Blue (deep)' },
		{ name: '--welcome-blue-tint', label: 'Blue edge tint' }
	];

	let values: Record<string, number | string> = {};
	let defaults: Record<string, number | string> = {};
	let open = false;
	let copied = false;

	// "r g b" ⇄ "#rrggbb"
	const toHex = (rgb: string) =>
		'#' + rgb.trim().split(/\s+/).map((v) => Number(v).toString(16).padStart(2, '0')).join('');
	const toRgb = (hex: string) =>
		[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ');

	const readValues = () => {
		const style = getComputedStyle(target);
		for (const c of groups.flatMap((g) => g.controls))
			values[c.name] = parseFloat(style.getPropertyValue(c.name));
		for (const c of colours) values[c.name] = toHex(style.getPropertyValue(c.name));
		values = values;
	};

	const unitOf = (name: string) => groups.flatMap((g) => g.controls).find((c) => c.name === name)?.unit ?? '';
	const apply = (name: string) => {
		const value = values[name];
		target.style.setProperty(
			name,
			typeof value === 'string' ? toRgb(value) : `${value}${unitOf(name)}`
		);
	};
	const reset = () => {
		for (const name of Object.keys(defaults)) target.style.removeProperty(name);
		readValues();
	};
	const copy = async () => {
		const changed = Object.keys(values).filter((n) => values[n] !== defaults[n]);
		const text = changed.length
			? changed
					.map((n) => {
						const v = values[n];
						return `${n}: ${typeof v === 'string' ? toRgb(v) : `${v}${unitOf(n)}`};`;
					})
					.join('\n')
			: '/* defaults, nothing changed */';
		await navigator.clipboard.writeText(text);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	};

	// timeline
	let playing = true;
	let speed = 1;
	let time = 0; // seconds since the background was mounted

	const animations = () => target?.getAnimations({ subtree: true }) ?? [];
	const setSpeed = () => animations().forEach((a) => (a.playbackRate = speed));
	// every animation counts from the mount, so one currentTime sets the whole scene
	const seek = () => {
		animations().forEach((a) => {
			a.currentTime = time * 1000;
			if (!playing) a.pause();
		});
	};
	const togglePlay = () => {
		playing = !playing;
		animations().forEach((a) => {
			a.playbackRate = speed;
			if (playing) a.play();
			else a.pause();
		});
	};

	onMount(() => {
		readValues();
		defaults = { ...values };
		const timer = setInterval(() => {
			// a looping one: the one-off fade-in stops at its end
			const current = animations().find((a) => a.effect?.getTiming().iterations === Infinity)
				?.currentTime;
			if (playing && typeof current === 'number') time = current / 1000;
		}, 200);
		return () => clearInterval(timer);
	});
</script>

<div
	class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 text-xs whitespace-nowrap
	       bg-white/95 dark:bg-gray-900/95 text-gray-800 dark:text-gray-100
	       border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg"
>
	{#if open}
		<div class="max-h-[60vh] overflow-y-auto p-3 border-b border-gray-200 dark:border-gray-700">
			<div class="grid grid-cols-2 gap-x-6 gap-y-3">
				{#each groups as group}
					<div>
						<div class="font-medium mb-1">{group.title}</div>
						{#each group.controls as c}
							<label class="flex items-center gap-2">
								<span class="w-40">{c.label}</span>
								<input
									class="w-36"
									type="range"
									min={c.min}
									max={c.max}
									step={c.step}
									bind:value={values[c.name]}
									on:input={() => apply(c.name)}
								/>
								<span class="w-16 tabular-nums">{values[c.name]}{c.unit}</span>
							</label>
						{/each}
					</div>
				{/each}
				<div>
					<div class="font-medium mb-1">Colours (all themes)</div>
					{#each colours as c}
						<label class="flex items-center gap-2">
							<span class="w-40">{c.label}</span>
							<input type="color" bind:value={values[c.name]} on:input={() => apply(c.name)} />
							<span class="tabular-nums">{values[c.name]}</span>
						</label>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	<div class="flex items-center gap-4 px-4 py-2">
		<span class="font-medium">Background debug</span>
		<button class="w-14 px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600" on:click={togglePlay}>
			{playing ? 'Pause' : 'Play'}
		</button>
		<label class="flex items-center gap-1">
			Speed
			<input type="range" min="0.1" max="20" step="0.1" bind:value={speed} on:input={setSpeed} />
			<span class="w-10 shrink-0 tabular-nums">{speed.toFixed(1)}×</span>
		</label>
		<label class="flex items-center gap-1">
			Time
			<input class="w-56" type="range" min="0" max="300" step="0.5" bind:value={time} on:input={seek} />
			<span class="w-14 shrink-0 tabular-nums">{time.toFixed(1)} s</span>
		</label>
		<button class="px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600" on:click={() => (open = !open)}>
			{open ? 'Hide settings' : 'Settings'}
		</button>
		<button class="px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600" on:click={reset}>Reset</button>
		<button class="px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600" on:click={copy}>
			{copied ? 'Copied ✓' : 'Copy values'}
		</button>
	</div>
</div>
