import chalk from 'chalk'
import { findLoreRoot, readStore, writeStore, applyRelationToContent, buildRelationGraph, extractTitleFromRow } from '@chronicle/core'
import type { RelationType } from '@chronicle/core'

export async function cmdRelate(opts: {
  title: string
  dependsOn?: string
  supersedes?: string
  relatedTo?: string
  list?: boolean
}) {
  const root = findLoreRoot()
  if (!root) {
    console.error(chalk.red('✗  No .lore/ found. Run `chronicle init` first.'))
    process.exit(1)
  }

  const content = readStore(root, 'decisions')
  if (!content) {
    console.error(chalk.red('✗  No decisions.md found.'))
    process.exit(1)
  }

  // --list: show the full relation graph
  if (opts.list) {
    const graph = buildRelationGraph(content)
    if (graph.size === 0) {
      console.log(chalk.dim('  No decision relations defined yet.'))
      console.log(chalk.dim('  Use `chronicle relate "<title>" --depends-on "<title>"` to add one.'))
      return
    }
    console.log(chalk.bold('\nDecision Relationships\n'))
    for (const [title, rels] of graph) {
      console.log(chalk.cyan(`  ${title}`))
      if (rels.dependsOn?.length) {
        for (const t of rels.dependsOn) console.log(chalk.dim(`    depends-on   → ${t}`))
      }
      if (rels.supersedes?.length) {
        for (const t of rels.supersedes) console.log(chalk.dim(`    supersedes   → ${t}`))
      }
      if (rels.relatedTo?.length) {
        for (const t of rels.relatedTo) console.log(chalk.dim(`    related-to   → ${t}`))
      }
    }
    return
  }

  // Determine which relation to add
  const relations: Array<[RelationType, string]> = []
  if (opts.dependsOn) relations.push(['dependsOn', opts.dependsOn])
  if (opts.supersedes) relations.push(['supersedes', opts.supersedes])
  if (opts.relatedTo) relations.push(['relatedTo', opts.relatedTo])

  if (relations.length === 0) {
    console.error(chalk.red('✗  Specify at least one relation: --depends-on, --supersedes, or --related-to'))
    process.exit(1)
  }

  let updated = content
  for (const [type, target] of relations) {
    const result = applyRelationToContent(updated, opts.title, type, target)
    if (!result.found) {
      console.error(chalk.yellow(`⚠  No decision matching "${opts.title}" found in decisions.md`))
      // List available titles to help the user
      const titles = content.split('\n')
        .filter(l => l.startsWith('|'))
        .map(l => extractTitleFromRow(l))
        .filter(Boolean)
        .slice(0, 10)
      if (titles.length > 0) {
        console.error(chalk.dim('   Available titles (first 10):'))
        for (const t of titles) console.error(chalk.dim(`     • ${t}`))
      }
      process.exit(1)
    }
    updated = result.updated
    const arrow = type === 'dependsOn' ? 'depends on' : type === 'supersedes' ? 'supersedes' : 'is related to'
    console.log(chalk.green(`✓  "${opts.title}" now ${arrow} "${target}"`))
  }

  writeStore(root, 'decisions', updated)
}
