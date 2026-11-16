import type { Config } from './config.js'

export type OriginConfig = Pick<Config, 'NODE_ENV' | 'ALLOWED_ORIGINS'>

export function isAllowedOrigin(origin: string, config: OriginConfig): boolean {
  if (config.ALLOWED_ORIGINS.includes(origin)) return true
  if (config.NODE_ENV !== 'development') return false
  try {
    const url = new URL(origin)
    return url.origin === origin && ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch { return false }
}
