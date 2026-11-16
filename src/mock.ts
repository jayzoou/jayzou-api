import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { UIMessageChunk } from 'ai'
import { articleSource, searchArticles } from './knowledge.js'
import { debounceDemo } from './demo.js'
import { insightSchema } from './contracts.js'
import type { Knowledge, Profile, Section } from './contracts.js'

export interface MockContext { knowledge: Knowledge; profile: Profile; delayMs: number }

export { eventResponse } from './stream.js'

async function* textEvents(text: string, delayMs: number, signal: AbortSignal): AsyncGenerator<UIMessageChunk> {
  const id = randomUUID()
  yield { type: 'text-start', id }
  for (const chunk of text.match(/[\s\S]{1,16}/gu) || []) {
    if (signal.aborted) return
    if (delayMs) await delay(delayMs, undefined, { signal })
    yield { type: 'text-delta', id, delta: chunk }
  }
  yield { type: 'text-end', id }
}

function* toolEvents(name: string, input: unknown, output: unknown): Generator<UIMessageChunk> {
  const toolCallId = randomUUID()
  yield { type: 'tool-input-start', toolCallId, toolName: name }
  yield { type: 'tool-input-available', toolCallId, toolName: name, input }
  yield { type: 'tool-output-available', toolCallId, output }
}

export async function* chatEvents(query: string, context: MockContext, signal: AbortSignal, previousQuery = ''): AsyncGenerator<UIMessageChunk> {
  yield { type: 'start', messageId: randomUUID(), messageMetadata: { simulated: true, contractVersion: '1' } }
  yield { type: 'start-step' }
  const question = /继续|刚才|这篇|它的/.test(query) ? `${previousQuery} ${query}` : query
  if (/^(你好|您好|hello|hi)[！!。,.，\s]*$/i.test(question)) {
    yield* textEvents('你好，我是 Jay 的数字助手。你可以询问公开简历、查找站内文章，或让我展示一个 React 防抖 Demo。当前为演示模式。', context.delayMs, signal)
  } else if (/联系|留言|offer|招聘|邮箱/i.test(question)) {
    yield* textEvents('可以在下面留下联系信息。目前为演示模式，提交不会发送通知。', context.delayMs, signal)
    yield* toolEvents('sendOfferOrMessage', {}, { title: '联系 Jay', simulated: true })
  } else if (/demo|防抖|沙盒|写.*组件|运行.*代码/i.test(question)) {
    yield* textEvents('这是预设的 React 防抖示例。打开面板后可编辑代码，再点击运行预览。', context.delayMs, signal)
    yield* toolEvents('openInteractiveDemo', { topic: question }, debounceDemo)
  } else if (/简历|履历|经历|技能|技术栈|教育|项目|介绍.*你|介绍.*Jay/i.test(question)) {
    const section: Section = /技能|技术栈/.test(question) ? 'skills' : /教育/.test(question) ? 'education' : /项目/.test(question) ? 'projects' : /经历|履历/.test(question) ? 'experience' : 'overview'
    yield* textEvents(context.profile.intro + '\n\n以下内容来自公开资料。尚未填写的经历会显示为空，演示回复不会补写履历。', context.delayMs, signal)
    yield* toolEvents('showResumeSection', { section }, { section, profile: context.profile, simulated: true })
  } else {
    const generic = /^(有哪些博客|推荐文章|看看博客|博客文章)[？?！!。\s]*$/.test(question)
    const found = generic ? context.knowledge.articles.slice(0, 5).map(article => articleSource(article)) : searchArticles(context.knowledge, question)
    if (found.length) {
      yield* textEvents('我找到了这些站内文章。下面是匹配到的原文摘录，可以打开来源继续阅读。', context.delayMs, signal)
      yield* toolEvents('recommendArticles', { query: question }, { articles: found, simulated: true })
      for (const source of found) yield { type: 'source-url', sourceId: source.path + source.anchor, url: source.path + (source.anchor ? `#${source.anchor}` : ''), title: source.title }
    } else {
      yield* textEvents(context.knowledge.articles.length
        ? '目前没有找到匹配的站内内容。可以试试“闭包”“事件循环”，或询问我的简历、项目与联系方式。\n\n当前使用规则检索与模拟回答，尚未接入真实大模型。'
        : '文章知识库尚未导入。可以先查看简历资料或体验防抖 Demo；导入博客构建的知识文件后即可查询正文。', context.delayMs, signal)
    }
  }
  yield { type: 'finish-step' }
  yield { type: 'finish', finishReason: 'stop' }
}

export async function* insightEvents(article: Knowledge['articles'][number], version: string, delayMs: number, signal: AbortSignal): AsyncGenerator<UIMessageChunk> {
  yield { type: 'start', messageId: randomUUID() }
  yield { type: 'data-progress', data: { label: '正在提取文章章节…' }, transient: true }
  if (delayMs) await delay(delayMs * 5, undefined, { signal })
  const sections = article.sections.filter(section => section.text.trim())
  const excerpts = sections.slice(0, 3).map(section => section.text.slice(0, 180))
  const result = insightSchema.parse({
    articlePath: article.path, contentVersion: version, simulated: true,
    points: [excerpts[0] || article.description, excerpts[1] || article.description, excerpts[2] || '更多细节请通过下方来源阅读原文。'],
    nodes: [{ id: 'n0', label: article.title.slice(0, 100), parentId: null }, ...sections.slice(0, 5).map((section, i) => ({ id: `n${i + 1}`, label: section.heading.slice(0, 100), parentId: 'n0' }))],
    sources: sections.slice(0, 3).map(section => articleSource(article, section)),
  })
  yield { type: 'data-insight', data: result }
  yield { type: 'finish', finishReason: 'stop' }
}
