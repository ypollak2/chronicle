# Rejected Approaches

## npm as sole distribution channel — rejected (2026-04-10)
**Replaced by**: PyPI as primary, npm as secondary
**Reason**: Python developers (the primary AI coding tool users) don't have npm. `pip install chronicle-dev` is zero-friction. Publishing to both registries keeps both audiences covered.

## Separate @chronicle/mcp package — rejected (2026-04-10)
**Replaced by**: MCP command integrated directly in the CLI (`chronicle mcp`)
**Reason**: Shipping a separate npm package for MCP would require users to install two packages and keep versions in sync. Bundling into the CLI keeps the install path `pip install chronicle-dev` with no extra steps.

## Per-commit LLM calls (no batching) — rejected (2026-04-10)
**Replaced by**: Batch processing (6 commits per call, capped at 5000 chars)
**Reason**: Per-commit calls would burn 10–50× more tokens and hit rate limits on large repos. Batching amortizes prompt overhead and gives the LLM cross-commit context for better signal quality.

## two-pass extraction strategy — rejected (2026-04-12)
**Replaced by**: Removal from ExtractionStrategy type
**Reason**: The strategy was typed as valid but threw "not implemented" at runtime, misleading users. Either implement it or remove it — removing is safer until there's a concrete design. Will reconsider when confidence gating is stable.

## SQLite extraction cache — rejected (2026-04-10)
**Replaced by**: JSON file cache (.extraction-cache.json)
**Reason**: SQLite adds a native dependency that breaks PyPI wheel portability. A flat JSON cache (hash → result) covers the use case with zero dependencies and is trivially inspectable.

## Real-time streaming output during chronicle init — rejected (2026-04-10)
**Replaced by**: Spinner with percentage progress
**Reason**: Streaming requires keeping the LLM connection open during the whole init run, which conflicts with the concurrent batching strategy. An `ora` spinner is sufficient and works with concurrent processing.
