import type { CommitMeta } from './scanner.js'

export interface ExtractionResult {
  hash?: string             // commit SHA from LLM response — used for cache keying
  date?: string             // YYYY-MM-DD from CommitMeta (populated after extraction)
  isDecision: boolean       // true = worth logging
  isRejection: boolean      // true = something was tried and reverted
  title: string
  affects: string[]         // file paths or module names
  risk: 'low' | 'medium' | 'high'
  confidence: number        // 0.0–1.0 how certain the LLM is this is architectural
  rationale: string         // the "why"
  rejected?: string         // what was abandoned and why
  isDeep: boolean           // true = needs its own ADR file
}

export type LLMProvider = (prompt: string) => Promise<string>

// The prompt sent to the cheap LLM (Haiku/Flash) for each commit batch
export function buildExtractionPrompt(commits: CommitMeta[], opts: { truncated?: boolean } = {}): string {
  const commitSummaries = commits.map(c => `
### ${c.date.slice(0, 10)} — ${c.subject}
Hash: ${c.hash.slice(0, 7)}
${c.body ? `Body: ${c.body}` : ''}
Files changed: ${c.diffStat}
${c.tags.length ? `Tags: ${c.tags.join(', ')}` : ''}

\`\`\`diff
${c.diff}
\`\`\`
`).join('\n---\n')

  const truncationNote = opts.truncated
    ? '\nNOTE: Some diffs were truncated due to size. Base your analysis on the subject, body, and visible diff only.\n'
    : ''

  return `You are analyzing git commits to extract architectural decisions for a development knowledge base.

For each commit, extract:
- Was this an architectural/design decision worth documenting? (skip refactors, typo fixes, dependency bumps, version bumps, whitespace)
- What was decided and WHY (the rationale, not just what changed)
- What files/modules are affected
- Risk level: high (many dependents, hard to reverse), medium, low
- Was anything rejected/reverted? If so, why?
- Is this decision complex enough to warrant a full ADR document? (true if: affects 3+ modules, hard to reverse, has rejected alternatives)
- Confidence: how certain are you this is a genuine architectural decision? (0.0 = refactor/bump/chore, 1.0 = clearly architectural with explicit rationale)

## Worked examples

### Example 1 — genuine architectural decision
Commit: "switch task queue from in-memory to Redis"
Body: "In-process queue lost jobs on crash. Evaluated RabbitMQ but ops didn't want another broker."
Files: workers/queue.ts, config/redis.ts, docker-compose.yml
→ Output:
{"hash":"a1b2c3d","isDecision":true,"isRejection":false,"title":"Switch task queue from in-memory to Redis","affects":["workers/queue.ts","config/redis.ts"],"risk":"high","confidence":0.95,"rationale":"In-process queue lost jobs on crash; Redis provides durability and horizontal scale. RabbitMQ was rejected — ops overhead.","rejected":null,"isDeep":true}

### Example 2 — rejected approach / revert
Commit: "revert: remove GraphQL layer added in #42"
Body: "Team velocity dropped 40% due to schema maintenance. Back to REST."
Files: src/api/graphql.ts, src/api/resolvers/
→ Output:
{"hash":"d4e5f6a","isDecision":false,"isRejection":true,"title":"Revert GraphQL API layer","affects":["src/api/"],"risk":"medium","confidence":0.88,"rationale":"","rejected":"GraphQL removed: schema maintenance overhead cut team velocity 40%. Reverted to REST.","isDeep":false}

### Example 3 — noise commit (skip)
Commit: "fix typo in README"
Body: ""
Files: README.md
→ Output:
{"hash":"b7c8d9e","isDecision":false,"isRejection":false,"title":"","affects":[],"risk":"low","confidence":0.02,"rationale":"","rejected":null,"isDeep":false}

## Commits to analyze
${truncationNote}
${commitSummaries}

Return a JSON array with one object per commit, in the same order as the commits above.
Return only valid JSON. No markdown fences, no explanation outside the array.`
}

export type ExtractionStrategy = 'simple' | 'clustered' | 'two-pass'

