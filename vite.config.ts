import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig({
    plugins: [
        react(),
        electron([
            {
                entry: 'electron/main.ts',
                onstart(options) {
                    options.startup()
                },
                vite: {
                    build: {
                        outDir: 'dist-electron',
                        emptyOutDir: true,
                        rollupOptions: {
                            external: ['electron', 'robotjs'],
                            output: {
                                entryFileNames: 'main.bundle.js',
                                chunkFileNames: '[name].js',
                                manualChunks: () => 'main.bundle'
                            }
                        }
                    }
                }
            },
            {
                entry: 'electron/preload.ts',
                onstart(options) {
                    options.reload()
                },
                vite: {
                    build: {
                        outDir: 'dist-electron',
                        rollupOptions: {
                            external: ['electron'],
                            output: {
                                format: 'cjs',
                                entryFileNames: 'preload.js',
                            }
                        }
                    }
                }
            }
        ]),
        renderer()
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@electron': path.resolve(__dirname, './electron')
        }
    }
})
