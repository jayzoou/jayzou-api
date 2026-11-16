import { z } from 'zod'

const schema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  AI_MODE: z.literal('mock').default('mock'),
  MOCK_CHUNK_DELAY_MS: z.coerce.number().int().min(0).max(1000).default(25),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5000,http://127.0.0.1:5000,http://127.0.0.1:4173').transform(value => value.split(',').map(origin => z.url().parse(origin.trim()))),
  KNOWLEDGE_FILE: z.string().default('data/knowledge.json'),
  PROFILE_FILE: z.string().default('data/profile.json'),
})
export function readConfig(env: NodeJS.ProcessEnv) { return schema.parse(env) }
export type Config = ReturnType<typeof readConfig>
