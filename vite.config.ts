import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { version } from './package.json';

import { viteStaticCopy } from 'vite-plugin-static-copy';

const allowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? '')
	.split(',')
	.map((host) => host.trim())
	.filter(Boolean);
const backendTarget = process.env.WEBUI_BACKEND_URL ?? process.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:8080';

export default defineConfig({
	// The lazy worker must not trigger dependency optimization and a page reload on first use.
	optimizeDeps: { include: ['pyodide'] },
	plugins: [
		sveltekit(),
		viteStaticCopy({
			targets: [
				{
					src: 'node_modules/onnxruntime-web/dist/*.jsep.*',

					dest: 'wasm'
				}
			]
		})
	],
	define: {
		APP_VERSION: JSON.stringify(version),
		APP_BUILD_HASH: JSON.stringify(process.env.APP_BUILD_HASH || 'dev-build')
	},
	build: {
		manifest: true,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes('/node_modules/pdfjs-dist/')) return 'pdfjs-dist';
					if (id.includes('/node_modules/docx-preview/')) return 'docx-preview';
					if (id.includes('/node_modules/@aiden0z/pptx-renderer/')) return 'pptx-renderer';
				}
			}
		},
		sourcemap: true
	},
	server: {
		watch: {
			ignored: ['**/.tmp/**', '**/.codex-dev-data/**', '**/.venv/**', '**/static/pyodide/**', '**/backend/**', '**/tests/**', '**/docs/**', '**/*.test.ts']
		},
		...(allowedHosts.length ? { allowedHosts } : {}),
		proxy: {
			'/api': { target: backendTarget, changeOrigin: true, ws: true },
			'/ollama': { target: backendTarget, changeOrigin: true },
			'/oauth': { target: backendTarget, changeOrigin: true },
			'/openai': { target: backendTarget, changeOrigin: true },
			'/ws': { target: backendTarget, changeOrigin: true, ws: true },
			'/static': { target: backendTarget, changeOrigin: true },
			'/user.png': { target: backendTarget, changeOrigin: true }
		}
	},
	worker: {
		format: 'es'
	},
	esbuild: {
		pure: process.env.ENV === 'dev' ? [] : ['console.log', 'console.debug', 'console.error']
	}
});
