export const buildWebPreviewSandbox = (options: {
	allowForms: boolean;
	allowSameOrigin?: boolean;
}) => `allow-scripts allow-downloads${options.allowForms ? ' allow-forms' : ''}`;
