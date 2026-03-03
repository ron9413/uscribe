import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
    main: {
        build: {
            rollupOptions: {
                external: ['electron']
            }
        }
    },
    preload: {
        build: {
            rollupOptions: {
                external: ['electron']
            }
        }
    },
    renderer: {
        plugins: [react()],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src')
            }
        }
    }
})