// Entry point — strategy is swappable without changing callers
// v1: simple fixed batching (cached by SHA, good enough for bootstrap)
// v2: semantic clustering by file overlap (ships in v0.4.0)
// v3: two-pass cheap filter + quality model for complex decisions (planned)
export async function extractFromCommits(
  commits: CommitMeta[],
  llm: LLMProvider,
  options: { strategy?: ExtractionStrategy; cache?: ExtractionCache; concurrency?: number } = {}
): Promise<ExtractionResult[]> {
  const { strategy = 'simple', cache, concurrency = 4 } = options
  const uncached = cache ? commits.filter(c => !cache.has(c.hash)) : commits

  let results: ExtractionResult[]
  switch (strategy) {
    case 'simple':    results = await strategySimple(uncached, llm, concurrency); break
    case 'clustered': results = await strategyClustered(uncached, llm, concurrency); break
    case 'two-pass':  throw new Error('two-pass strategy not yet implemented (v3 roadmap)')
  }

  // Enrich results: populate date from CommitMeta and default missing confidence
  const commitsByHash = new Map(commits.map(c => [c.hash, c]))
  results.forEach((r, i) => {
    const commit = (r.hash ? commitsByHash.get(r.hash) : null) ?? uncached[i]
    if (commit) {
      r.date = commit.date.slice(0, 10)
      r.hash ??= commit.hash
    }
    r.confidence ??= 1.0   // old cache entries without confidence default to 1.0
  })

  // Cache by hash from result (LLM returns hash in each object); fall back to positional
  if (cache) {
    results.forEach((r, i) => {
      const hash = r.hash ?? uncached[i]?.hash
      if (hash) cache.set(hash, r)
    })
    // Mark noise commits (zero results) as processed so they're not re-queried
    const sentinel: ExtractionResult = { isDecision: false, isRejection: false, title: '', affects: [], risk: 'low', confidence: 0, rationale: '', isDeep: false }
    for (const c of uncached) {
      if (!cache.has(c.hash)) cache.set(c.hash, { ...sentinel, hash: c.hash })
    }
  }
  return results
}

// Run an array of async tasks with max `concurrency` in-flight at once
async function runConcurrent<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = []
  const queue = [...tasks]
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const task = queue.shift()!
      results.push(await task())
    }
  })
  await Promise.all(workers)
  return results
}

// ── v2: Semantic clustering ────────────────────────────────────────────────────

const MAX_CLUSTER_SIZE  = 8
const MAX_CLUSTER_CHARS = 8000
const SINGLETON_BATCH   = 4  // merge isolated commits into groups of this size

// Parse the set of files touched by a commit from its diff content
export function extractFilesFromDiff(diff: string): Set<string> {
  const files = new Set<string>()
  for (const match of diff.matchAll(/^diff --git a\/.+? b\/(.+)$/gm)) {
    files.add(match[1])
  }
  return files
}

// Group commits into clusters where members share at least one touched file.
// Isolated commits (no file overlap with neighbours) are batched together up to SINGLETON_BATCH.
export function clusterCommitsByFileOverlap(commits: CommitMeta[]): CommitMeta[][] {
  if (commits.length === 0) return []

  const fileMap = new Map<string, Set<string>>(
    commits.map(c => [c.hash, extractFilesFromDiff(c.diff)])
  )

  const assigned = new Set<string>()
  const cohesive: CommitMeta[][] = []   // clusters with ≥1 shared file
  const singletons: CommitMeta[] = []   // commits with no overlap found

  for (let i = 0; i < commits.length; i++) {
    const seed = commits[i]
    if (assigned.has(seed.hash)) continue

    const cluster: CommitMeta[] = [seed]
    const clusterFiles = new Set(fileMap.get(seed.hash))
    let clusterChars = seed.diff.length
    assigned.add(seed.hash)

    // Greedily absorb later commits that overlap this cluster's file set
    for (let j = i + 1; j < commits.length && cluster.length < MAX_CLUSTER_SIZE; j++) {
      const c = commits[j]
      if (assigned.has(c.hash)) continue
      if (clusterChars + c.diff.length > MAX_CLUSTER_CHARS) continue
      const files = fileMap.get(c.hash)!
      if ([...files].some(f => clusterFiles.has(f))) {
        cluster.push(c)
        files.forEach(f => clusterFiles.add(f))
        clusterChars += c.diff.length
        assigned.add(c.hash)
      }
    }

    if (cluster.length > 1) {
      cohesive.push(cluster)
    } else {
      singletons.push(seed)
    }
  }

  // Merge singletons into small batches to avoid excessive LLM calls
  const merged = mergeSingletonBatches(singletons)

  // Interleave cohesive clusters and singleton batches preserving rough order
  return [...cohesive, ...merged].sort((a, b) => {
    const aIdx = commits.indexOf(a[0])
    const bIdx = commits.indexOf(b[0])
    return aIdx - bIdx
  })
}

