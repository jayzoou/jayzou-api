import { createUIMessageStreamResponse, type UIMessageChunk } from 'ai'

type Events = AsyncGenerator<UIMessageChunk>

// Pass the combined signal into upstream work so canceling a browser response
// also stops model requests, including while waiting for the next token.
export function eventResponse(source: Events | ((signal: AbortSignal) => Events), requestSignal: AbortSignal, onClose = () => {}) {
  const controller = new AbortController()
  const signal = AbortSignal.any([requestSignal, controller.signal])
  const events = typeof source === 'function' ? source(signal) : source
  let stopped = false
  let output: ReadableStreamDefaultController<UIMessageChunk>
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    requestSignal.removeEventListener('abort', onAbort)
    onClose()
  }
  const stop = () => {
    stopped = true
    controller.abort()
    cleanup()
    void events.return(undefined).catch(() => {})
  }
  const onAbort = () => { if (!stopped) { stop(); output.close() } }
  const stream = new ReadableStream<UIMessageChunk>({
    start(value) {
      output = value
      requestSignal.addEventListener('abort', onAbort, { once: true })
      if (requestSignal.aborted) onAbort()
    },
    async pull(value) {
      try {
        if (stopped) return
        const next = await events.next()
        if (stopped) return
        if (next.done) { stopped = true; cleanup(); value.close() }
        else value.enqueue(next.value)
      } catch {
        if (stopped) return
        stop()
        value.enqueue({ type: 'error', errorText: '回复中断，请稍后重试。' })
        value.close()
      }
    },
    cancel: stop,
  })
  return createUIMessageStreamResponse({ stream, headers: { 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', 'X-Portfolio-Contract': '1' } })
}
