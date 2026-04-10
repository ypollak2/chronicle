import chalk from 'chalk'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { findLoreRoot, lorePath } from '@chronicle/core'

export async function cmdSearch(query: string, opts: { limit?: string; json?: boolean }) {
  const root = findLoreRoot()
  if (!root) {
    process.stderr.write(chalk.red('✗  No .lore/ found. Run `chronicle init` first.\n'))
    process.exit(1)
  }

  if (!query?.trim()) {
    process.stderr.write(chalk.red('✗  Please provide a search query.\n'))
    process.exit(1)
  }

  const limit = opts.limit ? parseInt(opts.limit, 10) : 20
  const loreDir = lorePath(root)
  const pattern = new RegExp(query, 'gi')
  const results: SearchResult[] = []

  // Walk all markdown files in .lore/ recursively
  for (const file of walkMarkdown(loreDir)) {
    const content = readFileSync(file, 'utf8')
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        results.push({
          file: file.replace(loreDir + '/', ''),
          line: i + 1,
          text: lines[i].trim(),
          // context: one line before and after
          context: [
            lines[i - 1]?.trim(),
            lines[i + 1]?.trim(),
          ].filter(Boolean),
        })
        if (results.length >= limit) break
      }
      pattern.lastIndex = 0  // reset regex for next line
    }
    if (results.length >= limit) break
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(results, null, 2))
    return
  }

  if (results.length === 0) {
    console.log(chalk.yellow(`No results for "${query}"`))
    return
  }

  console.log(chalk.bold(`\n◆ Search: "${query}" — ${results.length} result(s)\n`))

  // Group by file
  const byFile = new Map<string, SearchResult[]>()
  for (const r of results) {
    const list = byFile.get(r.file) ?? []
    list.push(r)
    byFile.set(r.file, list)
  }

  for (const [file, matches] of byFile) {
    console.log(chalk.cyan(`  ${file}`))
    for (const m of matches) {
      const highlighted = m.text.replace(new RegExp(query, 'gi'), s => chalk.yellow(s))
      console.log(`    ${chalk.dim(`L${m.line}:`)} ${highlighted}`)
      for (const ctx of m.context) {
        console.log(`         ${chalk.dim(ctx.slice(0, 80))}`)
      }
    }
    console.log()
  }

  if (results.length >= limit) {
    console.log(chalk.dim(`  (showing first ${limit} results — use --limit to see more)`))
  }
}

interface SearchResult {
  file: string
  line: number
  text: string
  context: string[]
}

function walkMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return []
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkMarkdown(full))
    } else if (entry.name.endsWith('.md')) {
      files.push(full)
    }
  }
  return files
}
