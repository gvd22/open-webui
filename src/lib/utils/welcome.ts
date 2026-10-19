// AI-2390: logic of the KOBY welcome screen (texts live in WelcomeGreeting.svelte, as
// i18n keys are only parsed from .svelte files).
//
// Random choices are drawn once per page load: switching between a new chat and a
// folder remounts the page, and greeting and suggestion order must not change then.

export type GreetingSlot = 'newYear' | 'nationalDay' | 'morning' | 'day' | 'evening' | 'night';

export const getGreetingSlot = (now: Date): GreetingSlot => {
	if (now.getMonth() === 0 && now.getDate() === 1) return 'newYear';
	if (now.getMonth() === 7 && now.getDate() === 1) return 'nationalDay';

	const hour = now.getHours();
	if (hour >= 5 && hour < 11) return 'morning';
	if (hour >= 11 && hour < 17) return 'day';
	if (hour >= 17 && hour < 22) return 'evening';
	return 'night';
};

export const greetingRoll = Math.random();

// Random but stable sort key per suggestion prompt.
const ranks = new Map<string, number>();
export const stableRandomRank = (prompt: { id?: string; content?: unknown }): number => {
	const key = prompt.id ?? JSON.stringify(prompt.content);
	if (!ranks.has(key)) ranks.set(key, Math.random());
	return ranks.get(key)!;
};
