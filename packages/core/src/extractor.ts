import type { CommitMeta } from './scanner.js'

export interface ExtractionResult {
  isDecision: boolean       // true = worth logging
  isRejection: boolean      // true = something was tried and reverted
  title: string
  affects: string[]         // file paths or module names
  risk: 'low' | 'medium' | 'high'
  rationale: string         // the "why"
  rejected?: string         // what was abandoned and why
  isDeep: boolean           // true = needs its own ADR file
}

export type LLMProvider = (prompt: string) => Promise<string>

// The prompt sent to the cheap LLM (Haiku/Flash) for each commit batch
export function buildExtractionPrompt(commits: CommitMeta[]): string {
  const commitSummaries = commits.map(c => `
### ${c.date.slice(0, 10)} — ${c.subject}
${c.body ? `Body: ${c.body}` : ''}
Files changed: ${c.diffStat}
${c.tags.length ? `Tags: ${c.tags.join(', ')}` : ''}

\`\`\`diff
${c.diff}
\`\`\`
`).join('\n---\n')

  return `You are analyzing git commits to extract architectural decisions for a development knowledge base.

For each commit, extract:
- Was this an architectural/design decision worth documenting? (skip refactors, typo fixes, dependency bumps)
- What was decided and WHY (the rationale, not just what changed)
- What files/modules are affected
- Risk level: high (many dependents, hard to reverse), medium, low
- Was anything rejected/reverted? If so, why?
- Is this decision complex enough to warrant a full ADR document? (true if: affects 3+ modules, hard to reverse, has rejected alternatives)

Return a JSON array, one object per commit:
[
  {
    "hash": "abc123",
    "isDecision": true,
    "isRejection": false,
    "title": "Switch auth from sessions to JWT",
    "affects": ["auth/", "api/middleware.ts"],
    "risk": "high",
    "rationale": "Sessions required Redis which is not in budget until Q3. JWT allows stateless scaling.",
    "rejected": null,
    "isDeep": true
  }
]

Commits to analyze:
${commitSummaries}

Return only valid JSON. No markdown, no explanation.`
}

export type ExtractionStrategy = 'simple' | 'clustered' | 'two-pass'

// Entry point — strategy is swappable without changing callers
// v1: simple fixed batching (cached by SHA, good enough for bootstrap)
// v2: semantic clustering by file overlap + time proximity (planned)
// v3: two-pass cheap filter + quality model for complex decisions (planned)
export async function extractFromCommits(
  commits: CommitMeta[],
  llm: LLMProvider,
  options: { strategy?: ExtractionStrategy; cache?: ExtractionCache } = {}
): Promise<ExtractionResult[]> {
  const { strategy = 'simple', cache } = options
  const uncached = cache ? commits.filter(c => !cache.has(c.hash)) : commits

  let results: ExtractionResult[]
  switch (strategy) {
    case 'simple':    results = await strategySimple(uncached, llm); break
    case 'clustered': throw new Error('clustered strategy not yet implemented (v2 roadmap)')
    case 'two-pass':  throw new Error('two-pass strategy not yet implemented (v3 roadmap)')
  }

  if (cache) results.forEach((r, i) => cache.set(uncached[i].hash, r))
  return results
}

// v1: fixed batches of 6 commits, capped at 5000 chars of diff per batch
async function strategySimple(commits: CommitMeta[], llm: LLMProvider): Promise<ExtractionResult[]> {
  const BATCH_SIZE = 6
  const MAX_BATCH_CHARS = 5000
  const results: ExtractionResult[] = []

  let batch: CommitMeta[] = []
  let batchChars = 0

  const flush = async () => {
    if (batch.length === 0) return
    const raw = await llm(buildExtractionPrompt(batch))
    results.push(...parseExtractionResponse(raw))
    batch = []
    batchChars = 0
  }

  for (const commit of commits) {
    const size = commit.diff.length
    if (batch.length >= BATCH_SIZE || batchChars + size > MAX_BATCH_CHARS) {
      await flush()
    }
    batch.push(commit)
    batchChars += size
  }
  await flush()

  return results
}

// Cache interface — SHA → result, so commits are never reprocessed
// Concrete implementations: in-memory (tests), JSON file (CLI), SQLite (future)
export interface ExtractionCache {
  has(hash: string): boolean
  get(hash: string): ExtractionResult | undefined
  set(hash: string, result: ExtractionResult): void
}

export function parseExtractionResponse(raw: string): ExtractionResult[] {
  try {
    const json = JSON.parse(raw.trim())
    return Array.isArray(json) ? json : []
  } catch {
    // LLM sometimes wraps in markdown code blocks despite instructions
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) {
      try { return JSON.parse(match[1]) } catch { /* fall through */ }
    }
    return []
  }
}
