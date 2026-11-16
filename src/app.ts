import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { contactSchema } from './contracts.js'
import { chatEvents, insightEvents, type MockContext } from './mock.js'
import { eventResponse } from './stream.js'
import { createLiveService, type AIService } from './llm.js'
import type { Config } from './config.js'
import { articleSource, searchArticles } from './knowledge.js'
import { isAllowedOrigin } from './origins.js'

const textPart = z.object({ type: z.literal('text'), text: z.string().max(8000) })
const chatRequest = z.object({
  contractVersion: z.literal('1').default('1'),
  messages: z.array(z.object({ id: z.string().max(200), role: z.enum(['user', 'assistant']), parts: z.array(z.unknown()).max(30) })).min(1).max(40),
})
const insightRequest = z.object({ articlePath: z.string().regex(/^\/posts\/[\w/-]+\/?$/) })

async function jsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new HTTPException(415, { message: '请使用 application/json。' })
  try { return await request.json() } catch { throw new HTTPException(400, { message: '请求不是有效 JSON。' }) }
}

export function createApp(context: MockContext, config: Config, service?: AIService) {
  const live = config.AI_MODE === 'live' ? service ?? createLiveService(context, config) : undefined
  let activeStreams = 0
  function liveResponse(events: Parameters<typeof eventResponse>[0], signal: AbortSignal) {
    if (activeStreams >= config.MAX_CONCURRENT_STREAMS) throw new HTTPException(429, { message: '模型请求较多，请稍后再试。' })
    activeStreams++
    return eventResponse(events, signal, () => { activeStreams-- })
  }
  const app = new Hono<{ Variables: { requestId: string } }>()
  app.use('*', async (c, next) => {
    c.set('requestId', randomUUID())
    c.header('X-Request-Id', c.get('requestId'))
    const origin = c.req.header('Origin')
    if (origin && !isAllowedOrigin(origin, config)) return c.json({ error: { code: 'ORIGIN_DENIED', message: '来源未被允许。', requestId: c.get('requestId') } }, 403)
    await next()
  })
  app.use('*', cors({ origin: origin => isAllowedOrigin(origin, config) ? origin : undefined, allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type', 'Idempotency-Key'], exposeHeaders: ['X-Request-Id', 'X-Portfolio-Contract'] }))
  app.use('/api/*', bodyLimit({ maxSize: 128 * 1024, onError: c => c.json({ error: { code: 'BODY_TOO_LARGE', message: '请求内容过大。', requestId: c.get('requestId') } }, 413) }))
  app.get('/health', c => c.json({ status: 'ok', mode: config.AI_MODE, contractVersion: '1', knowledgeVersion: context.knowledge.version, articleCount: context.knowledge.articles.length }))
  app.get('/api/articles', c => {
    const query = z.string().max(200).parse(c.req.query('q') || '')
    return c.json({ articles: query ? searchArticles(context.knowledge, query) : context.knowledge.articles.slice(0, 5).map(article => articleSource(article)), simulated: !live })
  })
  app.post('/api/chat', async c => {
    const request = chatRequest.parse(await jsonBody(c.req.raw))
    const turns = request.messages.map(message => ({ role: message.role, content: message.parts.flatMap(part => {
      const parsed = textPart.safeParse(part)
      return parsed.success ? [parsed.data.text] : []
    }).join('\n') })).filter(message => message.content.trim())
    const userMessages = turns.filter(message => message.role === 'user').map(message => message.content)
    const query = z.string().trim().min(1).max(2000).parse(userMessages.at(-1))
    if (live) {
      if (turns.at(-1)?.role !== 'user') throw new HTTPException(400, { message: '最后一条消息必须是用户文本。' })
      return liveResponse(signal => live.chat(turns, signal), c.req.raw.signal)
    }
    return eventResponse(signal => chatEvents(query, context, signal, userMessages.at(-2)), c.req.raw.signal)
  })
  app.post('/api/articles/insights', async c => {
    const { articlePath } = insightRequest.parse(await jsonBody(c.req.raw))
    const article = context.knowledge.articles.find(item => item.path.replace(/\/$/, '') === articlePath.replace(/\/$/, ''))
    if (!article) throw new HTTPException(404, { message: '未找到已发布的文章，请先同步知识库。' })
    if (live) return liveResponse(signal => live.insights(article, signal), c.req.raw.signal)
    return eventResponse(signal => insightEvents(article, context.knowledge.version, context.delayMs, signal), c.req.raw.signal)
  })
  const submissions = new Map<string, { payload: string; id: string; expires: number }>()
  app.post('/api/contact', async c => {
    const submission = contactSchema.parse(await jsonBody(c.req.raw))
    const key = z.string().min(8).max(128).parse(c.req.header('Idempotency-Key'))
    for (const [id, item] of submissions) if (item.expires < Date.now()) submissions.delete(id)
    const payload = JSON.stringify(submission)
    const existing = submissions.get(key)
    if (existing && existing.payload !== payload) throw new HTTPException(409, { message: '该提交标识已用于其他内容。' })
    if (!existing && submissions.size >= 1000) throw new HTTPException(429, { message: '演示提交较多，请稍后再试。' })
    const id = existing?.id || randomUUID()
    submissions.set(key, { id, payload, expires: Date.now() + 5 * 60_000 })
    return c.json({ id, status: 'simulated', simulated: true, message: '模拟提交成功，未发送邮件或机器人通知。' }, 202)
  })
  app.notFound(c => c.json({ error: { code: 'NOT_FOUND', message: '接口不存在。', requestId: c.get('requestId') } }, 404))
  app.onError((error, c) => {
    if (error instanceof z.ZodError) return c.json({ error: { code: 'VALIDATION_ERROR', message: '请求参数不符合接口约定。', requestId: c.get('requestId') } }, 400)
    if (error instanceof HTTPException) return c.json({ error: { code: 'REQUEST_ERROR', message: error.message, requestId: c.get('requestId') } }, error.status)
    console.error('Unhandled request error', c.get('requestId'), error)
    return c.json({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用。', requestId: c.get('requestId') } }, 500)
  })
  return app
}
