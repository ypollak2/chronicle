/**
 * Ownership tracking (I3).
 *
 * Reads CODEOWNERS (GitHub/GitLab standard) or falls back to .lore/ownership.md
 * for module-level owner mappings. Authors are stored in decisions.md rows as
 * <!-- author:email --> inline comments, populated during `chronicle capture`.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, relative } from 'path'
import { lorePath } from './store.js'

export interface OwnerPattern {
  pattern: string
  owners: string[]
}

export interface OwnershipMap {
  patterns: OwnerPattern[]
  source: 'codeowners' | 'lore' | 'none'
}

const CODEOWNERS_PATHS = [
  'CODEOWNERS',
  '.github/CODEOWNERS',
  '.gitlab/CODEOWNERS',
  'docs/CODEOWNERS',
]

const OWNERSHIP_FILE = 'ownership.md'

/**
 * Load ownership data. Checks CODEOWNERS first, then .lore/ownership.md.
 */
export function loadOwnership(root: string): OwnershipMap {
  // Try CODEOWNERS locations
  for (const rel of CODEOWNERS_PATHS) {
    const path = join(root, rel)
    if (existsSync(path)) {
      return { patterns: parseCodeowners(readFileSync(path, 'utf8')), source: 'codeowners' }
    }
  }

  // Fall back to .lore/ownership.md
  const lorePath_ = lorePath(root, OWNERSHIP_FILE)
  if (existsSync(lorePath_)) {
    return { patterns: parseLoreOwnership(readFileSync(lorePath_, 'utf8')), source: 'lore' }
  }

  return { patterns: [], source: 'none' }
}

/**
 * Returns owners for a given file path. Uses last-matching-rule wins (CODEOWNERS semantics).
 */
export function getOwnersForFile(filePath: string, map: OwnershipMap): string[] {
  const normalized = filePath.startsWith('/') ? filePath.slice(1) : filePath
  let result: string[] = []
  for (const { pattern, owners } of map.patterns) {
    if (matchesCodeownersPattern(normalized, pattern.replace(/^\//, ''))) {
      result = owners
    }
  }
  return result
}

/**
 * Lightweight CODEOWNERS-style glob matching.
 * Supports: `*` (any chars, no slash), `**` (any chars incl slash), `?` (one char).
 * Does not require external dependencies.
 */
function matchesCodeownersPattern(filePath: string, pattern: string): boolean {
  // Convert glob to regex
  const reStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex special chars
    .replace(/\*\*/g, '\u0000')              // placeholder for **
    .replace(/\*/g, '[^/]*')                 // * → no slash
    .replace(/\u0000/g, '.*')               // ** → anything
    .replace(/\?/g, '[^/]')                  // ? → one non-slash char
  // If pattern doesn't contain /, treat as a basename match
  const anchored = pattern.includes('/') ? `^${reStr}` : `(^|/)${reStr}`
  try {
    return new RegExp(`${anchored}(/|$)`).test(filePath)
  } catch {
    return false
  }
}

/**
 * Parse the author from a decisions.md row HTML comment.
 */
export function parseAuthorFromRow(row: string): string | null {
  const match = row.match(/<!-- author:(.*?) -->/)
  return match ? match[1].trim() : null
}

/**
 * Add (or update) the author comment in a decisions.md row.
 */
export function setAuthorOnRow(row: string, author: string): string {
  const existing = row.match(/<!-- author:.*? -->/)
  const comment = `<!-- author:${author} -->`
  if (existing) return row.replace(existing[0], comment)
  return row.trimEnd() + ' ' + comment
}

/**
 * Build a formatted ownership section for inject output for the given files.
 */
export function buildOwnershipSection(root: string, files: string[]): string {
  const map = loadOwnership(root)
  if (map.source === 'none' || files.length === 0) return ''

  const lines: string[] = ['## File Ownership']
  let hasAny = false
  for (const file of files) {
    const rel = relative(root, file.startsWith('/') ? file : join(root, file))
    const owners = getOwnersForFile(rel, map)
    if (owners.length > 0) {
      lines.push(`- \`${rel}\` → ${owners.join(', ')}`)
      hasAny = true
    }
  }
  return hasAny ? lines.join('\n') : ''
}

/**
 * Write a .lore/ownership.md with module → owner mappings.
 */
export function writeLoreOwnership(root: string, patterns: OwnerPattern[]): void {
  const lines = [
    '# Module Ownership',
    '',
    '<!-- Chronicle ownership map. Format: `pattern: @owner` -->',
    '',
  ]
  for (const { pattern, owners } of patterns) {
    lines.push(`- \`${pattern}\`: ${owners.join(' ')}`)
  }
  writeFileSync(lorePath(root, OWNERSHIP_FILE), lines.join('\n') + '\n')
}

// ─── parsers ────────────────────────────────────────────────────────────────

function parseCodeowners(content: string): OwnerPattern[] {
  const patterns: OwnerPattern[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const parts = trimmed.split(/\s+/)
    if (parts.length < 2) continue
    patterns.push({ pattern: parts[0], owners: parts.slice(1) })
  }
  return patterns
}

function parseLoreOwnership(content: string): OwnerPattern[] {
  const patterns: OwnerPattern[] = []
  for (const line of content.split('\n')) {
    // Format: `- \`pattern\`: @owner1 @owner2`
    const match = line.match(/^-\s*`([^`]+)`:\s*(.+)/)
    if (!match) continue
    const owners = match[2].trim().split(/\s+/).filter(Boolean)
    patterns.push({ pattern: match[1], owners })
  }
  return patterns
}
