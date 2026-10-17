import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { appManifest } from './plugins/app-manifest.ts'

// In development the API runs on :3000 and is proxied under /api, so auth cookies are
// first-party to the web origin (http://localhost:5173), mirroring play./api. in prod.
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:3000'

export default defineConfig(({ mode }) => {
  // `vite build --mode native` (pnpm --filter @game/web build:native): the bundle the mobile
  // app shells load (docs/MOBILE.md). Bearer-token auth (VITE_NATIVE) and a full API URL, since
  // the app's own origin (capacitor://localhost, https://localhost) has no /api.
  const native = mode === 'native'
  if (native) {
    const apiUrl = loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL ?? process.env.VITE_API_URL
    if (!apiUrl || !/^https?:\/\/[^/]+/.test(apiUrl)) {
      throw new Error(
        'build:native needs VITE_API_URL, the API origin, e.g. VITE_API_URL=https://api.example.com',
      )
    }
  }
  return {
    plugins: [react(), tailwindcss(), appManifest()],
    // The shells serve the bundle from the root of their own origin, so absolute asset paths
    // work there and keep deep links (e.g. /match/<id>) loading; no relative base needed.
    // Bearer-token mode is a native-build switch only: any other build (or the dev server)
    // ignores a VITE_NATIVE left in the shell or a .env file, so the website never keeps its
    // session token where page scripts can read it. Unit tests (mode 'test') stub it.
    ...(mode === 'test'
      ? {}
      : { define: { 'import.meta.env.VITE_NATIVE': JSON.stringify(native ? '1' : '') } }),
    ...(native ? { build: { outDir: 'dist-native' } } : {}),
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        // ws: Colyseus WebSockets live under /api/colyseus (@game/protocol COLYSEUS_PATH).
        '/api': { target: API_TARGET, changeOrigin: false, xfwd: true, ws: true },
      },
    },
    preview: {
      port: 4173,
      proxy: {
        '/api': { target: API_TARGET, changeOrigin: false, xfwd: true, ws: true },
      },
    },
  }
})
