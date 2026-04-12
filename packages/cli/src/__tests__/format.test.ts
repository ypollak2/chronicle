import { describe, it, expect } from 'vitest'
import { slugify, formatDecisionEntry, formatRejectionEntry, formatDeepADR } from '../format.js'
import type { ExtractionResult } from '@chronicle/core'

// ─── slugify ──────────────────────────────────────────────────────────────────

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Use JWT for Auth')).toBe('use-jwt-for-auth')
  })

  it('strips leading and trailing hyphens', () => {
    expect(slugify('--hello world--')).toBe('hello-world')
  })

  it('collapses consecutive non-alphanumeric chars into one hyphen', () => {
    expect(slugify('A & B: the plan!')).toBe('a-b-the-plan')
  })

  it('truncates to 60 characters', () => {
    const long = 'a'.repeat(80)
    expect(slugify(long)).toHaveLength(60)
  })

  it('handles empty string', () => {
    expect(slugify('')).toBe('')
  })

  it('handles digits', () => {
    expect(slugify('RFC 2119 compliance')).toBe('rfc-2119-compliance')
  })
})

// ─── formatDecisionEntry ─────────────────────────────────────────────────────

describe('formatDecisionEntry', () => {
  const base: ExtractionResult = {
    isDecision: true,
    isRejection: false,
    isDeep: false,
    title: 'Use JWT',
    affects: ['src/auth/', 'src/api/'],
    risk: 'high',
    rationale: 'Stateless auth reduces DB load',
  }

  it('includes title as heading', () => {
    expect(formatDecisionEntry(base)).toContain('## Use JWT')
  })

  it('lists affected files joined by comma', () => {
    const result = formatDecisionEntry(base)
    expect(result).toContain('src/auth/, src/api/')
  })

  it('includes risk level', () => {
    expect(formatDecisionEntry(base)).toContain('high')
  })

  it('includes rationale', () => {
    expect(formatDecisionEntry(base)).toContain('Stateless auth reduces DB load')
  })

  it('falls back to Unnamed when no title', () => {
    expect(formatDecisionEntry({ ...base, title: undefined })).toContain('## Unnamed')
  })

  it('falls back to dash when no affects', () => {
    const result = formatDecisionEntry({ ...base, affects: [] })
    expect(result).toContain('—')
  })

  it('falls back to low risk when risk missing', () => {
    const result = formatDecisionEntry({ ...base, risk: undefined })
    expect(result).toContain('low')
  })
})

// ─── formatRejectionEntry ─────────────────────────────────────────────────────

describe('formatRejectionEntry', () => {
  const base: ExtractionResult = {
    isDecision: false,
    isRejection: true,
    isDeep: false,
    title: 'GraphQL overlay',
    rejected: 'Team velocity dropped 40%',
    rationale: 'REST is sufficient for current needs',
  }

  it('includes title with rejected marker', () => {
    expect(formatRejectionEntry(base)).toContain('## GraphQL overlay — rejected')
  })

  it('includes rejection reason', () => {
    expect(formatRejectionEntry(base)).toContain('Team velocity dropped 40%')
  })

  it('includes rationale', () => {
    expect(formatRejectionEntry(base)).toContain('REST is sufficient')
  })

  it('falls back to Unnamed when no title', () => {
    expect(formatRejectionEntry({ ...base, title: undefined })).toContain('## Unnamed')
  })

  it('falls back to dash when no rejection reason', () => {
    expect(formatRejectionEntry({ ...base, rejected: undefined })).toContain('—')
  })
})

// ─── formatDeepADR ────────────────────────────────────────────────────────────

describe('formatDeepADR', () => {
  const base: ExtractionResult = {
    isDecision: true,
    isRejection: false,
    isDeep: true,
    title: 'Migrate to microservices',
    affects: ['services/', 'infra/'],
    risk: 'high',
    rationale: 'Scale auth and billing independently',
    rejected: 'Monolith was simpler but could not scale',
  }

  it('includes ADR title heading', () => {
    expect(formatDeepADR(base)).toContain('# ADR: Migrate to microservices')
  })

  it('includes a date', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(formatDeepADR(base)).toContain(today)
  })

  it('includes status as Accepted', () => {
    expect(formatDeepADR(base)).toContain('Accepted')
  })

  it('includes affected paths', () => {
    expect(formatDeepADR(base)).toContain('services/, infra/')
  })

  it('sets reversibility to low when risk is high', () => {
    expect(formatDeepADR(base)).toContain('low')
  })

  it('sets reversibility to medium when risk is medium', () => {
    const result = formatDeepADR({ ...base, risk: 'medium' })
    expect(result).toContain('medium')
  })

  it('sets reversibility to high when risk is low', () => {
    const result = formatDeepADR({ ...base, risk: 'low' })
    expect(result).toContain('high')
  })

  it('includes rejected alternatives section when rejected is set', () => {
    expect(formatDeepADR(base)).toContain('## Rejected Alternatives')
    expect(formatDeepADR(base)).toContain('Monolith was simpler')
  })

  it('omits rejected alternatives when not set', () => {
    const result = formatDeepADR({ ...base, rejected: undefined })
    expect(result).not.toContain('## Rejected Alternatives')
  })
})
