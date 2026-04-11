import { execSync } from 'child_process'

/**
 * Map of repo-relative file path → most recent commit timestamp (Unix ms).
 * Built from a single git log call — cheap even for large repos.
 */
export type FileModMap = Map<string, number>

/**
 * Build a file modification map from a single git log call.
 * Returns the most recent commit timestamp for every file touched in the last `sinceDays` days.
 */
export function buildFileModMap(repoRoot: string, sinceDays = 730): FileModMap {
  const map: FileModMap = new Map()
  try {
    const raw = execSync(
      `git -C "${repoRoot}" log --since="${sinceDays} days ago" --name-only --pretty=format:"%at"`,
      { maxBuffer: 10 * 1024 * 1024 }
    ).toString()

    let currentTs = 0
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      const ts = parseInt(trimmed, 10)
      if (!isNaN(ts) && ts > 1_000_000_000) {
        currentTs = ts * 1000  // Unix seconds → ms
      } else if (trimmed && currentTs > 0) {
        const existing = map.get(trimmed)
        if (!existing || currentTs > existing) {
          map.set(trimmed, currentTs)
        }
      }
    }
  } catch { /* not a git repo or git unavailable */ }
  return map
}

export interface StaleDecision {
  title: string
  date: string       // YYYY-MM-DD of the decision
  affects: string[]  // files/modules in the affects column
}

/**
 * Decisions older than this threshold (days) are candidates for staleness checks.
 * Very recent decisions are never flagged — they can't be stale yet.
 */
const MIN_DECISION_AGE_DAYS = 60

/**
 * Annotate a decisions.md table string with <!-- stale --> markers.
 * A row is stale when:
 *   - The decision is older than MIN_DECISION_AGE_DAYS
 *   - At least one affected file has been modified AFTER the decision date
 *
 * Returns the annotated content and a list of stale decisions for summary output.
 */
export function annotateStaleDecisions(
  content: string,
  modMap: FileModMap
): { annotated: string; stale: StaleDecision[] } {
  const stale: StaleDecision[] = []
  const now = Date.now()

  const annotated = content.split('\n').map(line => {
    if (!line.startsWith('|')) return line
    if (/^\|[-| ]+\|/.test(line)) return line          // separator row
    if (line.includes('<!-- stale -->')) return line   // already marked

    const cols = line.split('|').map(c => c.trim())
    // cols[0] = '' (before first |), cols[1] = date, cols[2] = title, cols[3] = affects
    const dateStr = cols[1] ?? ''
    const title   = cols[2] ?? ''
    const affects = (cols[3] ?? '').split(',').map(f => f.trim()).filter(Boolean)

    if (!dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return line
    if (affects.length === 0) return line

    const decisionMs = new Date(dateStr).getTime()
    const ageDays    = (now - decisionMs) / 86_400_000
    if (ageDays < MIN_DECISION_AGE_DAYS) return line

    // Check whether any affected path prefix matches a recently modified file
    const isStale = affects.some(pattern => {
      for (const [file, fileTs] of modMap) {
        if (file.startsWith(pattern) || file.includes(pattern)) {
          if (fileTs > decisionMs) return true
        }
      }
      return false
    })

    if (isStale) {
      stale.push({ title, date: dateStr, affects })
      return line + ' <!-- stale -->'
    }
    return line
  }).join('\n')

  return { annotated, stale }
}

/**
 * Format stale decisions as a compact warning block for inject output.
 */
export function formatStaleWarning(stale: StaleDecision[]): string {
  if (stale.length === 0) return ''
  const items = stale.map(d =>
    `- **${d.date}**: ${d.title.slice(0, 60)} _(affects: ${d.affects.slice(0, 2).join(', ')}${d.affects.length > 2 ? ', …' : ''})_`
  ).join('\n')
  return `## ⚠️ Potentially Stale Decisions\n\nThese decisions reference files that have changed significantly since they were recorded. Treat them as possibly outdated:\n\n${items}\n`
}
