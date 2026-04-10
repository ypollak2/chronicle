import chalk from 'chalk'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { findLoreRoot, lorePath } from '@chronicle/core'

interface SessionOpts {
  action: 'save' | 'list' | 'show'
  message?: string
  n?: string
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
  }
}

function saveSession(dir: string, message?: string) {
  const now = new Date()
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = join(dir, `${ts}.md`)

  // Use message argument; piped stdin handled when user does `echo "..." | chronicle session save`
  const body = message?.trim() ?? ''

  const content = `# Session — ${now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}

${body || '_No session notes._'}
`
  writeFileSync(file, content)
  console.log(chalk.green(`✓ Session saved: ${file.split('/').pop()}`))
  if (body) console.log(chalk.dim(`  ${body.slice(0, 80)}${body.length > 80 ? '…' : ''}`))
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

function getSessions(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse()
}
