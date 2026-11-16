import { readFile, writeFile } from 'node:fs/promises'

const source = process.argv[2]
if (!source) throw new Error('Usage: npm run import:knowledge -- /path/to/blog/dist/ai/knowledge.json')
const { knowledgeSchema } = await import('../dist/contracts.js')
const knowledge = knowledgeSchema.parse(JSON.parse(await readFile(source, 'utf8')))
await writeFile(new URL('../data/knowledge.json', import.meta.url), JSON.stringify(knowledge))
console.log(`Imported ${knowledge.articles.length} published articles (${knowledge.version})`)
