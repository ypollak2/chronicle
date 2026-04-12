import chalk from 'chalk'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { join } from 'path'
import { findLoreRoot, lorePath } from '@chronicle/core'

const INDEX_FILE = '_index.md'
const ARCHIVE_DIR = 'archive'
const MAX_ACTIVE_SESSIONS = 30  // older sessions are moved to archive/ automatically

interface SessionOpts {
  action: 'save' | 'list' | 'show' | 'archive'
  message?: string
  n?: string
  keep?: string
}

export async function cmdSession(opts: SessionOpts) {
  const root = findLoreRoot()
  if (!root) {
    console.error(chalk.red('✗  No .lore/ found. Run `chronicle init` first.'))
    process.exit(1)
  }

  const sessionsDir = lorePath(root, 'sessions')
  mkdirSync(sessionsDir, { recursive: true })

  switch (opts.action) {
    case 'save': return saveSession(sessionsDir, opts.message)
    case 'list': return listSessions(sessionsDir)
    case 'show': return showSessions(sessionsDir, opts.n ? parseInt(opts.n, 10) : 1)
    case 'archive': return archiveSessions(sessionsDir, opts.keep ? parseInt(opts.keep, 10) : MAX_ACTIVE_SESSIONS)
  }
}

function saveSession(dir: string, message?: string) {
  const now = new Date()
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = join(dir, `${ts}.md`)

  const body = message?.trim() ?? ''
  const header = `${now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`

  const content = `# Session — ${header}\n\n${body || '_No session notes._'}\n`
  writeFileSync(file, content)

  // Rebuild rolling index after every save
  rebuildIndex(dir)

  console.log(chalk.green(`✓ Session saved: ${file.split('/').pop()}`))
  if (body) console.log(chalk.dim(`  ${body.slice(0, 80)}${body.length > 80 ? '…' : ''}`))
}

/**
 * Rebuild _index.md as a compact table of all sessions (newest first).
 * Called after every save so inject always has an up-to-date history summary.
 */
export function rebuildIndex(dir: string): void {
  const files = getSessions(dir)
  if (files.length === 0) return

  const rows = files.map(f => {
    const content = readFileSync(join(dir, f), 'utf8')
    // Extract date from filename (YYYY-MM-DDTHH-MM-SS.md → YYYY-MM-DD HH:MM)
    const datePart = f.slice(0, 10)
    const timePart = f.slice(11, 16).replace('-', ':')
    const date = `${datePart} ${timePart}`
    // First non-header, non-empty content line as summary
    const summary = content.split('\n')
      .find(l => l.trim() && !l.startsWith('#'))
      ?.replace(/^\s*_|_\s*$/g, '')  // strip _No session notes._ italics
      .trim()
      .slice(0, 80) ?? '—'
    return `| ${date} | ${summary} |`
  })

  const index = `# Session History\n\n| Date | Summary |\n|------|----------|\n${rows.join('\n')}\n`
  writeFileSync(join(dir, INDEX_FILE), index)

  // Auto-archive sessions beyond the active window (preserves _index.md as full record)
  autoArchive(dir, MAX_ACTIVE_SESSIONS)
}

/**
 * Move sessions beyond the active window to archive/.
 * _index.md is NOT modified — it remains the permanent compact record.
 */
function autoArchive(dir: string, keep: number): void {
  const files = getSessions(dir)  // newest first
  const toArchive = files.slice(keep)  // everything beyond the last `keep` sessions
  if (toArchive.length === 0) return

  const archiveDir = join(dir, ARCHIVE_DIR)
  mkdirSync(archiveDir, { recursive: true })
  for (const f of toArchive) {
    try {
      renameSync(join(dir, f), join(archiveDir, f))
    } catch { /* best-effort — file may have been moved already */ }
  }
}

function listSessions(dir: string) {
  const files = getSessions(dir)
  if (files.length === 0) {
    console.log(chalk.yellow('No sessions saved yet.'))
    console.log(chalk.dim('  chronicle session save "what you worked on"'))
    return
  }
  console.log(chalk.bold(`\n◆ Sessions (${files.length})\n`))
  for (const f of files.slice(0, 20)) {
    const name = f.replace('.md', '').replace(/T|-/g, (m, i) => i === 10 ? ' ' : i > 10 ? ':' : '-')
    const content = readFileSync(join(dir, f), 'utf8')
    const preview = content.split('\n').find(l => l && !l.startsWith('#'))?.slice(0, 60) ?? ''
    console.log(`  ${chalk.cyan(name)}  ${chalk.dim(preview)}`)
  }
  if (files.length > 20) console.log(chalk.dim(`  … and ${files.length - 20} more`))
}

function showSessions(dir: string, n: number) {
  const files = getSessions(dir).slice(0, n)
  if (files.length === 0) {
    console.log(chalk.yellow('No sessions saved yet.'))
    return
  }
  for (const f of files) {
    const content = readFileSync(join(dir, f), 'utf8')
    console.log(content)
    console.log('---')
  }
}

/** Returns raw session files (excludes _index.md and archive/), newest first. */
function getSessions(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.md') && f !== INDEX_FILE)
    .sort()
    .reverse()
}

function archiveSessions(dir: string, keep: number) {
  const files = getSessions(dir)
  const toArchive = files.slice(keep)
  if (toArchive.length === 0) {
    console.log(chalk.dim(`  Nothing to archive (${files.length}/${keep} sessions in active window)`))
    return
  }

  const archiveDir = join(dir, ARCHIVE_DIR)
  mkdirSync(archiveDir, { recursive: true })

  let moved = 0
  for (const f of toArchive) {
    try {
      renameSync(join(dir, f), join(archiveDir, f))
      moved++
    } catch { /* skip */ }
  }

  console.log(chalk.green(`✓  Archived ${moved} session(s) to .lore/sessions/archive/`))
  console.log(chalk.dim(`  Active: ${files.length - moved} sessions · Archive: ${moved + toArchive.length - moved} total`))
  console.log(chalk.dim('  _index.md is unchanged — full history always available'))
}
