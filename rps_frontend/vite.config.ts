import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function rpsTerminalLogger(): Plugin {
  return {
    name: 'rps-terminal-logger',
    configureServer(server) {
      server.middlewares.use('/__rps_log', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }

        let body = ''

        req.on('data', (chunk) => {
          body += chunk
        })

        req.on('end', () => {
          try {
            const payload = JSON.parse(body) as {
              time?: string
              tag?: string
              data?: unknown
            }

            const time = payload.time ?? new Date().toISOString()
            const tag = payload.tag ?? 'unknown'
            console.log(`[RPS ${time}] ${tag}`, payload.data ?? {})
          } catch {
            console.log('[RPS] malformed log payload', body)
          }

          res.statusCode = 204
          res.end()
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), rpsTerminalLogger()],
})
