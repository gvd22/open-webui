export const getTerminalConnectionContextKey = (
	terminalId: string | null | undefined,
	chatId: string | null | undefined
) => `${terminalId ?? ''}\u0000${chatId ?? ''}`;

export const isCurrentTerminalSocket = <T>(
	currentSocket: T | null,
	candidateSocket: T,
	currentSequence: number,
	requestSequence: number
) => currentSocket === candidateSocket && currentSequence === requestSequence;
