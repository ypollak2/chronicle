import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  findLoreRoot, readStore, appendToStore, writeDeepDecision, lorePath,
} from '@chronicle/core'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'

export async function cmdMcp() {
  const server = new McpServer({
    name: 'chronicle',
    version: '0.5.1',
  })

  // ── chronicle_get_context ────────────────────────────────────────────────────
  server.tool(
    'chronicle_get_context',
    'Get compressed project context: decisions, rejections, risks, last session',
    {
      files: z.string().optional().describe('Comma-separated file paths to scope context to'),
      full: z.boolean().optional().describe('Include all deep ADR files'),
    },
    async ({ files, full }) => {
      const root = findLoreRoot()
      if (!root) return { content: [{ type: 'text' as const, text: '(no .lore/ found — run `chronicle init`)' }] }

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
          type: 'text' as const,
          text: `<!-- chronicle context -->\n${sections.filter(Boolean).join('\n\n---\n\n')}\n<!-- end chronicle context -->`,
        }]
      }
    }
  )

  // ── chronicle_log_decision ───────────────────────────────────────────────────
  server.tool(
    'chronicle_log_decision',
    'Log an architectural decision made during this session',
    {
      title: z.string().describe('Short title of the decision'),
      rationale: z.string().describe('Why this decision was made'),
      affects: z.array(z.string()).describe('File paths or module names affected'),
      risk: z.enum(['low', 'medium', 'high']).describe('Reversibility risk'),
      isDeep: z.boolean().optional().describe('True if this warrants a full ADR document'),
    },
    async ({ title, rationale, affects, risk, isDeep }) => {
      const root = findLoreRoot()
      if (!root) return { content: [{ type: 'text' as const, text: 'No .lore/ found' }] }

      const date = new Date().toISOString().slice(0, 10)
      const slug = slugify(title)
      const deepLink = isDeep ? ` [→](decisions/${slug}.md)` : ''
      appendToStore(root, 'decisions',
        `| ${title.slice(0, 50)} | ${affects.join(', ').slice(0, 40)} | ${risk} |${deepLink} |`
      )
      if (isDeep) {
        writeDeepDecision(root, slug,
          `# ADR: ${title}\n\n**Date**: ${date}\n**Status**: Accepted\n**Affects**: ${affects.join(', ')}\n**Risk**: ${risk}\n\n## Decision\n\n${rationale}\n\n## Consequences\n\n_To be annotated as consequences become clear._\n`
        )
      }
      return { content: [{ type: 'text' as const, text: `✓ Decision logged: ${title}` }] }
    }
  )

  // ── chronicle_log_rejection ──────────────────────────────────────────────────
  server.tool(
    'chronicle_log_rejection',
    'Log an approach that was tried and abandoned — prevents future AI from repeating the mistake',
    {
      what: z.string().describe('What was tried'),
      why: z.string().describe('Why it was abandoned'),
      replacedBy: z.string().optional().describe('What replaced it'),
    },
    async ({ what, why, replacedBy }) => {
      const root = findLoreRoot()
      if (!root) return { content: [{ type: 'text' as const, text: 'No .lore/ found' }] }

      const date = new Date().toISOString().slice(0, 10)
      appendToStore(root, 'rejected',
        `## ${what} — rejected ${date}\n**Replaced by**: ${replacedBy ?? 'n/a'}\n\n${why}\n`
      )
      return { content: [{ type: 'text' as const, text: `✓ Rejection logged: ${what}` }] }
    }
  )

  // ── chronicle_get_risks ──────────────────────────────────────────────────────
  server.tool(
    'chronicle_get_risks',
    'Get risk information for files before modifying them',
    {
      files: z.array(z.string()).describe('File paths to check'),
    },
    async ({ files }) => {
      const root = findLoreRoot()
      if (!root) return { content: [{ type: 'text' as const, text: 'No .lore/ found' }] }

      const risks = readStore(root, 'risks')
      if (!risks) return { content: [{ type: 'text' as const, text: 'No risk data yet' }] }

      const relevant = risks.split('\n')
        .filter(l => files.some(f => l.includes(f)) || l.startsWith('#'))
        .join('\n')

      return {
        content: [{
          type: 'text' as const,
          text: relevant || `No specific risks recorded for: ${files.join(', ')}`,
        }]
      }
    }
  )

  // ── chronicle_save_session ───────────────────────────────────────────────────
  server.tool(
    'chronicle_save_session',
    'Save a summary of the current session to .lore/sessions/',
    {
      summary: z.string().describe('What was accomplished this session'),
      pending: z.string().optional().describe('What is still in progress'),
      decisions: z.array(z.string()).optional().describe('Key decisions made this session'),
    },
    async ({ summary, pending, decisions }) => {
      const root = findLoreRoot()
      if (!root) return { content: [{ type: 'text' as const, text: 'No .lore/ found' }] }

      const date = new Date().toISOString().slice(0, 10)
      const sessionsDir = lorePath(root, 'sessions')
      mkdirSync(sessionsDir, { recursive: true })

      const content = [
        `# Session ${date}`,
        `\n## What was done\n${summary}`,
        decisions?.length ? `\n## Decisions made\n${decisions.map(d => `- ${d}`).join('\n')}` : '',
        pending ? `\n## Pending\n${pending}` : '',
      ].filter(Boolean).join('\n')

      writeFileSync(join(sessionsDir, `${date}.md`), content)
      return { content: [{ type: 'text' as const, text: `✓ Session saved to .lore/sessions/${date}.md` }] }
    }
  )

  // ── chronicle_search ─────────────────────────────────────────────────────────
  server.tool(
    'chronicle_search',
    'Search the .lore/ knowledge base for a term or concept',
    {
      query: z.string().describe('Search term or phrase'),
    },
    async ({ query }) => {
      const root = findLoreRoot()
      if (!root) return { content: [{ type: 'text' as const, text: 'No .lore/ found' }] }

      const loreDir = lorePath(root)
      const pattern = new RegExp(query, 'gi')
      const hits: string[] = []

      function walk(dir: string) {
        if (!existsSync(dir)) return
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name)
          if (entry.isDirectory()) { walk(full); continue }
          if (!entry.name.endsWith('.md')) continue
          const lines = readFileSync(full, 'utf8').split('\n')
          for (let i = 0; i < lines.length && hits.length < 10; i++) {
            pattern.lastIndex = 0
            if (pattern.test(lines[i])) {
              hits.push(`${full.replace(loreDir + '/', '')}:${i + 1}: ${lines[i].trim()}`)
            }
          }
        }
      }
      walk(loreDir)

      return {
        content: [{
          type: 'text' as const,
          text: hits.length ? hits.join('\n') : `No results for "${query}"`,
        }]
      }
    }
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

function getLastSession(root: string): string | null {
  const dir = lorePath(root, 'sessions')
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter(f => f.endsWith('.md')).sort().reverse()
  return files[0] ? readFileSync(join(dir, files[0]), 'utf8') : null
}
