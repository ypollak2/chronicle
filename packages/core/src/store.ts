import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join, resolve } from 'path'

export interface Decision {
  date: string
  title: string
  affects: string[]
  risk: 'low' | 'medium' | 'high'
  body: string
  deepFile?: string  // path to decisions/<slug>.md if deep
}

export interface Rejection {
  date: string
  what: string
  replacedBy: string
  reason: string
}

export const LORE_DIR = '.lore'

export const STORE_FILES = {
  index:           'index.md',
  decisions:       'decisions.md',
  rejected:        'rejected.md',
  risks:           'risks.md',
  evolution:       'evolution.md',
  'low-confidence': 'low-confidence.md',
} as const

// Resolve the .lore/ directory from any subdirectory upward (like git)
export function findLoreRoot(from = process.cwd()): string | null {
  let dir = resolve(from)
  while (true) {
    if (existsSync(join(dir, LORE_DIR))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) return null
    dir = parent
  }
}

export function lorePath(root: string, ...segments: string[]): string {
  return join(root, LORE_DIR, ...segments)
}

export function readStore(root: string, file: keyof typeof STORE_FILES): string {
  const path = lorePath(root, STORE_FILES[file])
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

export function appendToStore(root: string, file: keyof typeof STORE_FILES, content: string): void {
  const path = lorePath(root, STORE_FILES[file])
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  writeFileSync(path, existing + '\n' + content.trim() + '\n')
}

export function writeStore(root: string, file: keyof typeof STORE_FILES, content: string): void {
  writeFileSync(lorePath(root, STORE_FILES[file]), content)
}

export function writeDeepDecision(root: string, slug: string, content: string): string {
  const dir = lorePath(root, 'decisions')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${slug}.md`)
  writeFileSync(file, content)
  return file
}

export function listSessions(root: string): string[] {
  const dir = lorePath(root, 'sessions')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse()
}

export function initStore(root: string): void {
  const loreDir = lorePath(root)
  for (const sub of ['decisions', 'diagrams', 'sessions']) {
    mkdirSync(join(loreDir, sub), { recursive: true })
  }
}
