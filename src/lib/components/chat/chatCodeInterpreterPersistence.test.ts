import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chat = readFileSync(new URL('./Chat.svelte', import.meta.url), 'utf8');
const messageInput = readFileSync(new URL('./MessageInput.svelte', import.meta.url), 'utf8');
const integrationsMenu = readFileSync(
	new URL('./MessageInput/IntegrationsMenu.svelte', import.meta.url),
	'utf8'
);
const layout = readFileSync(new URL('../../../routes/+layout.svelte', import.meta.url), 'utf8');

describe('automatic Code Interpreter lifecycle', () => {
	it('offers code execution automatically when the model and user are allowed', () => {
		expect(chat).toContain('$: codeInterpreterEnabled =');
		expect(chat).toContain('?.code_interpreter ?? true');
		expect(chat).toContain('$config?.features?.enable_code_interpreter');
		expect(chat).toContain('$user?.permissions?.features?.code_interpreter');
		expect(chat).toContain('!$selectedTerminalId');
		expect(chat).toContain('features: getChatFeatures()');
	});

	it('does not expose a manual Code Interpreter toggle in the composer', () => {
		expect(messageInput).not.toContain('showCodeInterpreterButton');
		expect(messageInput).not.toContain('bind:codeInterpreterEnabled');
		expect(integrationsMenu).not.toContain('codeInterpreterEnabled');
		expect(integrationsMenu).not.toContain("$i18n.t('Code Interpreter')");
	});

	it('publishes generated Pyodide documents to the active chat output catalog', () => {
		expect(layout).toContain("new CustomEvent('pyodide:files'");
		expect(layout).toContain('detail: { paths: workspaceFiles, chatId }');
		expect(chat).toContain('if (detail.chatId && detail.chatId !== $chatId) return;');
	});
});
