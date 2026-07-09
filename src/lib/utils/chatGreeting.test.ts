import { describe, expect, test } from 'vitest';

import { getChatGreeting } from './chatGreeting';

describe('getChatGreeting', () => {
	test('selects a warm morning greeting with the user name', () => {
		const greeting = getChatGreeting({
			name: 'Gian',
			date: new Date('2026-07-08T07:30:00'),
			seed: 'new-chat'
		});

		expect(greeting.params).toEqual({ name: 'Gian' });
		expect(greeting.key).toMatch(/morning|start/i);
	});

	test('uses a different time-of-day pool in the evening', () => {
		const greeting = getChatGreeting({
			name: 'Gian',
			date: new Date('2026-07-08T20:30:00'),
			seed: 'new-chat'
		});

		expect(greeting.params).toEqual({ name: 'Gian' });
		expect(greeting.key).toMatch(/Evening|tonight|today/);
	});

	test('keeps the selected greeting stable for the same seed', () => {
		const options = {
			name: 'Gian',
			date: new Date('2026-07-08T14:30:00'),
			seed: 'stable-chat'
		};

		expect(getChatGreeting(options)).toEqual(getChatGreeting(options));
	});

	test('falls back to a friendly generic name when the user name is missing', () => {
		const greeting = getChatGreeting({
			name: '',
			date: new Date('2026-07-08T14:30:00'),
			seed: 'anonymous-chat'
		});

		expect(greeting.params).toEqual({ name: 'there' });
	});
});