function mergeSingletonBatches(commits: CommitMeta[]): CommitMeta[][] {
  const batches: CommitMeta[][] = []
  let batch: CommitMeta[] = []
  let batchChars = 0

  for (const c of commits) {
    if (batch.length >= SINGLETON_BATCH || batchChars + c.diff.length > MAX_CLUSTER_CHARS) {
      batches.push(batch)
      batch = []
      batchChars = 0
    }
    batch.push(c)
    batchChars += c.diff.length
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}

// Max chars for a single diff before we signal truncation to the LLM
const MAX_DIFF_CHARS = 3000

// Truncate oversized diffs and return a flag indicating whether any were cut
function prepareBatch(commits: CommitMeta[]): { batch: CommitMeta[]; truncated: boolean } {
  let truncated = false
  const batch = commits.map(c => {
    if (c.diff.length <= MAX_DIFF_CHARS) return c
    truncated = true
    return { ...c, diff: c.diff.slice(0, MAX_DIFF_CHARS) + '\n... [TRUNCATED]' }
  })
  return { batch, truncated }
}

async function strategyClustered(commits: CommitMeta[], llm: LLMProvider, concurrency: number): Promise<ExtractionResult[]> {
  const clusters = clusterCommitsByFileOverlap(commits)
  const tasks = clusters.map(cluster => () => {
    const { batch, truncated } = prepareBatch(cluster)
    return callWithRetry(buildExtractionPrompt(batch, { truncated }), llm)
  })
  const batchResults = await runConcurrent(tasks, concurrency)
  return batchResults.flat()
}

// v1: fixed batches of 6 commits, capped at 5000 chars of diff per batch
async function strategySimple(commits: CommitMeta[], llm: LLMProvider, concurrency: number): Promise<ExtractionResult[]> {
  const BATCH_SIZE = 6
  const MAX_BATCH_CHARS = 5000
  const batches: CommitMeta[][] = []

  let batch: CommitMeta[] = []
  let batchChars = 0

  for (const commit of commits) {
    const size = commit.diff.length
    if (batch.length >= BATCH_SIZE || batchChars + size > MAX_BATCH_CHARS) {
      batches.push(batch)
      batch = []
      batchChars = 0
    }
    batch.push(commit)
    batchChars += size
  }
  if (batch.length > 0) batches.push(batch)

  const tasks = batches.map(b => () => {
    const { batch: prepared, truncated } = prepareBatch(b)
    return callWithRetry(buildExtractionPrompt(prepared, { truncated }), llm)
  })
  const batchResults = await runConcurrent(tasks, concurrency)
  return batchResults.flat()
}

// Cache interface — SHA → result, so commits are never reprocessed
// Concrete implementations: in-memory (tests), JSON file (CLI), SQLite (future)
export interface ExtractionCache {
  has(hash: string): boolean
  get(hash: string): ExtractionResult | undefined
  set(hash: string, result: ExtractionResult): void
}

export function parseExtractionResponse(raw: string): ExtractionResult[] {
  const toValidItems = (json: unknown): ExtractionResult[] | null => {
    if (!Array.isArray(json)) return null
    return json.filter(item => item !== null && typeof item === 'object' && !Array.isArray(item)) as ExtractionResult[]
  }

  try {
    const result = toValidItems(JSON.parse(raw.trim()))
    if (result !== null) return result
  } catch { /* fall through to code block extraction */ }

  // LLM sometimes wraps in markdown code blocks despite instructions
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (match) {
    try {
      const result = toValidItems(JSON.parse(match[1]))
      if (result !== null) return result
    } catch { /* fall through */ }
  }
  return []
}

// Wraps an LLM call with up to maxAttempts retries on malformed JSON.
// Uses exponential backoff: 1s, 2s, 4s between attempts.
export async function callWithRetry(
  prompt: string,
  llm: LLMProvider,
  maxAttempts = 3,
): Promise<ExtractionResult[]> {
  let lastRaw = ''
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastRaw = await llm(prompt)
    const parsed = parseExtractionResponse(lastRaw)
    if (parsed.length > 0 || lastRaw.trim() === '[]') return parsed

    // Parse returned [] but raw isn't empty — likely malformed JSON. Retry.
    if (attempt < maxAttempts) {
      await new Promise(res => setTimeout(res, 1000 * 2 ** (attempt - 1)))
    }
  }
  // All attempts failed — return empty rather than crashing
  return []
}
