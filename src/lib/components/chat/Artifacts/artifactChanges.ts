export type ArtifactChange = { path: string; before: string; after: string; truncated: boolean };

// Saved chats and tool output are untrusted, including older imported histories.
export function normalizeArtifactChanges(value: unknown): ArtifactChange[] {
	if (!Array.isArray(value)) return [];
	let budget = 12000;
	return value.slice(0, 24).flatMap((item) => {
		if (
			!item ||
			typeof item.path !== 'string' ||
			typeof item.before !== 'string' ||
			typeof item.after !== 'string'
		)
			return [];
		const limit = Math.min(3000, Math.floor(budget / 2));
		const before = item.before.slice(0, limit),
			after = item.after.slice(0, limit);
		budget -= before.length + after.length;
		return [
			{
				path: item.path.slice(0, 240),
				before,
				after,
				truncated:
					Boolean(item.truncated) ||
					before.length < item.before.length ||
					after.length < item.after.length
			}
		];
	});
}
