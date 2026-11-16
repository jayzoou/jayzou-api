import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const npm = process.env.npm_config_user_agent?.match(/^npm\/([\d.]+)/)?.[1]
const supported = (version, minimum) => {
  if (!version) return false
  const actual = version.split('.').map(Number)
  const expected = minimum.split('.').map(Number)
  if (actual.length !== 3 || actual.some(Number.isNaN) || actual[0] !== expected[0]) return false
  for (let i = 1; i < 3; i++) if (actual[i] !== expected[i]) return actual[i] > expected[i]
  return true
}
if (!supported(process.versions.node, '22.22.2') || !supported(npm, '10.9.7')) {
  console.error(`Use Node ${pkg.engines.node} and npm ${pkg.engines.npm}. Run nvm use.`)
  process.exitCode = 1
}
