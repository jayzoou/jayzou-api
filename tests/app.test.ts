import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { serve } from '@hono/node-server'
import { DefaultChatTransport, readUIMessageStream, type UIMessageChunk } from 'ai'
import { createApp } from '../src/app.js'
import { readConfig } from '../src/config.js'
import { insightSchema, type Knowledge, type PortfolioMessage, type Profile } from '../src/contracts.js'
import { eventResponse } from '../src/mock.js'

const profile: Profile = { name: 'Test author', intro: '仅测试数据', skills: [], experience: [], education: [], projects: [], links: [] }
const knowledge: Knowledge = {
  version: 'fixture-v1', articles: [{ path: '/posts/test/example/', title: '闭包', description: '作用域笔记', category: '测试', sections: [
    { heading: '介绍', anchor: 'heading-0', text: '保管柜保存私有状态。' },
    { heading: '例子', anchor: 'heading-1', text: '函数返回另一个函数。' },
    { heading: '应用', anchor: 'heading-2', text: '计数器可以通过闭包封装变量。' },
  ] }],
}
const config = readConfig({ MOCK_CHUNK_DELAY_MS: '0' })
const app = createApp({ profile, knowledge, delayMs: 0 }, config)
const json = (data: unknown, headers: Record<string, string> = {}): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) })
const messages = (query: string): PortfolioMessage[] => [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: query }] }]

async function reply(query: string, api = '/api/chat', body: Record<string, string> = {}) {
  const transport = new DefaultChatTransport<PortfolioMessage>({
    api: `http://local${api}`, body,
    fetch: async (input, init) => {
      const response = await app.request(input, init)
      if (!response.body) return response
      // Split at every byte, including inside UTF-8 and SSE framing.
      return new Response(response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) { for (let i = 0; i < chunk.length; i++) controller.enqueue(chunk.subarray(i, i + 1)) },
      })), { headers: response.headers, status: response.status })
    },
  })
  const stream = await transport.sendMessages({ trigger: 'submit-message', chatId: 'test', messageId: undefined, messages: messages(query), abortSignal: undefined })
  let result: PortfolioMessage | null = null
  for await (const message of readUIMessageStream<PortfolioMessage>({ stream, terminateOnError: true })) result = message
  assert.ok(result)
  return result
}

