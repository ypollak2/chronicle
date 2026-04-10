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

export function getCommits(repoRoot: string, depth: ScanDepth): CommitMeta[] {
  const since = DEPTH_FLAGS[depth]
  const logCmd = `git -C "${repoRoot}" log ${since} --format="%H|%ai|%s|%b" --no-merges`

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
      const [hash, date, subject, ...bodyParts] = line.split('|')
      return { hash, date, subject, body: bodyParts.join('|') }
    })

  return commits
    .filter(c => !isNoise(c.subject))
    .map(c => enrichWithDiff(repoRoot, c))
    .filter(c => countDiffLines(c.diff) >= MIN_DIFF_LINES)
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

function enrichWithDiff(repoRoot: string, commit: { hash: string; date: string; subject: string; body: string }): CommitMeta {
  let diffStat = ''
  let diff = ''
  let tags: string[] = []

  try {
    diffStat = execSync(
      `git -C "${repoRoot}" show --stat --format="" ${commit.hash}`,
      { maxBuffer: 1024 * 1024 }
    ).toString().trim()

    const rawDiff = execSync(
      `git -C "${repoRoot}" show --format="" ${commit.hash}`,
      { maxBuffer: 10 * 1024 * 1024 }
    ).toString()
    diff = rawDiff.slice(0, MAX_DIFF_CHARS)
    if (rawDiff.length > MAX_DIFF_CHARS) {
      diff += `\n... [truncated, ${rawDiff.length} chars total]`
    }
  } catch {
    // commit may be inaccessible (shallow clone etc.)
  }

  try {
    const tagRaw = execSync(
      `git -C "${repoRoot}" tag --points-at ${commit.hash}`,
      { maxBuffer: 64 * 1024 }
    ).toString()
    tags = tagRaw.split('\n').filter(Boolean)
  } catch {
    // no tags
  }

  return { ...commit, diffStat, diff, tags }
}

function countDiffLines(diff: string): number {
  return diff.split('\n').filter(l => l.startsWith('+') || l.startsWith('-')).length
}
