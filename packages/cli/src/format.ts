import type { ExtractionResult } from '@chronicle/core'

export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

export function formatDecisionEntry(d: ExtractionResult): string {
  const affects = (d.affects ?? []).join(', ') || '—'
  return `## ${d.title ?? 'Unnamed'}\n**Affects**: ${affects} | **Risk**: ${d.risk ?? 'low'}\n\n${d.rationale ?? ''}\n`
}

export function formatRejectionEntry(r: ExtractionResult): string {
  return `## ${r.title ?? 'Unnamed'} — rejected\n**Replaced by**: _(see decisions)_ | **Reason**: ${r.rejected ?? '—'}\n\n${r.rationale ?? ''}\n`
}

export function formatDeepADR(d: ExtractionResult): string {
  const date = new Date().toISOString().slice(0, 10)
  const affects = (d.affects ?? []).join(', ') || '—'
  const risk = d.risk ?? 'low'
  return `# ADR: ${d.title ?? 'Unnamed'}

**Date**: ${date}
**Status**: Accepted
**Affects**: ${affects}
**Risk**: ${risk}
**Reversibility**: ${risk === 'high' ? 'low' : risk === 'medium' ? 'medium' : 'high'}

## Decision

${d.rationale ?? '—'}

${d.rejected ? `## Rejected Alternatives\n\n${d.rejected}\n` : ''}## Consequences

_To be annotated as consequences become clear._
`
}
