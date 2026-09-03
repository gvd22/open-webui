type Listener = (event: MessageEvent) => void;

class ViewerPyodideWorker {
	private listeners = new Set<Listener>();

	addEventListener(type: string, listener: Listener) {
		if (type === 'message') this.listeners.add(listener);
	}

	removeEventListener(type: string, listener: Listener) {
		if (type === 'message') this.listeners.delete(listener);
	}

	postMessage(message: { id: string; path: string; maxBytes: number }) {
		void this.read(message);
	}

	private emit(data: unknown) {
		const event = new MessageEvent('message', { data });
		for (const listener of this.listeners) listener(event);
	}

	private async read(message: { id: string; path: string; maxBytes: number }) {
		try {
			const response = await fetch(`/runtime/files/view?path=${encodeURIComponent(message.path)}`, {
				headers: {
					Authorization: 'Bearer viewer-test-token',
					'X-Session-Id':
						localStorage.getItem('viewer-runtime-session') ?? 'viewer-browser-test'
				}
			});
			if (response.status === 404) throw new Error('missing');
			if (!response.ok) throw new Error('unavailable');
			const contentLength = Number(response.headers.get('content-length') ?? 0);
			if (contentLength > message.maxBytes) throw new Error('File exceeds the read limit');
			const data = await response.arrayBuffer();
			if (data.byteLength > message.maxBytes) throw new Error('File exceeds the read limit');
			this.emit({ id: message.id, data });
		} catch (cause) {
			this.emit({
				id: message.id,
				error: cause instanceof Error ? cause.message : String(cause)
			});
		}
	}
}

export const createPyodideWorker = () => new ViewerPyodideWorker() as unknown as Worker;
