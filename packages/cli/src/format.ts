import type { ExtractionResult } from '@chronicle/core'

export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

export function formatDecisionEntry(d: ExtractionResult): string {
  return `## ${d.title}\n**Affects**: ${d.affects.join(', ')} | **Risk**: ${d.risk}\n\n${d.rationale}\n`
}

export function formatRejectionEntry(r: ExtractionResult): string {
  return `## ${r.title} — rejected\n**Replaced by**: _(see decisions)_ | **Reason**: ${r.rejected}\n\n${r.rationale}\n`
}

export function formatDeepADR(d: ExtractionResult): string {
  const date = new Date().toISOString().slice(0, 10)
  return `# ADR: ${d.title}

**Date**: ${date}
**Status**: Accepted
**Affects**: ${d.affects.join(', ')}
**Risk**: ${d.risk}
**Reversibility**: ${d.risk === 'high' ? 'low' : d.risk === 'medium' ? 'medium' : 'high'}

## Decision

${d.rationale}

${d.rejected ? `## Rejected Alternatives\n\n${d.rejected}\n` : ''}
## Consequences

_To be annotated as consequences become clear._
`
}
