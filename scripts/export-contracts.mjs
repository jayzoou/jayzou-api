import { readFile, writeFile } from 'node:fs/promises'

const destination = process.argv[2]
if (!destination) throw new Error('Usage: npm run export:contracts -- /path/to/frontend/src/lib/ai/contracts.ts')
const source = await readFile(new URL('../src/contracts.ts', import.meta.url), 'utf8')
await writeFile(destination, '// Generated from jayzou-api/src/contracts.ts. Run export:contracts to update.\n' + source)
console.log(`Exported API contract v1 to ${destination}`)
