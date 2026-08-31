import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chat = readFileSync(new URL('./Chat.svelte', import.meta.url), 'utf8');

describe('saved-chat Code Interpreter preference', () => {
	it('persists and restores an explicit feature before model defaults', () => {
		expect(chat).toContain('const getSavedCodeInterpreterPreference');
		expect(chat).toContain('chatContent?.features?.code_interpreter');
		expect(chat).toContain('lastUserMessage?.features?.code_interpreter');
		expect(chat).toContain("typeof savedPreference === 'boolean'");
		expect(chat).toContain('features: getChatFeatures()');
		expect(chat).toContain('equal(features, loaded.features ?? {})');
	});

	it('does not inherit another chat toggle when a legacy chat has no preference', () => {
		expect(chat).toContain('codeInterpreterEnabled = savedCodeInterpreterPreference ?? false;');
	});
});
