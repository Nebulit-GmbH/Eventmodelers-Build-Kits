import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { EmitMetadataPlugin } from '@cratis/arc.vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    root: fileURLToPath(new URL('./', import.meta.url)),
    optimizeDeps: {
        exclude: ['tslib'],
    },
    esbuild: {
        supported: {
            'top-level-await': true,
        },
    },
    build: {
        outDir: '../wwwroot',
        assetsDir: '',
        modulePreload: false,
        target: 'esnext',
        minify: false,
        cssCodeSplit: false,
        rollupOptions: {
            external: [],
        },
    },
    plugins: [
        react(),
        tailwindcss(),
        EmitMetadataPlugin({ tsconfigPath: fileURLToPath(new URL('./tsconfig.json', import.meta.url)) }) as any
    ],
    server: {
        port: 9000,
        open: true,
        proxy: {
            "/.cratis": {
                target: 'http://localhost:5000',
                ws: true
            },
            '/api': {
                target: 'http://localhost:5000',
                ws: true
            },
            '/swagger': {
                target: 'http://localhost:5000',
                ws: true
            }
        }
    },
    resolve: {
        alias: {
            'Api': fileURLToPath(new URL('../Features', import.meta.url)),
        }
    }
});
