import { readStore } from '@chronicle/core'

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
  stats: { decisions: number; rejections: number; modules: number }
}

const RISK_ORDER = { none: 0, low: 1, medium: 2, high: 3 }

// "src/auth/jwt.ts" → "src/auth/"   "auth/" → "auth/"   "README.md" → "root"
// Skips truncated fragments like "sav" or "ru" (no slash, too short, no extension)
function toModule(raw: string): string {
  const p = raw.trim().replace(/^\/|\/$/g, '')
  if (!p) return ''
  // Looks truncated: ≤3 chars, no dot extension, no slash — skip
  if (p.length <= 3 && !p.includes('/') && !p.includes('.')) return ''
  if (p.endsWith('/')) return p
  if (!p.includes('/')) return p + '/'          // top-level dir like "auth"
  if (p.includes('.') && !p.endsWith('/')) {    // looks like a file
    return p.split('/').slice(0, -1).join('/') + '/'
  }
  return p.split('/').slice(0, -1).join('/') + '/'
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

export function buildGraphData(root: string): GraphData {
  const decisions = parseDecisions(readStore(root, 'decisions') ?? '')
  const rejectionTitles = parseRejections(readStore(root, 'rejected') ?? '')

  const nodeMap = new Map<string, GraphNode>()

  const node = (id: string): GraphNode => {
    if (!nodeMap.has(id)) nodeMap.set(id, { id, decisions: 0, rejections: 0, maxRisk: 'none', titles: [] })
    return nodeMap.get(id)!
  }

  const linkMap = new Map<string, GraphLink>()

  for (const d of decisions) {
    const mods = [...new Set(d.affects.map(toModule))].filter(Boolean)
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
    stats: { decisions: decisions.length, rejections: rejectionTitles.length, modules: nodes.length },
  }
}
