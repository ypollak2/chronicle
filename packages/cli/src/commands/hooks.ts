import { execSync, spawn } from 'child_process'
import { writeFileSync, readFileSync, existsSync, chmodSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { findLoreRoot, lorePath } from '@chronicle/core'

const HOOK_MARKER = '# chronicle-managed'

// The post-commit hook script — runs after every commit
// Intentionally async (fires chronicle capture in background) so it never blocks the developer
const POST_COMMIT_HOOK = `#!/bin/sh
${HOOK_MARKER}
chronicle capture --from-commit HEAD &
`

// Enriches commit message with a brief context note if .lore/ exists
// Runs before the editor opens — developer can edit or discard
const PREPARE_COMMIT_MSG_HOOK = `#!/bin/sh
${HOOK_MARKER}
COMMIT_MSG_FILE=$1
COMMIT_SOURCE=$2

# Only enrich manual commits (not merges, squashes, amends)
if [ -z "$COMMIT_SOURCE" ]; then
  chronicle enrich-commit "$COMMIT_MSG_FILE" 2>/dev/null || true
fi
`

export async function cmdHooksInstall({ silent = false } = {}) {
  const root = findGitRoot()
  if (!root) {
    if (!silent) console.error(chalk.red('✗  Not a git repository.'))
    return
  }

  const hooksDir = join(root, '.git', 'hooks')

  installHook(hooksDir, 'post-commit', POST_COMMIT_HOOK)
  installHook(hooksDir, 'prepare-commit-msg', PREPARE_COMMIT_MSG_HOOK)

  if (!silent) {
    console.log(chalk.green('✓  Chronicle hooks installed'))
    console.log(chalk.dim('   post-commit          → captures decisions after each commit (async)'))
    console.log(chalk.dim('   prepare-commit-msg   → enriches commit messages with context'))
    console.log(chalk.dim('\n   Run `chronicle hooks remove` to uninstall'))
  }
}

export async function cmdHooksRemove() {
  const root = findGitRoot()
  if (!root) { console.error(chalk.red('✗  Not a git repository.')); process.exit(1) }

  const hooksDir = join(root, '.git', 'hooks')

  for (const name of ['post-commit', 'prepare-commit-msg']) {
    removeChronicleFromHook(join(hooksDir, name))
  }

  console.log(chalk.green('✓  Chronicle hooks removed'))
}

export async function cmdCapture(opts: { fromCommit: string; llm?: string }) {
  // Called by the post-commit hook (runs async — no spinner, log to file)
  const root = findLoreRoot()
  if (!root) return  // silently skip if not initialized

  const logFile = lorePath(root, 'capture.log')

  try {
    const { getCommits, extractFromCommits, createFileCache } = await import('@chronicle/core')
    const { makeLLMProvider } = await import('../llm.js')
    const { formatRejectionEntry, formatDeepADR, slugify } = await import('../format.js')
    const { appendToStore, writeDeepDecision } = await import('@chronicle/core')

    // Get just the latest commit
    const commits = getCommits(root, '1month').slice(0, 1)
    if (commits.length === 0) return

    const cache = createFileCache(root)
    if (cache.has(commits[0].hash)) return  // already processed

    const llm = makeLLMProvider(opts.llm ?? process.env.CHRONICLE_LLM ?? 'anthropic')
    const results = await extractFromCommits(commits, llm, { strategy: 'simple', cache })

    for (const r of results.filter(r => r.isRejection)) {
      appendToStore(root, 'rejected', formatRejectionEntry(r))
    }
    for (const d of results.filter(d => d.isDecision && d.isDeep)) {
      writeDeepDecision(root, slugify(d.title), formatDeepADR(d))
    }
    // Append to decisions index
    for (const d of results.filter(r => r.isDecision)) {
      const row = `| ${d.title.slice(0, 50)} | ${d.affects.join(', ').slice(0, 40)} | ${d.risk} |${d.isDeep ? ` [→](decisions/${slugify(d.title)}.md)` : ''} |`
      appendToStore(root, 'decisions', row)
    }

    const decisionCount = results.filter(r => r.isDecision).length
    appendLog(logFile, `[${new Date().toISOString()}] captured commit ${commits[0].hash.slice(0, 8)}: ${decisionCount} decisions`)

    // S4: Incremental vector index — embed only new decisions (cache handles deduplication)
    if (decisionCount > 0) {
      try {
        const { buildEmbeddingIndex } = await import('@chronicle/core')
        const indexed = await buildEmbeddingIndex(root)
        if (indexed !== null) {
          appendLog(logFile, `[${new Date().toISOString()}] embedding index updated (${indexed} docs)`)
        }
      } catch { /* embeddings optional — skip silently */ }
    }
  } catch (err) {
    appendLog(logFile, `[${new Date().toISOString()}] ERROR: ${err}`)
  }
}

export async function cmdEnrichCommit(opts: { msgFile: string }) {
  // Called by prepare-commit-msg — fast, no LLM, just prepends relevant context
  const root = findLoreRoot()
  if (!root) return

  const { readStore } = await import('@chronicle/core')
  const risks = readStore(root, 'risks')
  if (!risks) return

  const msg = readFileSync(opts.msgFile, 'utf8')

  // Find risks relevant to files in the upcoming commit
  let staged: string[] = []
  try {
    staged = execSync('git diff --cached --name-only').toString().split('\n').filter(Boolean)
  } catch { return }

  const relevantRisks = risks
    .split('\n')
    .filter(line => staged.some(f => line.includes(f)))
    .slice(0, 3)

  if (relevantRisks.length === 0) return

  const note = `\n\n# Chronicle: high-risk files touched\n${relevantRisks.map(r => `# ${r}`).join('\n')}`
  writeFileSync(opts.msgFile, msg + note)
}

// ─── helpers ────────────────────────────────────────────────────────────────

function findGitRoot(from = process.cwd()): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd: from }).toString().trim()
  } catch { return null }
}

function installHook(hooksDir: string, name: string, script: string) {
  const path = join(hooksDir, name)

  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8')
    if (existing.includes(HOOK_MARKER)) {
      console.log(chalk.dim(`   ${name}: already installed`))
      return
    }
    // Append to existing hook — don't overwrite user's hook
    writeFileSync(path, existing.trimEnd() + '\n\n' + script.trim() + '\n')
    console.log(chalk.cyan(`   ${name}: appended to existing hook`))
  } else {
    writeFileSync(path, script)
    console.log(chalk.green(`   ${name}: installed`))
  }

  chmodSync(path, '755')
}

function removeChronicleFromHook(hookPath: string) {
  if (!existsSync(hookPath)) return
  const content = readFileSync(hookPath, 'utf8')
  if (!content.includes(HOOK_MARKER)) return

  // Remove lines between marker and next blank line
  const cleaned = content
    .split('\n')
    .reduce<{ out: string[]; skip: boolean }>((acc, line) => {
      if (line === HOOK_MARKER) return { out: acc.out, skip: true }
      if (acc.skip && line === '') return { out: acc.out, skip: false }
      if (!acc.skip) acc.out.push(line)
      return acc
    }, { out: [], skip: false })
    .out.join('\n')

  if (cleaned.trim() === '#!/bin/sh') {
    // Hook is now empty — remove the file
    execSync(`rm "${hookPath}"`)
  } else {
    writeFileSync(hookPath, cleaned)
  }
}

function appendLog(path: string, line: string) {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  writeFileSync(path, existing + line + '\n')
}
