import chalk from 'chalk'
import { execSync } from 'child_process'
import { writeFileSync, readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { findLoreRoot, lorePath, readStore } from '@chronicle/core'

// ASCII diagrams: render anywhere — terminal, plain text, every AI context window.
// Stored as .txt (not .mmd) so they're readable without any renderer.
export async function cmdDiagram(opts: { type?: string; watch?: boolean }) {
  const root = findLoreRoot()
  if (!root) {
    console.error(chalk.red('✗  No .lore/ found. Run `chronicle init` first.'))
    process.exit(1)
  }

  const types = opts.type ? [opts.type] : ['architecture', 'dependencies', 'evolution']

  for (const type of types) {
    switch (type) {
      case 'architecture':  generateArchitecture(root); break
      case 'dependencies':  generateDependencies(root); break
      case 'evolution':     generateEvolution(root); break
      default:
        console.error(chalk.red(`✗  Unknown diagram type: ${type}. Options: architecture|dependencies|evolution`))
    }
  }
}

// ── Architecture diagram ──────────────────────────────────────────────────────
function generateArchitecture(root: string) {
  const decisions = readStore(root, 'decisions')
  const pairs = extractModulesFromDecisions(decisions)
  const allModules = [...new Set(pairs.flat())].filter(m => m.length > 1)

  if (allModules.length === 0) {
    writeDiagram(root, 'architecture', box('Architecture', '(no decisions logged yet — run `chronicle init`)'))
    console.log(chalk.green('✓  .lore/diagrams/architecture.txt'))
    return
  }

  // Build adjacency for ASCII tree
  const lines: string[] = [
    '┌─ Architecture ────────────────────────────────────────┐',
    '│  Modules referenced in decision log                   │',
    '└───────────────────────────────────────────────────────┘',
    '',
  ]

  // Group by first-level directory
  const groups = new Map<string, string[]>()
  for (const m of allModules) {
    const group = m.includes('/') ? m.split('/')[0] : 'root'
    groups.set(group, [...(groups.get(group) ?? []), m])
  }

  for (const [group, members] of groups) {
    lines.push(`  [ ${group} ]`)
    for (const m of members) lines.push(`    ├── ${m}`)
    lines.push('')
  }

  // Show relationships
  if (pairs.length) {
    lines.push('  Relationships (from decisions):')
    for (const [a, b] of pairs.slice(0, 15)) {
      lines.push(`    ${a.padEnd(30)} ──→  ${b}`)
    }
  }

  writeDiagram(root, 'architecture', lines.join('\n'))
  console.log(chalk.green('✓  .lore/diagrams/architecture.txt'))
}

// ── Dependency diagram ────────────────────────────────────────────────────────
function generateDependencies(root: string) {
  const imports = collectImports(root)
  if (imports.size === 0) {
    console.log(chalk.yellow('⚠  No source files found for dependency analysis'))
    return
  }

  // Count dependents per file (blast radius)
  const dependentCount = new Map<string, number>()
  for (const deps of imports.values()) {
    for (const d of deps) dependentCount.set(d, (dependentCount.get(d) ?? 0) + 1)
  }

  const sorted = [...imports.entries()]
    .sort(([, a], [, b]) => b.length - a.length)  // most-connected first

  const lines: string[] = [
    '┌─ Dependency Map ──────────────────────────────────────┐',
    '│  [!] = high blast radius (≥3 dependents)              │',
    '└───────────────────────────────────────────────────────┘',
    '',
  ]

  for (const [file, deps] of sorted.slice(0, 20)) {
    const count = dependentCount.get(file) ?? 0
    const risk = count >= 3 ? ' [!]' : ''
    lines.push(`  ${file}${risk}`)
    for (const dep of deps.slice(0, 5)) {
      lines.push(`    └── imports: ${dep}`)
    }
    if (deps.length > 5) lines.push(`    └── ... +${deps.length - 5} more`)
    lines.push('')
  }

  if (imports.size > 20) lines.push(`  ... and ${imports.size - 20} more files`)

  const highRisk = [...dependentCount.entries()].filter(([, c]) => c >= 3)
  if (highRisk.length) {
    lines.push('', '  High blast-radius files:')
    for (const [f, c] of highRisk.sort(([, a], [, b]) => b - a)) {
      lines.push(`    ${f.padEnd(40)} ← imported by ${c} files`)
    }
  }

  writeDiagram(root, 'dependencies', lines.join('\n'))
  console.log(chalk.green('✓  .lore/diagrams/dependencies.txt'))
  if (highRisk.length) console.log(chalk.dim(`   ${highRisk.length} high-risk files detected`))
}

// ── Evolution timeline ────────────────────────────────────────────────────────
function generateEvolution(root: string) {
  const entries = collectEvolutionEntries(root)

  if (entries.length === 0) {
    console.log(chalk.yellow('⚠  No git tags or dated decisions found'))
    return
  }

  const lines: string[] = [
    '┌─ Evolution Timeline ──────────────────────────────────┐',
    '│  Derived from git tags + decision log                 │',
    '└───────────────────────────────────────────────────────┘',
    '',
    '  DATE         EVENT',
    '  ─────────────────────────────────────────────────────',
  ]

  let prevYear = ''
  for (const e of entries) {
    const year = e.date.slice(0, 4)
    if (year !== prevYear) {
      lines.push(``, `  ── ${year} ${'─'.repeat(45)}`)
      prevYear = year
    }
    const marker = e.isRelease ? '◆' : '·'
    lines.push(`  ${e.date}  ${marker}  ${e.label}`)
  }

  writeDiagram(root, 'evolution', lines.join('\n'))
  console.log(chalk.green('✓  .lore/diagrams/evolution.txt'))
}

// ── helpers ───────────────────────────────────────────────────────────────────

function writeDiagram(root: string, name: string, content: string) {
  const dir = lorePath(root, 'diagrams')
  writeFileSync(join(dir, `${name}.txt`), content)
}

function box(title: string, content: string): string {
  const width = Math.max(title.length, content.length) + 4
  const border = '─'.repeat(width)
  return `┌${border}┐\n│  ${title.padEnd(width - 2)}│\n│  ${content.padEnd(width - 2)}│\n└${border}┘`
}

function extractModulesFromDecisions(decisions: string): string[][] {
  const affectsPattern = /\|\s*([^|]+?)\s*\|/g
  const result: string[][] = []
  let match
  while ((match = affectsPattern.exec(decisions)) !== null) {
    const modules = match[1].split(',').map(s => s.trim()).filter(Boolean)
    if (modules.length >= 2) result.push(modules.slice(0, 2))
  }
  return result
}

function collectImports(root: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py']

  function walk(dir: string, depth = 0) {
    if (depth > 4) return
    const skip = ['node_modules', '.git', 'dist', '.lore', '__pycache__', '.venv']
    let entries: string[] = []
    try { entries = readdirSync(dir, { withFileTypes: true }) as unknown as string[] } catch { return }

    for (const entry of entries as any[]) {
      if (skip.includes(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full, depth + 1); continue }
      if (!extensions.some(e => entry.name.endsWith(e))) continue

      const content = readFileSync(full, 'utf8')
      const shortName = full.replace(root + '/', '')
      const deps = extractImportPaths(content, shortName)
      if (deps.length) map.set(shortName, deps)
    }
  }

  walk(root)
  return map
}

function extractImportPaths(content: string, fromFile: string): string[] {
  const importRe = /(?:import|from)\s+['"]([^'"]+)['"]/g
  const deps: string[] = []
  let m
  while ((m = importRe.exec(content)) !== null) {
    const path = m[1]
    // Only include relative imports (local files, not node_modules)
    if (path.startsWith('.')) {
      deps.push(path.replace(/^\.\.?\//, '').replace(/\.(ts|js|tsx|jsx)$/, ''))
    }
  }
  return deps
}

function collectEvolutionEntries(root: string): Array<{ date: string; label: string; isRelease: boolean }> {
  const entries: Array<{ date: string; label: string; isRelease: boolean }> = []

  // From git tags
  try {
    const tags = execSync(`git -C "${root}" tag -l --sort=version:refname --format="%(refname:short)|%(creatordate:short)"`)
      .toString().split('\n').filter(Boolean)
    for (const tag of tags) {
      const [name, date] = tag.split('|')
      if (date) entries.push({ date: date.slice(0, 10), label: `Release ${name}`, isRelease: true })
    }
  } catch { /* no git */ }

  // From decisions.md table rows (extract date from first column if present)
  const decisions = readStore(root, 'decisions')
  const dateRe = /\|\s*(\d{4}-\d{2}-\d{2})\s*\|([^|]+)\|/g
  let m
  while ((m = dateRe.exec(decisions)) !== null) {
    entries.push({ date: m[1], label: m[2].trim().slice(0, 50), isRelease: false })
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date))
}
