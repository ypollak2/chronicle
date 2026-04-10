import { execSync } from 'child_process'

export interface CommitMeta {
  hash: string
  date: string
  subject: string
  body: string
  diffStat: string  // --stat output: files changed, insertions, deletions
  diff: string      // actual diff (capped at MAX_DIFF_CHARS)
  tags: string[]    // git tags pointing to this commit
}

// Commits below this threshold are likely noise (typos, formatting)
const MIN_DIFF_LINES = 20

// Cap diff size sent to LLM — large diffs get truncated with a summary
const MAX_DIFF_CHARS = 4000

// Prefixes that are almost never architectural decisions
const NOISE_PREFIXES = ['chore', 'style', 'docs', 'test', 'ci', 'build', 'revert']

export type ScanDepth = '1month' | '3months' | '6months' | '1year' | 'all'

const DEPTH_FLAGS: Record<ScanDepth, string> = {
  '1month':  '--since="1 month ago"',
  '3months': '--since="3 months ago"',
  '6months': '--since="6 months ago"',
  '1year':   '--since="1 year ago"',
  'all':     '',
}

export function getCommits(repoRoot: string, depth: ScanDepth, limit?: number): CommitMeta[] {
  const since = DEPTH_FLAGS[depth]
  const SEP = '\x1f'  // ASCII unit separator — never appears in commit messages
  // Apply --max-count early so git doesn't read thousands of commits before we slice
  const maxCount = limit ? `--max-count=${limit * 3}` : ''
  const logCmd = `git -C "${repoRoot}" log ${since} ${maxCount} --format="%H${SEP}%ai${SEP}%s${SEP}%b" --no-merges`

  let raw: string
  try {
    raw = execSync(logCmd, { maxBuffer: 50 * 1024 * 1024 }).toString()
  } catch {
    return []
  }

  const commits = raw
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [hash, date, subject, ...bodyParts] = line.split(SEP)
      return { hash, date, subject: subject ?? '', body: bodyParts.join(' ') }
    })
    .filter(c => c.hash && c.subject)

  // Fetch all tags once — avoids one `git tag --points-at` call per commit
  const tagsByHash = getTagsByHash(repoRoot)

  const filtered = commits
    .filter(c => !isNoise(c.subject))
    .map(c => enrichWithDiff(repoRoot, c, tagsByHash))
    .filter(c => countDiffLines(c.diff) >= MIN_DIFF_LINES)

  return limit ? filtered.slice(0, limit) : filtered
}

export function getGitTags(repoRoot: string): Record<string, string> {
  // Returns map of commit hash → tag name
  try {
    const raw = execSync(`git -C "${repoRoot}" tag -l --format="%(objectname:short)|%(refname:short)"`)
      .toString()
    return Object.fromEntries(
      raw.split('\n').filter(Boolean).map(l => l.split('|') as [string, string])
    )
  } catch {
    return {}
  }
}

function isNoise(subject: string): boolean {
  const lower = subject.toLowerCase()
  return NOISE_PREFIXES.some(p => lower.startsWith(p + ':') || lower.startsWith(p + '('))
}

// Fetch all tags keyed by short hash — one call for the entire repo
function getTagsByHash(repoRoot: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  try {
    const raw = execSync(
      `git -C "${repoRoot}" tag --format="%(objectname:short)|%(refname:short)"`,
      { maxBuffer: 1024 * 1024 }
    ).toString()
    for (const line of raw.split('\n').filter(Boolean)) {
      const [hash, tag] = line.split('|')
      if (!hash || !tag) continue
      const existing = map.get(hash) ?? []
      existing.push(tag)
      map.set(hash, existing)
    }
  } catch { /* no tags or not a git repo */ }
  return map
}

function enrichWithDiff(
  repoRoot: string,
  commit: { hash: string; date: string; subject: string; body: string },
  tagsByHash: Map<string, string[]>
): CommitMeta {
  let diffStat = ''
  let diff = ''

  try {
    // Single git show call — stat summary + full diff in one round trip
    const raw = execSync(
      `git -C "${repoRoot}" show --stat -p ${commit.hash}`,
      { maxBuffer: 10 * 1024 * 1024 }
    ).toString()

    // Split at first "diff --git" to separate stat from diff content
    const diffStart = raw.indexOf('\ndiff --git ')
    if (diffStart !== -1) {
      diffStat = raw.slice(0, diffStart).split('\n').filter(l => l.includes('|') || l.includes('changed')).join('\n').trim()
      const rawDiff = raw.slice(diffStart + 1)
      diff = rawDiff.slice(0, MAX_DIFF_CHARS)
      if (rawDiff.length > MAX_DIFF_CHARS) {
        diff += `\n... [truncated, ${rawDiff.length} chars total]`
      }
    }
  } catch {
    // commit may be inaccessible (shallow clone etc.)
  }

  // Tags: short hash prefix lookup (git uses 7-char short hashes)
  const shortHash = commit.hash.slice(0, 7)
  const tags = tagsByHash.get(shortHash) ?? []

  return { ...commit, diffStat, diff, tags }
}

function countDiffLines(diff: string): number {
  return diff.split('\n').filter(l => l.startsWith('+') || l.startsWith('-')).length
}
