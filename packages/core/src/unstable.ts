/**
 * @chronicle/core/unstable — deferred-scope exports
 *
 * These APIs are NOT part of the stable v1.0 surface. They are used internally
 * by deferred commands (add, ingest) that are excluded from the v1.0 CLI.
 *
 * Breaking changes may occur in any release. Do not depend on this module in
 * external packages.
 */
export * from './sources.js'
export * from './ingestor.js'
