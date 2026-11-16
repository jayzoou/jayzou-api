import { readFile } from 'node:fs/promises'
import { knowledgeSchema, profileSchema } from './contracts.js'
import type { Knowledge, Source } from './contracts.js'

export async function loadKnowledge(filename: string): Promise<Knowledge> {
  try { return knowledgeSchema.parse(JSON.parse(await readFile(filename, 'utf8'))) }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { version: 'unconfigured', articles: [] }
    throw error
  }
}
export async function loadProfile(filename: string) {
  return profileSchema.parse(JSON.parse(await readFile(filename, 'utf8')))
}

export function articleSource(article: Knowledge['articles'][number], section = article.sections[0]): Source {
  return { path: article.path, title: article.title, description: article.description, anchor: section?.anchor || '', excerpt: (section?.text || article.description).slice(0, 350) }
}

export function searchArticles(knowledge: Knowledge, query: string): Source[] {
  const normalized = query.toLowerCase()
  const aliases: Record<string, string[]> = { '闭包': ['closure'], '事件循环': ['event loop', 'event_loop'], '防抖': ['debounce'] }
  const terms = new Set(normalized.match(/[a-z_]+|[\u4e00-\u9fff]{2,}/g) || [])
  const stop = new Set(['什么', '怎么', '如何', '哪些', '文章', '博客', '相关', '介绍', '一下', '有没有', '有哪些'])
  for (const run of normalized.match(/[\u4e00-\u9fff]+/g) || []) {
    for (let size = 2; size <= Math.min(6, run.length); size++) {
      for (let start = 0; start <= run.length - size; start++) {
        const term = run.slice(start, start + size)
        if (!stop.has(term)) terms.add(term)
      }
    }
  }
  for (const [key, values] of Object.entries(aliases)) if ([key, ...values].some(term => normalized.includes(term))) [key, ...values].forEach(term => terms.add(term))
  const score = (value: string) => [...terms].reduce((sum, term) => sum + (value.toLowerCase().includes(term) ? term.length : 0), 0)
  return knowledge.articles.map(article => {
    const sections = article.sections.map(section => ({ section, score: score(section.heading) * 3 + score(section.text) })).sort((a, b) => b.score - a.score)
    const titleMatch = normalized.includes(article.title.toLowerCase()) ? 30 : 0
    return { source: articleSource(article, sections[0]?.section), score: titleMatch + score(article.title) * 5 + score(article.description) * 2 + (sections[0]?.score || 0) }
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map(item => item.source)
}
