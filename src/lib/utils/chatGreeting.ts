type ChatGreetingOptions = {
	name?: string | null;
	date?: Date;
	seed?: string;
};

type ChatGreeting = {
	key: string;
	params: {
		name: string;
	};
};

const MORNING_GREETINGS = [
	'Morning, {{name}}. What should we start with?',
	'Good morning, {{name}}. What is first today?',
	'Ready to start, {{name}}?'
];

const AFTERNOON_GREETINGS = [
	'Hey {{name}}, what is next?',
	'What should we tackle next, {{name}}?',
	'What are we working on, {{name}}?'
];

const EVENING_GREETINGS = [
	'Good evening, {{name}}. What should we wrap up?',
	'Evening, {{name}}. What is left for today?',
	'What should we finish tonight, {{name}}?'
];

const NIGHT_GREETINGS = [
	'Still going, {{name}}? What should we look at?',
	'Late session, {{name}}. What do you need?',
	'What should we sort out before you call it a day, {{name}}?'
];

const getGreetingPool = (hour: number) => {
	if (hour >= 5 && hour < 11) {
		return MORNING_GREETINGS;
	}

	if (hour >= 18 && hour < 23) {
		return EVENING_GREETINGS;
	}

	if (hour >= 23 || hour < 5) {
		return NIGHT_GREETINGS;
	}

	return AFTERNOON_GREETINGS;
};

const getSeedIndex = (seed: string, length: number) => {
	let hash = 0;

	for (const character of seed) {
		hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
	}

	return hash % length;
};

export const getChatGreeting = ({
	name,
	date = new Date(),
	seed = ''
}: ChatGreetingOptions = {}): ChatGreeting => {
	const pool = getGreetingPool(date.getHours());
	const displayName = name?.trim() || 'there';
	const index = getSeedIndex(
		`${seed}-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
		pool.length
	);

	return {
		key: pool[index],
		params: {
			name: displayName
		}
	};
};
