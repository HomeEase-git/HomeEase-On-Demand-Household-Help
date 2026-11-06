import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const originOf = (value) => {
  try {
    return new URL(value).origin
  } catch {
    return null // relative ("/api") → same origin
  }
}

export function contentSecurityPolicy(env) {
  const sentry = env.VITE_SENTRY_DSN ? originOf(env.VITE_SENTRY_DSN.replace(/\/\/[^@/]+@/, '//')) : null
  const connect = ["'self'", originOf(env.VITE_API_URL ?? ''), sentry].filter(Boolean)
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.supabase.co",
    'frame-src blob: https://*.supabase.co',
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_')

  return {
    plugins: [
      react(),
      {
        name: 'content-security-policy',
        apply: 'build',
        transformIndexHtml: () => [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy(env) },
            injectTo: 'head-prepend',
          },
        ],
      },
    ],
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, '../shared'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  }
})
