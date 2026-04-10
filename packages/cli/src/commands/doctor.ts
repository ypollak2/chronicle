import chalk from 'chalk'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { findLoreRoot, lorePath, STORE_FILES } from '@chronicle/core'
import { execSync } from 'child_process'

interface Check {
  label: string
  status: 'ok' | 'warn' | 'error'
  detail?: string
}

export async function cmdDoctor() {
  const root = findLoreRoot()

  const checks: Check[] = []

  // 1. Git repo
  const isGit = existsSync(join(process.cwd(), '.git')) ||
    (() => { try { execSync('git rev-parse --git-dir', { stdio: 'pipe' }); return true } catch { return false } })()
  checks.push({ label: 'Git repository', status: isGit ? 'ok' : 'error', detail: isGit ? undefined : 'Not inside a git repo' })

  // 2. .lore/ exists
  if (!root) {
    checks.push({ label: '.lore/ exists', status: 'error', detail: 'Run `chronicle init` first' })
    printReport(checks)
    process.exit(1)
  }
  checks.push({ label: '.lore/ exists', status: 'ok', detail: `${lorePath(root)}` })

  // 3. Core files
  for (const [key, file] of Object.entries(STORE_FILES)) {
    const path = lorePath(root, file)
    if (!existsSync(path)) {
      checks.push({ label: `${file}`, status: 'warn', detail: 'Missing — run `chronicle init`' })
    } else {
      const size = statSync(path).size
      checks.push({ label: `${file}`, status: size > 50 ? 'ok' : 'warn', detail: `${(size / 1024).toFixed(1)} KB` })
    }
  }

  // 4. Deep ADR link integrity
  const decisionsFile = lorePath(root, STORE_FILES.decisions)
  if (existsSync(decisionsFile)) {
    const content = readFileSync(decisionsFile, 'utf8')
    const linkPattern = /\[→\]\(decisions\/([^)]+)\)/g
    const adrDir = lorePath(root, 'decisions')
    let broken = 0
    for (const match of content.matchAll(linkPattern)) {
      const adrPath = join(adrDir, match[1])
      if (!existsSync(adrPath)) broken++
    }
    checks.push({
      label: 'ADR link integrity',
      status: broken === 0 ? 'ok' : 'warn',
      detail: broken === 0 ? 'All ADR links valid' : `${broken} broken link(s)`
    })
  }

  // 5. Cache exists
  const cachePath = lorePath(root, '.cache.json')
  const hasCache = existsSync(cachePath)
  if (hasCache) {
    try {
      const cache = JSON.parse(readFileSync(cachePath, 'utf8'))
      const count = Object.keys(cache).length
      checks.push({ label: 'Extraction cache', status: 'ok', detail: `${count} commits cached` })
    } catch {
      checks.push({ label: 'Extraction cache', status: 'warn', detail: 'Cache file is corrupt' })
    }
  } else {
    checks.push({ label: 'Extraction cache', status: 'warn', detail: 'No cache — re-runs will reprocess all commits' })
  }

  // 6. Git hooks
  const hooksDir = join(root, '.git', 'hooks')
  const postCommit = join(hooksDir, 'post-commit')
  const hasHook = existsSync(postCommit) &&
    readFileSync(postCommit, 'utf8').includes('chronicle')
  checks.push({
    label: 'Git hooks',
    status: hasHook ? 'ok' : 'warn',
    detail: hasHook ? 'post-commit hook installed' : 'Not installed — run `chronicle hooks install`'
  })

  // 7. ADR count
  const adrDir = lorePath(root, 'decisions')
  const adrCount = existsSync(adrDir)
    ? readdirSync(adrDir).filter(f => f.endsWith('.md')).length
    : 0
  checks.push({ label: 'Deep ADRs', status: 'ok', detail: `${adrCount} files in decisions/` })

  printReport(checks)

  const errors = checks.filter(c => c.status === 'error').length
  const warnings = checks.filter(c => c.status === 'warn').length
  if (errors > 0) {
    console.log(chalk.red(`\n${errors} error(s) found. Fix them to use Chronicle properly.`))
    process.exit(1)
  } else if (warnings > 0) {
    console.log(chalk.yellow(`\n${warnings} warning(s). Everything works but consider addressing them.`))
  } else {
    console.log(chalk.green('\n✓ Everything looks healthy!'))
  }
}

function printReport(checks: Check[]) {
  console.log(chalk.bold('\n◆ Chronicle Doctor\n'))
  for (const c of checks) {
    const icon = c.status === 'ok' ? chalk.green('✓') : c.status === 'warn' ? chalk.yellow('⚠') : chalk.red('✗')
    const label = chalk.bold(c.label.padEnd(26))
    const detail = c.detail ? chalk.dim(c.detail) : ''
    console.log(`  ${icon}  ${label} ${detail}`)
  }
}
