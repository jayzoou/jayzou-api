import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { DefaultChatTransport, readUIMessageStream } from 'ai'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { loadKnowledge, loadProfile } from '../dist/knowledge.js'

// Explicit, opt-in smoke check: makes paid provider requests; never part of CI.
const config = readConfig(process.env)
assert.equal(config.AI_MODE, 'live', 'Set AI_MODE=live before running this check')
const knowledge = await loadKnowledge(resolve(config.KNOWLEDGE_FILE))
const profile = await loadProfile(resolve(config.PROFILE_FILE))
const app = createApp({ knowledge, profile, delayMs: 0 }, config)

async function reply(api, text, body = {}) {
  const transport = new DefaultChatTransport({ api: `http://local${api}`, body, fetch: async (input, init) => app.request(input, init) })
  const stream = await transport.sendMessages({ trigger: 'submit-message', chatId: 'live-smoke', messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text }] }], abortSignal: AbortSignal.timeout(config.LLM_TIMEOUT_MS + 5000) })
  let result
  for await (const message of readUIMessageStream({ stream, terminateOnError: true })) result = message
  assert.equal(result?.metadata?.simulated, false, 'Expected a real model response')
  return result
}

try {
  const chat = await reply('/api/chat', '请调用 showResumeSection 展示 Jay 的技能，并简要说明尚未填写的内容，不要猜测。')
  assert.ok(chat.parts.some(part => part.type === 'text' && part.text.trim()), 'Expected model-generated text')
  assert.ok(chat.parts.some(part => part.type === 'tool-showResumeSection' && part.state === 'output-available' && part.output.simulated === false), 'Expected a completed resume tool call')
  console.log('PASS: real model text, function calling, UI message stream')
  const article = knowledge.articles.find(item => item.sections.some(section => section.text.trim()))
  assert.ok(article, 'Import knowledge before testing live insights')
  const insight = await reply('/api/articles/insights', '生成导读', { articlePath: article.path })
  assert.ok(insight.parts.some(part => part.type === 'data-insight' && part.data.simulated === false && part.data.articlePath === article.path), 'Expected validated model-generated insights')
  console.log('PASS: real model insights, validated mindmap, server-owned sources')
} catch {
  console.error('Live smoke failed. Check provider credentials, model availability and knowledge configuration.')
  process.exitCode = 1
}
