/**
 * Business/product context layer (I2).
 *
 * Stores human-readable project context in .lore/context.md — a structured
 * markdown file with named sections. Both humans and AI coding tools can read
 * and update it. chronicle inject includes it at the top of every output.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { lorePath } from './store.js'

export interface BusinessContext {
  goals: string[]
  constraints: string[]
  team: string[]
  stack: string[]
  nonGoals: string[]
}

const CONTEXT_FILE = 'context.md'

const SECTION_KEYS: Record<string, keyof BusinessContext> = {
  '## Goals':        'goals',
  '## Constraints':  'constraints',
  '## Team':         'team',
  '## Tech Stack':   'stack',
  '## Non-Goals':    'nonGoals',
}

const KEY_TO_HEADER: Record<keyof BusinessContext, string> = {
  goals:       '## Goals',
  constraints: '## Constraints',
  team:        '## Team',
  stack:       '## Tech Stack',
  nonGoals:    '## Non-Goals',
}

export function readContext(root: string): BusinessContext {
  const path = lorePath(root, CONTEXT_FILE)
  if (!existsSync(path)) return emptyContext()

  const content = readFileSync(path, 'utf8')
  const ctx = emptyContext()
  let currentKey: keyof BusinessContext | null = null

  for (const line of content.split('\n')) {
    const sectionKey = SECTION_KEYS[line.trim()]
    if (sectionKey) {
      currentKey = sectionKey
      continue
    }
    if (line.startsWith('## ')) {
      currentKey = null
      continue
    }
    if (currentKey && line.startsWith('- ')) {
      ctx[currentKey].push(line.slice(2).trim())
    }
  }

  return ctx
}

export function writeContext(root: string, ctx: BusinessContext): void {
  const lines: string[] = ['# Project Context', '']
  for (const [key, header] of Object.entries(KEY_TO_HEADER) as [keyof BusinessContext, string][]) {
    lines.push(header)
    if (ctx[key].length === 0) {
      lines.push('- (none)')
    } else {
      for (const item of ctx[key]) lines.push(`- ${item}`)
    }
    lines.push('')
  }
  writeFileSync(lorePath(root, CONTEXT_FILE), lines.join('\n'))
}

export function addContextFact(root: string, type: keyof BusinessContext, fact: string): void {
  const ctx = readContext(root)
  if (!ctx[type].includes(fact)) {
    ctx[type].push(fact)
    writeContext(root, ctx)
  }
}

export function removeContextFact(root: string, type: keyof BusinessContext, fact: string): void {
  const ctx = readContext(root)
  ctx[type] = ctx[type].filter(f => f !== fact)
  writeContext(root, ctx)
}

/**
 * Format the context for inclusion in inject output.
 * Returns empty string if no context has been defined.
 */
export function formatContextForInject(ctx: BusinessContext): string {
  const hasContent = Object.values(ctx).some(arr => arr.length > 0 && !(arr.length === 1 && arr[0] === '(none)'))
  if (!hasContent) return ''

  const lines: string[] = ['# Project Context']
  for (const [key, header] of Object.entries(KEY_TO_HEADER) as [keyof BusinessContext, string][]) {
    const items = ctx[key].filter(f => f !== '(none)')
    if (items.length === 0) continue
    lines.push(header)
    for (const item of items) lines.push(`- ${item}`)
  }
  return lines.join('\n')
}

function emptyContext(): BusinessContext {
  return { goals: [], constraints: [], team: [], stack: [], nonGoals: [] }
}
