/**
 * Decision relationship DAG (I1).
 *
 * Relations are stored as inline HTML comments within decisions.md rows,
 * using the same pattern as <!-- confidence:X --> and <!-- stale -->.
 *
 * Format: <!-- relations:{"dependsOn":["title"],"supersedes":["title"],"relatedTo":["title"]} -->
 *
 * This is backward-compatible — rows without the comment have empty relations.
 */

export interface DecisionRelations {
  dependsOn?: string[]
  supersedes?: string[]
  relatedTo?: string[]
}

export type RelationType = keyof DecisionRelations

/**
 * Parse relations from a single decisions.md row.
 */
export function parseRelations(row: string): DecisionRelations {
  const match = row.match(/<!-- relations:(.*?) -->/)
  if (!match) return {}
  try { return JSON.parse(match[1]) } catch { return {} }
}

/**
 * Serialize a DecisionRelations object to the inline comment format.
 * Returns empty string if no relations are present.
 */
export function serializeRelations(rels: DecisionRelations): string {
  const clean: DecisionRelations = {}
  if (rels.dependsOn?.length) clean.dependsOn = rels.dependsOn
  if (rels.supersedes?.length) clean.supersedes = rels.supersedes
  if (rels.relatedTo?.length) clean.relatedTo = rels.relatedTo
  if (!Object.keys(clean).length) return ''
  return `<!-- relations:${JSON.stringify(clean)} -->`
}

/**
 * Add a relation of the given type to a row.
 * Idempotent — does not add duplicate targets.
 */
export function addRelationToRow(row: string, type: RelationType, target: string): string {
  const existing = parseRelations(row)
  const arr = existing[type] ?? []
  if (arr.includes(target)) return row
  const updated: DecisionRelations = { ...existing, [type]: [...arr, target] }
  const newComment = serializeRelations(updated)
  const existingComment = row.match(/<!-- relations:.*? -->/)
  if (existingComment) return row.replace(existingComment[0], newComment)
  return row.trimEnd() + ' ' + newComment
}

/**
 * Remove a specific relation from a row.
 */
export function removeRelationFromRow(row: string, type: RelationType, target: string): string {
  const existing = parseRelations(row)
  const arr = (existing[type] ?? []).filter(t => t !== target)
  const updated: DecisionRelations = { ...existing, [type]: arr.length ? arr : undefined }
  const newComment = serializeRelations(updated)
  const existingComment = row.match(/<!-- relations:.*? -->/)
  if (!existingComment) return row
  if (!newComment) return row.replace(/\s*<!-- relations:.*? -->/, '')
  return row.replace(existingComment[0], newComment)
}

/**
 * Extract the decision title from a table row (second column after date).
 * Returns null if the row is not a data row.
 */
export function extractTitleFromRow(row: string): string | null {
  const match = row.match(/^\|\s*\d{4}-\d{2}-\d{2}\s*\|\s*([^|]+?)\s*\|/)
  if (!match) return null
  // Strip inline comments from title
  return match[1].replace(/<!--.*?-->/g, '').trim()
}

/**
 * Build a relation graph from a decisions.md table.
 * Returns Map<title → relations> for all rows that have at least one relation.
 */
export function buildRelationGraph(content: string): Map<string, DecisionRelations> {
  const graph = new Map<string, DecisionRelations>()
  for (const line of content.split('\n')) {
    if (!line.startsWith('|')) continue
    const title = extractTitleFromRow(line)
    const rels = parseRelations(line)
    if (title && (rels.dependsOn?.length || rels.supersedes?.length || rels.relatedTo?.length)) {
      graph.set(title, rels)
    }
  }
  return graph
}

/**
 * Find all rows that reference a given title (direct or partial match).
 * Used in inject to pull in related context automatically.
 */
export function getRelatedRows(content: string, targetTitle: string): string[] {
  const needle = targetTitle.toLowerCase()
  const result: string[] = []
  for (const line of content.split('\n')) {
    if (!line.startsWith('|')) continue
    const rels = parseRelations(line)
    const refs = [
      ...(rels.dependsOn ?? []),
      ...(rels.supersedes ?? []),
      ...(rels.relatedTo ?? []),
    ]
    if (refs.some(r => r.toLowerCase().includes(needle))) result.push(line)
  }
  return result
}

/**
 * Update a decisions.md table: find the row whose title matches titleKey
 * and return the updated content with the new relation applied.
 */
export function applyRelationToContent(
  content: string,
  titleKey: string,
  type: RelationType,
  target: string
): { updated: string; found: boolean } {
  const needle = titleKey.toLowerCase()
  let found = false
  const lines = content.split('\n').map(line => {
    if (!line.startsWith('|')) return line
    const title = extractTitleFromRow(line)
    if (title && title.toLowerCase().includes(needle)) {
      found = true
      return addRelationToRow(line, type, target)
    }
    return line
  })
  return { updated: lines.join('\n'), found }
}
