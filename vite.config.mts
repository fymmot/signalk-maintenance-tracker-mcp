import { defineConfig } from 'vite'
import { devHost } from './tools/dev-host'

/*
 * The web app. Source in web/, built into public/, which Signal K serves at
 * /signalk-maintenance-tracker-mcp/ (the `signalk-webapp` keyword). Relative asset
 * paths, so it works under that prefix and behind a reverse proxy with a subpath.
 *
 * `npm run dev:web` serves it with hot reload. Without SK_URL the plugin runs inside
 * the dev server (tools/dev-host.ts, data in .dev-data/); with SK_URL the API and
 * sign-in go to that Signal K server: SK_URL=http://boat.local:3000 npm run dev:web
 */
const target = process.env.SK_URL

export default defineConfig(({ command }) => ({
  root: 'web',
  base: './',
  publicDir: 'public',
  build: {
    outDir: '../public',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    reportCompressedSize: true
  },
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' }
  },
  plugins: command === 'serve' && !target ? [devHost()] : [],
  server: {
    port: 3778,
    proxy: target
      ? {
          '/plugins': { target, changeOrigin: true },
          '/signalk': { target, changeOrigin: true, ws: true },
          '/skServer': { target, changeOrigin: true }
        }
      : undefined
  }
}))
