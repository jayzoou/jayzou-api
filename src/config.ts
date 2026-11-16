import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  AI_MODE: z.enum(['mock', 'live']).default('mock'),
  BAILIAN_API_KEY: z.string().trim().min(1).optional(),
  BAILIAN_BASE_URL: z.url().refine(value => ['https:', 'http:'].includes(new URL(value).protocol), 'Use an HTTP(S) endpoint').default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
  BAILIAN_MODEL: z.string().trim().min(1).default('qwen-plus'),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(60000),
  MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).max(8000).default(2000),
  MAX_CONCURRENT_STREAMS: z.coerce.number().int().min(1).max(100).default(10),
  MOCK_CHUNK_DELAY_MS: z.coerce.number().int().min(0).max(1000).default(25),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5000,http://127.0.0.1:5000,http://127.0.0.1:4173').transform(value => value.split(',').map(origin => z.url().parse(origin.trim()))),
  KNOWLEDGE_FILE: z.string().default('data/knowledge.json'),
  PROFILE_FILE: z.string().default('data/profile.json'),
}).superRefine((value, context) => {
  if (value.AI_MODE === 'live' && !value.BAILIAN_API_KEY) context.addIssue({ code: 'custom', path: ['BAILIAN_API_KEY'], message: 'Live mode requires BAILIAN_API_KEY' })
})
export function readConfig(env: NodeJS.ProcessEnv) { return schema.parse(env) }
export type Config = ReturnType<typeof readConfig>
