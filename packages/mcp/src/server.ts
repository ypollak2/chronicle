#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  findLoreRoot, readStore, appendToStore, writeDeepDecision, lorePath,
  type ExtractionResult
} from '@chronicle/core'
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs'
import { join } from 'path'

const server = new McpServer({
  name: 'chronicle',
  version: '0.1.0',
})

// ── Tool: get context ────────────────────────────────────────────────────────
// Called on SessionStart — injects compressed project knowledge
server.tool(
  'chronicle_get_context',
  'Get compressed project context: decisions, rejections, risks, last session',
  {
    files: z.string().max(2000).optional().describe('Comma-separated file paths to scope context to'),
    full: z.boolean().optional().describe('Include all deep ADR files'),
  },
  async ({ files, full }) => {
    const root = findLoreRoot()
    if (!root) return { content: [{ type: 'text', text: '(no .lore/ found — run `chronicle init`)' }] }

    const sections: string[] = []

    const index = readStore(root, 'index')
    if (index) sections.push(index)

    sections.push(readStore(root, 'decisions'))
    sections.push(readStore(root, 'rejected'))

    const risks = readStore(root, 'risks')
    if (risks && files) {
      const scoped = risks.split('\n')
        .filter(l => files.split(',').some(f => l.includes(f.trim())) || l.startsWith('#'))
        .join('\n')
      if (scoped.trim()) sections.push(scoped)
    } else if (risks) {
      sections.push(risks)
    }

    if (full) {
      const deepDir = lorePath(root, 'decisions')
      if (existsSync(deepDir)) {
        for (const f of readdirSync(deepDir).filter(f => f.endsWith('.md'))) {
          sections.push(readFileSync(join(deepDir, f), 'utf8'))
        }
      }
    }

    const lastSession = getLastSession(root)
    if (lastSession) sections.push(`## Last Session\n${lastSession}`)

    return {
      content: [{
        type: 'text',
        text: `<!-- chronicle context -->\n${sections.filter(Boolean).join('\n\n---\n\n')}\n<!-- end chronicle context -->`,
      }]
    }
  }
)

// ── Tool: log decision ───────────────────────────────────────────────────────
// AI calls this when it makes an architectural choice mid-session
server.tool(
  'chronicle_log_decision',
  'Log an architectural decision made during this session',
  {
    title: z.string().max(200).describe('Short title of the decision'),
    rationale: z.string().max(4000).describe('Why this decision was made'),
    affects: z.array(z.string().max(500)).max(50).describe('File paths or module names affected'),
    risk: z.enum(['low', 'medium', 'high']).describe('Reversibility risk'),
    isDeep: z.boolean().optional().describe('True if this warrants a full ADR document'),
  },
  async ({ title, rationale, affects, risk, isDeep }) => {
    const root = findLoreRoot()
    if (!root) return { content: [{ type: 'text', text: 'No .lore/ found' }] }

    const date = new Date().toISOString().slice(0, 10)
    const slug = slugify(title)
    const deepLink = isDeep ? ` [→](decisions/${slug}.md)` : ''

    appendToStore(root, 'decisions',
      `| ${title.slice(0, 50)} | ${affects.join(', ').slice(0, 40)} | ${risk} |${deepLink} |`
    )

    if (isDeep) {
      writeDeepDecision(root, slug, formatADR({ title, rationale, affects, risk, date }))
    }

    return { content: [{ type: 'text', text: `✓ Decision logged: ${title}` }] }
  }
)

// ── Tool: log rejection ──────────────────────────────────────────────────────
// AI calls this when it abandons an approach — the crown jewel of Chronicle
server.tool(
  'chronicle_log_rejection',
  'Log an approach that was tried and abandoned — prevents future AI from repeating the mistake',
  {
    what: z.string().max(200).describe('What was tried'),
    why: z.string().max(4000).describe('Why it was abandoned'),
    replacedBy: z.string().max(200).optional().describe('What replaced it'),
  },
  async ({ what, why, replacedBy }) => {
    const root = findLoreRoot()
    if (!root) return { content: [{ type: 'text', text: 'No .lore/ found' }] }

    const date = new Date().toISOString().slice(0, 10)
    const entry = `## ${what} — rejected ${date}\n**Replaced by**: ${replacedBy ?? 'n/a'}\n\n${why}\n`
    appendToStore(root, 'rejected', entry)

    return { content: [{ type: 'text', text: `✓ Rejection logged: ${what}` }] }
  }
)

// ── Tool: get risks ──────────────────────────────────────────────────────────
// AI calls this before touching a file to check blast radius
server.tool(
  'chronicle_get_risks',
  'Get risk information for files before modifying them',
  {
    files: z.array(z.string().max(500)).max(100).describe('File paths to check'),
  },
  async ({ files }) => {
    const root = findLoreRoot()
    if (!root) return { content: [{ type: 'text', text: 'No .lore/ found' }] }

    const risks = readStore(root, 'risks')
    if (!risks) return { content: [{ type: 'text', text: 'No risk data yet' }] }

    const relevant = risks
      .split('\n')
      .filter(l => files.some(f => l.includes(f)) || l.startsWith('#'))
      .join('\n')

    return {
      content: [{
        type: 'text',
        text: relevant || `No specific risks recorded for: ${files.join(', ')}`,
      }]
    }
  }
)

// ── Tool: save session ───────────────────────────────────────────────────────
// Called by Stop hook — summarizes what happened in this session
server.tool(
  'chronicle_save_session',
  'Save a summary of the current session to .lore/sessions/',
  {
    summary: z.string().max(8000).describe('What was accomplished this session'),
    pending: z.string().max(4000).optional().describe('What is still in progress or left to do'),
    decisions: z.array(z.string().max(200)).max(100).optional().describe('Key decisions made this session'),
  },
  async ({ summary, pending, decisions }) => {
    const root = findLoreRoot()
    if (!root) return { content: [{ type: 'text', text: 'No .lore/ found' }] }

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)  // 2026-04-12T14-30-00
    const date = ts.slice(0, 10)
    const content = [
      `# Session ${date}`,
      `\n## What was done\n${summary}`,
      decisions?.length ? `\n## Decisions made\n${decisions.map(d => `- ${d}`).join('\n')}` : '',
      pending ? `\n## Pending\n${pending}` : '',
    ].filter(Boolean).join('\n')

    const sessionsDir = lorePath(root, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    const filename = `${ts}.md`
    writeFileSync(join(sessionsDir, filename), content)

    return { content: [{ type: 'text', text: `✓ Session saved to .lore/sessions/${filename}` }] }
  }
)

// ─── helpers ─────────────────────────────────────────────────────────────────

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

function getLastSession(root: string): string | null {
  const dir = lorePath(root, 'sessions')
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort().reverse()
  return files[0] ? readFileSync(join(dir, files[0]), 'utf8') : null
}

function formatADR(d: { title: string; rationale: string; affects: string[]; risk: string; date: string }): string {
  return `# ADR: ${d.title}\n\n**Date**: ${d.date}\n**Status**: Accepted\n**Affects**: ${d.affects.join(', ')}\n**Risk**: ${d.risk}\n\n## Decision\n\n${d.rationale}\n\n## Consequences\n\n_To be annotated as consequences become clear._\n`
}

// ─── start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