test('health and origin policy are explicit', async () => {
  const response = await app.request('/health', { headers: { Origin: 'http://localhost:5000' } })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5000')
  assert.ok(response.headers.get('x-request-id'))
  assert.equal((await response.json()).articleCount, 1)
  assert.equal((await app.request('/health', { headers: { Origin: 'https://untrusted.example' } })).status, 403)
})
test('configuration rejects unsupported modes and invalid ports', () => {
  assert.throws(() => readConfig({ AI_MODE: 'live' }))
  assert.throws(() => readConfig({ PORT: '0' }))
  assert.throws(() => readConfig({ ALLOWED_ORIGINS: 'not-a-url' }))
  assert.throws(() => readConfig({ NODE_ENV: 'unsupported' }))
})
test('development accepts changing loopback ports for POST and CORS preflight', async () => {
  for (const origin of ['http://localhost:5002', 'http://127.0.0.1:5012', 'http://[::1]:5003']) {
    const response = await app.request('/api/chat', json({ messages: messages('你好') }, { Origin: origin }))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('access-control-allow-origin'), origin)
    assert.match(response.headers.get('content-type') || '', /text\/event-stream/)
    assert.match(await response.text(), /data: \[DONE\]/)
    const preflight = await app.request('/api/chat', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin)
  }
})
test('development rejects lookalike domains, opaque origins and URLs with credentials or paths', async () => {
  for (const origin of ['http://localhost.evil.example:5002', 'http://127.0.0.1.evil.example', 'null', 'http://user@localhost:5002', 'http://localhost:5002/path', 'http://localhost:5002?query=1']) {
    const response = await app.request('/api/chat', json({ messages: messages('你好') }, { Origin: origin }))
    assert.equal(response.status, 403, origin)
  }
})
test('production and test only accept the configured origin allowlist', async () => {
  for (const mode of ['production', 'test']) {
    const restricted = createApp({ profile, knowledge, delayMs: 0 }, readConfig({ NODE_ENV: mode, ALLOWED_ORIGINS: 'https://jayzou.me' }))
    for (const origin of ['http://localhost:5002', 'http://127.0.0.1:5002', 'http://[::1]:5002', 'https://untrusted.example']) {
      assert.equal((await restricted.request('/health', { headers: { Origin: origin } })).status, 403)
    }
    const response = await restricted.request('/health', { headers: { Origin: 'https://jayzou.me' } })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://jayzou.me')
  }
})
test('invalid JSON, media types, requests and oversized bodies fail before streaming', async () => {
  assert.equal((await app.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400)
  assert.equal((await app.request('/api/chat', { method: 'POST', body: '{}' })).status, 415)
  assert.equal((await app.request('/api/chat', json({ messages: [] }))).status, 400)
  assert.equal((await app.request('/api/chat', json({ messages: messages(' ') }))).status, 400)
  assert.equal((await app.request('/api/chat', json({ messages: messages('hello'), contractVersion: '2' }))).status, 400)
  assert.equal((await app.request('/api/chat', json({ ignored: 'x'.repeat(130 * 1024) }))).status, 413)
})
test('body-only search hits preserve real source anchors', async () => {
  const response = await app.request('/api/articles?q=' + encodeURIComponent('保管柜'))
  const result = await response.json()
  assert.equal(result.articles[0].path, '/posts/test/example/')
  assert.equal(result.articles[0].anchor, 'heading-0')
  assert.match(result.articles[0].excerpt, /保管柜/)
})
test('AI SDK consumes fragmented Chinese text and tool lifecycle', async () => {
  const message = await reply('有哪些关于闭包的文章？')
  assert.ok(message.parts.some(part => part.type === 'text' && part.text.includes('原文摘录')))
  const part = message.parts.find(part => part.type === 'tool-recommendArticles')
  assert.ok(part?.type === 'tool-recommendArticles' && part.state === 'output-available')
  assert.equal(part.output.articles[0]?.anchor, 'heading-2')
  assert.match(part.output.articles[0]?.excerpt || '', /闭包封装变量/)
  assert.ok(message.parts.some(part => part.type === 'source-url'))
})
test('missing resume fields stay empty; demo and contact only return UI data', async () => {
  const resume = (await reply('你的技能栈是什么')).parts.find(part => part.type === 'tool-showResumeSection')
  assert.ok(resume?.type === 'tool-showResumeSection' && resume.state === 'output-available')
  assert.deepEqual(resume.output.profile.skills, [])
  assert.ok((await reply('写一个防抖组件')).parts.some(part => part.type === 'tool-openInteractiveDemo' && part.state === 'output-available'))
  assert.ok((await reply('如何联系你')).parts.some(part => part.type === 'tool-sendOfferOrMessage' && part.state === 'output-available'))
})
test('insights use the requested published body, version and validated final object', async () => {
  const message = await reply('生成导读', '/api/articles/insights', { articlePath: '/posts/test/example' })
  const part = message.parts.find(part => part.type === 'data-insight')
  assert.ok(part?.type === 'data-insight')
  const result = insightSchema.parse(part.data)
  assert.equal(result.points.length, 3)
  assert.equal(result.contentVersion, 'fixture-v1')
  assert.equal(result.sources[1]?.anchor, 'heading-1')
  assert.equal((await app.request('/api/articles/insights', json({ articlePath: '/posts/missing' }))).status, 404)
})
test('mock contact validates payloads and has bounded, payload-aware idempotency', async () => {
  const contact = { name: 'Visitor', email: 'visitor@example.com', message: '测试联系表单' }
  const headers = { 'Idempotency-Key': 'request-key-123' }
  const first = await app.request('/api/contact', json(contact, headers))
  assert.equal(first.status, 202)
  const result = await first.json()
  assert.equal(result.simulated, true)
  assert.equal((await (await app.request('/api/contact', json(contact, headers))).json()).id, result.id)
  assert.equal((await app.request('/api/contact', json({ ...contact, message: '修改后的联系内容' }, headers))).status, 409)
  assert.equal((await app.request('/api/contact', json({ ...contact, email: 'bad' }, { 'Idempotency-Key': 'another-key' }))).status, 400)
})
test('structured mindmaps reject cycles and missing parents', () => {
  const base = { articlePath: '/posts/test/example/', contentVersion: 'v1', points: ['a', 'b', 'c'], sources: [], simulated: true }
  assert.equal(insightSchema.safeParse({ ...base, nodes: [{ id: 'n0', label: 'root', parentId: null }, { id: 'n1', label: 'cycle', parentId: 'n2' }, { id: 'n2', label: 'cycle', parentId: 'n1' }] }).success, false)
  assert.equal(insightSchema.safeParse({ ...base, nodes: [{ id: 'n0', label: 'root', parentId: null }, { id: 'n1', label: 'missing', parentId: 'n9' }] }).success, false)
})
test('canceling the response closes the event producer', async () => {
  let resolveClosed: () => void = () => {}
  const closed = new Promise<void>(resolve => { resolveClosed = resolve })
  async function* producer(): AsyncGenerator<UIMessageChunk> {
    try { while (true) yield { type: 'text-delta', id: 't', delta: '测试' } }
    finally { resolveClosed() }
  }
  const response = eventResponse(producer(), new AbortController().signal)
  const reader = response.body!.getReader()
  await reader.read()
  await reader.cancel()
  await closed
})
test('Node adapter serves a real HTTP SSE response', async () => {
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  try {
    if (!server.listening) await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, json({ messages: messages('闭包') }))
    assert.match(response.headers.get('content-type') || '', /text\/event-stream/)
    assert.equal(response.headers.get('x-vercel-ai-ui-message-stream'), 'v1')
    assert.match(await response.text(), /data: \[DONE\]/)
  } finally { if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})
