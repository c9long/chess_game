import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Dev-only hot-seat sandbox for @game/board. Not part of apps/web and never deployed.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { port: 5180, strictPort: false },
  preview: { port: 5181 },
  build: { outDir: fileURLToPath(new URL('../dist/sandbox', import.meta.url)), emptyOutDir: true },
})
