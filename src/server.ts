import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { readConfig } from './config.js'
import { loadKnowledge, loadProfile } from './knowledge.js'
import { createApp } from './app.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const config = readConfig(process.env)
const [knowledge, profile] = await Promise.all([loadKnowledge(resolve(root, config.KNOWLEDGE_FILE)), loadProfile(resolve(root, config.PROFILE_FILE))])
const app = createApp({ knowledge, profile, delayMs: config.MOCK_CHUNK_DELAY_MS }, config)
const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, info => {
  console.log(`jayzou-api (mock) http://${config.HOST}:${info.port} — ${knowledge.articles.length} articles`)
})
function shutdown() {
  const timeout = setTimeout(() => process.exit(1), 5000)
  timeout.unref()
  server.close(() => { clearTimeout(timeout); process.exit(0) })
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
