import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// The dev server needs inline styles/HMR websocket; production keeps the strict CSP from index.html.
const relaxCspForDev = {
  name: 'relax-csp-dev',
  apply: 'serve' as const,
  transformIndexHtml: (html: string) =>
    html
      .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
      .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
      .replace("connect-src 'none'", "connect-src 'self' ws://localhost:*")
}

export default defineConfig({
  main: { resolve: { alias: { '@shared': resolve('src/shared') } } },
  preload: { resolve: { alias: { '@shared': resolve('src/shared') } } },
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react(), relaxCspForDev]
  }
})
