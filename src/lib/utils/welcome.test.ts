import { describe, expect, it } from 'vitest';
import { getGreetingSlot, stableRandomRank } from './welcome';

const at = (month: number, day: number, hour: number) => new Date(2026, month - 1, day, hour, 30);

describe('getGreetingSlot', () => {
	it('picks the time of day with boundaries at 5, 11, 17 and 22', () => {
		expect(getGreetingSlot(at(3, 10, 4))).toBe('night');
		expect(getGreetingSlot(at(3, 10, 5))).toBe('morning');
		expect(getGreetingSlot(at(3, 10, 10))).toBe('morning');
		expect(getGreetingSlot(at(3, 10, 11))).toBe('day');
		expect(getGreetingSlot(at(3, 10, 16))).toBe('day');
		expect(getGreetingSlot(at(3, 10, 17))).toBe('evening');
		expect(getGreetingSlot(at(3, 10, 21))).toBe('evening');
		expect(getGreetingSlot(at(3, 10, 22))).toBe('night');
	});

	it('greets New Year and Swiss National Day all day long', () => {
		expect(getGreetingSlot(at(1, 1, 3))).toBe('newYear');
		expect(getGreetingSlot(at(1, 1, 20))).toBe('newYear');
		expect(getGreetingSlot(at(8, 1, 9))).toBe('nationalDay');
		expect(getGreetingSlot(at(8, 2, 9))).toBe('morning');
	});

	it('keeps the random rank of a prompt stable', () => {
		const prompt = { content: 'Help me study' };
		expect(stableRandomRank(prompt)).toBe(stableRandomRank({ content: 'Help me study' }));
		expect(stableRandomRank({ id: 'a' })).not.toBe(stableRandomRank({ id: 'b' }));
	});
});
