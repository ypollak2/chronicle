/**
 * Lightweight debug logger for Chronicle CLI.
 *
 * Enable with: CHRONICLE_DEBUG=1 chronicle init
 * or:          chronicle init --debug  (sets env var before calling commands)
 *
 * Output goes to stderr so it doesn't corrupt inject/verify JSON output.
 */

const isDebug = () => Boolean(process.env.CHRONICLE_DEBUG)

export function debug(tag: string, msg: string, data?: unknown): void {
  if (!isDebug()) return
  const ts = new Date().toISOString().slice(11, 23)  // HH:MM:SS.mmm
  const dataStr = data !== undefined ? ' ' + JSON.stringify(data) : ''
  process.stderr.write(`[chronicle:${tag}] ${ts} ${msg}${dataStr}\n`)
}

export function debugEnabled(): boolean {
  return isDebug()
}
