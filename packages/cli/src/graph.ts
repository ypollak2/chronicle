import { readStore } from '@chronicle/core'
import { existsSync } from 'fs'
import { join } from 'path'

export interface GraphNode {
  id: string
  decisions: number
  rejections: number
  maxRisk: 'none' | 'low' | 'medium' | 'high'
  titles: string[]      // decision titles touching this module
}

export interface GraphLink {
  source: string
  target: string
  weight: number        // number of shared decisions
  titles: string[]
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
  generated: string
  isMonorepo: boolean
  stats: { decisions: number; rejections: number; modules: number }
}

export interface GraphOptions {
  depth?: number        // path segments to use for grouping (default: auto)
  monorepo?: boolean    // override monorepo auto-detection
}

const RISK_ORDER = { none: 0, low: 1, medium: 2, high: 3 }

// Well-known monorepo root directories — paths under these group at depth 2
const MONOREPO_ROOTS = ['packages', 'apps', 'services', 'libs', 'modules']

/**
 * Detect if this repo uses a monorepo layout by checking for common root dirs.
 */
export function detectMonorepo(repoRoot: string): boolean {
  return MONOREPO_ROOTS.some(dir => existsSync(join(repoRoot, dir)))
}

/**
 * Convert a raw file path to a module cluster ID.
 *
 * Examples (depth=2, monorepo=false):
 *   "src/auth/jwt.ts"        → "src/auth/"
 *   "auth/"                  → "auth/"
 *   "README.md"              → "root/"
 *
 * With monorepo=true (or depth=2 and path under packages/):
 *   "packages/core/src/x.ts" → "packages/core/"
 *
 * depth controls how many path segments to keep (1=top-level, 2=two levels, etc.)
 */
function toModule(raw: string, depth: number, isMonorepo: boolean): string {
  const p = raw.trim().replace(/^\/|\/$/g, '')
  if (!p) return ''
  // Skip truncated artifacts from LLM table parsing
  if (p.length <= 3 && !p.includes('/') && !p.includes('.')) return ''

  const parts = p.split('/')
  // Remove trailing filename (anything with a dot extension)
  const dirs = parts[parts.length - 1].includes('.') ? parts.slice(0, -1) : parts

  if (dirs.length === 0) return 'root/'

  // Monorepo: always use depth 2 for paths under known monorepo roots
  const effectiveDepth = (isMonorepo && MONOREPO_ROOTS.includes(dirs[0]) && dirs.length >= 2)
    ? 2
    : depth

  return dirs.slice(0, effectiveDepth).join('/') + '/'
}

function parseDecisions(content: string): Array<{ title: string; affects: string[]; risk: 'low' | 'medium' | 'high' }> {
  const out: Array<{ title: string; affects: string[]; risk: 'low' | 'medium' | 'high' }> = []
  for (const line of content.split('\n')) {
    if (!line.startsWith('|') || /^[|\s-]+$/.test(line) || /decision/i.test(line)) continue
    const cols = line.split('|').map(c => c.trim()).filter(Boolean)
    if (cols.length < 3) continue
    const risk = (['low', 'medium', 'high'].includes(cols[2]) ? cols[2] : 'low') as 'low' | 'medium' | 'high'
    out.push({
      title: cols[0].replace(/\[→\].*/g, '').trim(),
      affects: cols[1].split(',').map(a => a.trim()).filter(Boolean),
      risk,
    })
  }
  return out
}

function parseRejections(content: string): string[] {
  return [...content.matchAll(/^## (.+?) — rejected/gm)].map(m => m[1])
}

export function buildGraphData(root: string, opts: GraphOptions = {}): GraphData {
  const isMonorepo = opts.monorepo ?? detectMonorepo(root)
  const depth = opts.depth ?? (isMonorepo ? 2 : 2)   // default depth=2; future: allow 1 or 3

  const decisions = parseDecisions(readStore(root, 'decisions') ?? '')
  const rejectionTitles = parseRejections(readStore(root, 'rejected') ?? '')

  const nodeMap = new Map<string, GraphNode>()

  const node = (id: string): GraphNode => {
    if (!nodeMap.has(id)) nodeMap.set(id, { id, decisions: 0, rejections: 0, maxRisk: 'none', titles: [] })
    return nodeMap.get(id)!
  }

  const linkMap = new Map<string, GraphLink>()

  for (const d of decisions) {
    const mods = [...new Set(d.affects.map(a => toModule(a, depth, isMonorepo)))].filter(Boolean)
    for (const m of mods) {
      const n = node(m)
      n.decisions++
      n.titles.push(d.title)
      if (RISK_ORDER[d.risk] > RISK_ORDER[n.maxRisk]) n.maxRisk = d.risk
    }
    // Edges between every pair of modules in this decision
    for (let i = 0; i < mods.length; i++) {
      for (let j = i + 1; j < mods.length; j++) {
        const key = [mods[i], mods[j]].sort().join('::')
        if (!linkMap.has(key)) linkMap.set(key, { source: mods[i], target: mods[j], weight: 0, titles: [] })
        const l = linkMap.get(key)!
        l.weight++
        l.titles.push(d.title)
      }
    }
  }

  // Attribute rejections to modules they mention (best-effort substring match)
  for (const title of rejectionTitles) {
    for (const [id, n] of nodeMap) {
      if (title.toLowerCase().includes(id.replace(/\/$/, '').toLowerCase())) {
        n.rejections++
      }
    }
  }

  const nodes = [...nodeMap.values()].sort(
    (a, b) => (b.decisions + b.rejections) - (a.decisions + a.rejections)
  )

  return {
    nodes,
    links: [...linkMap.values()],
    generated: new Date().toISOString(),
    isMonorepo,
    stats: { decisions: decisions.length, rejections: rejectionTitles.length, modules: nodes.length },
  }
}
