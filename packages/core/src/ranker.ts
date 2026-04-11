/**
 * Relevance ranker for chronicle inject output.
 *
 * Scores each decision table row against the current working context
 * (targeted files + recent files) using a pure heuristic — no embeddings.
 * Phase 2 (v0.7.0) will replace the heuristic score with a weighted
 * combination of semantic similarity + heuristic.
 */

export interface ScoredRow {
  line: string
  score: number
}

/**
 * Parse decisions.md into header lines + data rows.
 * Returns { header, rows } so we can re-sort rows while keeping header intact.
 */
export function parseDecisionsTable(content: string): { header: string; rows: ScoredRow[] } {
  const lines = content.split('\n')
  const headerLines: string[] = []
  const dataRows: string[] = []
  let inTable = false

  for (const line of lines) {
    if (!inTable) {
      headerLines.push(line)
      // The separator row marks start of data
      if (/^\|[-| ]+\|/.test(line)) inTable = true
    } else if (line.startsWith('|')) {
      dataRows.push(line)
    } else {
      headerLines.push(line)   // trailing content after table
    }
  }

  return {
    header: headerLines.join('\n'),
    rows: dataRows.map(line => ({ line, score: 0 })),
  }
}

/**
 * Score a single decision row against the working context.
 *
 * Signals used (heuristic, v0.6.x):
 *  +3 per direct file match (--files argument matches row's affects column)
 *  +1 per recently-touched file match
 *  +2 for high-risk, +1 for medium-risk
 *  -age/365  age decay (older decisions score slightly lower)
 *  +confidence  bonus for high-confidence extractions
 */
export function scoreRow(row: string, opts: {
  files?: string[]
  recentFiles?: string[]
}): number {
  let score = 0

  // File relevance
  const { files = [], recentFiles = [] } = opts
  score += files.filter(f => row.includes(f)).length * 3
  score += recentFiles.filter(f => row.includes(f)).length

  // Risk bonus
  if (row.includes('| high |') || row.includes('| high|')) score += 2
  else if (row.includes('| medium |') || row.includes('| medium|')) score += 1

  // Age decay — extract YYYY-MM-DD from first column
  const dateMatch = row.match(/\|\s*(\d{4}-\d{2}-\d{2})\s*\|/)
  if (dateMatch) {
    const ageDays = (Date.now() - new Date(dateMatch[1]).getTime()) / 86_400_000
    score -= ageDays / 365
  }

  // Confidence bonus — extract from HTML comment
  const confMatch = row.match(/<!-- confidence:([\d.]+) -->/)
  if (confMatch) score += parseFloat(confMatch[1])

  return score
}

/**
 * Rank decision rows by relevance and return the top N (or all if topN=0).
 * Header lines are always preserved verbatim.
 */
export function rankDecisions(content: string, opts: {
  files?: string[]
  recentFiles?: string[]
  topN?: number
}): string {
  const { header, rows } = parseDecisionsTable(content)
  if (rows.length === 0) return content

  const scored = rows.map(r => ({
    ...r,
    score: scoreRow(r.line, opts),
  }))

  scored.sort((a, b) => b.score - a.score)

  const kept = opts.topN && opts.topN > 0 ? scored.slice(0, opts.topN) : scored

  return header + '\n' + kept.map(r => r.line).join('\n')
}

/**
 * Estimate token count (rough: 4 chars ≈ 1 token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Trim sections to fit within a token budget.
 * Always keeps rejections and risks (small, high signal).
 * Trims decisions table first, then evolution, then sessions.
 */
export function trimToTokenBudget(sections: string[], maxTokens: number): string[] {
  const total = sections.reduce((s, c) => s + estimateTokens(c), 0)
  if (total <= maxTokens) return sections

  // Build output greedily, keeping highest-priority sections first
  const out: string[] = []
  let remaining = maxTokens

  for (const section of sections) {
    const t = estimateTokens(section)
    if (remaining <= 0) break
    if (t <= remaining) {
      out.push(section)
      remaining -= t
    } else {
      // Partial: truncate to fit
      const chars = remaining * 4
      out.push(section.slice(0, chars) + '\n…(truncated to fit token budget)')
      remaining = 0
    }
  }

  return out
}
