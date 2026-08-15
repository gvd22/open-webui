import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

import { viteStaticCopy } from 'vite-plugin-static-copy';

const allowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? '')
	.split(',')
	.map((host) => host.trim())
	.filter(Boolean);
const backendUrl = process.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:8080';

export default defineConfig({
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
		APP_VERSION: JSON.stringify(process.env.npm_package_version),
		APP_BUILD_HASH: JSON.stringify(process.env.APP_BUILD_HASH || 'dev-build')
	},
	build: {
		sourcemap: true
	},
	server: {
		...(allowedHosts.length ? { allowedHosts } : {}),
		proxy: {
			'/api': { target: backendUrl, changeOrigin: true, ws: true },
			'/ollama': { target: backendUrl, changeOrigin: true },
			'/openai': { target: backendUrl, changeOrigin: true },
			'/ws': { target: backendUrl, changeOrigin: true, ws: true },
			'/static': { target: backendUrl, changeOrigin: true },
			'/user.png': { target: backendUrl, changeOrigin: true }
		}
	},
	worker: {
		format: 'es'
	},
	esbuild: {
		pure: process.env.ENV === 'dev' ? [] : ['console.log', 'console.debug', 'console.error']
	}
});
