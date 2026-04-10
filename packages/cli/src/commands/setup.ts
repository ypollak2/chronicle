import chalk from 'chalk'
import { findLoreRoot } from '@chronicle/core'
import { installAdapter, ALL_TOOLS, type ToolName } from '../adapters/index.js'

export async function cmdSetup(opts: { tool?: string; all?: boolean }) {
  const root = findLoreRoot()
  if (!root) {
    console.error(chalk.red('✗  No .lore/ found. Run `chronicle init` first.'))
    process.exit(1)
  }

  const tools: ToolName[] = opts.all
    ? ALL_TOOLS
    : opts.tool
      ? [opts.tool as ToolName]
      : []

  if (tools.length === 0) {
    console.log(chalk.bold('\nAvailable tool integrations:\n'))
    for (const t of ALL_TOOLS) {
      console.log(`  ${chalk.cyan(t.padEnd(14))} chronicle setup --tool=${t}`)
    }
    console.log(`\n  ${chalk.dim('or')} chronicle setup --all   ${chalk.dim('install all')}`)
    return
  }

  for (const tool of tools) {
    if (!ALL_TOOLS.includes(tool)) {
      console.error(chalk.red(`✗  Unknown tool: ${tool}. Run \`chronicle setup\` to see options.`))
      process.exit(1)
    }

    const result = installAdapter(root, tool)
    console.log(chalk.green(`✓  ${tool}`))
    if (result.filesWritten.length) {
      for (const f of result.filesWritten) {
        console.log(chalk.dim(`   ${f.replace(root + '/', '')}`))
      }
    }
    console.log(chalk.dim(`   ${result.instructions.split('\n')[0]}`))
  }
}
