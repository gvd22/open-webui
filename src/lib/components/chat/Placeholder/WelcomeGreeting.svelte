<script lang="ts">
	// AI-2390: time-of-day greeting of the welcome screen (replaces the model header).
	// Each slot has a few variants; one is picked per page load (greetingRoll).
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import { fade } from 'svelte/transition';

	import { user } from '$lib/stores';
	import { getGreetingSlot, greetingRoll } from '$lib/utils/welcome';

	const i18n = getContext<Writable<i18nType>>('i18n');

	export let animate = true;

	const slot = getGreetingSlot(new Date());

	const getGreetings = (i18n: i18nType, name: string | undefined): string[] => {
		const n = { name };
		switch (slot) {
			case 'newYear':
				return [i18n.t('Happy New Year, {{name}}!', n)];
			case 'nationalDay':
				return [i18n.t('Happy National Day, {{name}}!', n)];
			case 'morning':
				return [
					i18n.t('Good morning, {{name}}!', n),
					i18n.t('A good morning to you, {{name}}.', n),
					i18n.t('Welcome, {{name}}.', n),
					i18n.t('Glad you are here, {{name}}.', n),
					i18n.t('Ready for a productive morning?'),
					i18n.t('Have a great start to the day, {{name}}!', n),
					i18n.t('Where shall we start?'),
					i18n.t('How can I help you?'),
					i18n.t('What shall we work on today?')
				];
			case 'day':
				return [
					i18n.t('Good day, {{name}}!', n),
					i18n.t('Welcome back, {{name}}.', n),
					i18n.t('Time for the next step, {{name}}.', n),
					i18n.t('What is next, {{name}}?', n),
					i18n.t('Good to see you, {{name}}.', n),
					i18n.t('Where shall we start?'),
					i18n.t('How can I help you?'),
					i18n.t('What shall we work on today?')
				];
			case 'evening':
				return [
					i18n.t('Good evening, {{name}}!', n),
					i18n.t('Have a nice evening, {{name}}.', n),
					i18n.t('Welcome back, {{name}}.', n),
					i18n.t('Good to see you, {{name}}.', n),
					i18n.t('Where shall we start?'),
					i18n.t('How can I help you?')
				];
			default:
				return [
					i18n.t('Good night, {{name}}.', n),
					i18n.t('Good evening, {{name}}!', n),
					i18n.t('Welcome, {{name}}.', n),
					i18n.t('Where shall we start?'),
					i18n.t('How can I help you?')
				];
		}
	};

	$: greetings = getGreetings($i18n, $user?.name);
</script>

<h1
	id="welcome-greeting"
	class="px-5 mb-3 text-[1.75rem] leading-9 line-clamp-2"
	in:fade={{ duration: animate ? 100 : 0 }}
>
	{greetings[Math.floor(greetingRoll * greetings.length)]}
</h1>
