# Decision Log

| Date | Decision | Affects | Risk | ADR |
|------|----------|---------|------|-----|
| 2026-04-10 | Monorepo: @chronicle/core library + CLI package split | packages/core/, packages/cli/ | medium | <!-- confidence:0.96 --> |
| 2026-04-10 | Inline HTML comments for decision metadata storage | packages/core/src/store.ts, packages/core/src/extractor.ts | high | <!-- confidence:0.95 --> |
| 2026-04-10 | Git hooks for automatic .lore/ updates on commit | packages/cli/src/commands/hooks.ts | medium | <!-- confidence:0.93 --> |
| 2026-04-10 | MCP server via stdio transport for Claude Code integration | packages/cli/src/commands/mcp.ts | medium | <!-- confidence:0.92 --> |
| 2026-04-10 | Python PyPI package wrapping Node CLI as primary distribution | packages/python/ | high | [→](decisions/python-pypi-as-primary-distribution.md) <!-- confidence:0.97 --> |
| 2026-04-10 | Bundle compiled cli.js inside Python wheel (no npm/npx required) | packages/python/chronicle/_dist/, .github/workflows/release.yml | high | <!-- confidence:0.96 --> |
| 2026-04-10 | Tool adapters: auto-setup integrations for 10+ AI coding tools | packages/cli/src/adapters/, packages/cli/src/commands/setup.ts | low | <!-- confidence:0.91 --> |
| 2026-04-10 | Evolution records use git tags as era boundaries | packages/core/src/evolution.ts | medium | <!-- confidence:0.90 --> |
| 2026-04-10 | Semantic clustering extraction strategy (v2): cluster by file overlap | packages/core/src/extractor.ts | high | [→](decisions/semantic-clustering-extraction-strategy.md) <!-- confidence:0.95 --> |
| 2026-04-10 | tsup with splitting=false to produce single-file CLI bundle | packages/cli/tsup.config.ts | medium | <!-- confidence:0.88 --> |
| 2026-04-10 | Web viewer (chronicle serve): single-page HTML for .lore/ browsing | packages/cli/src/commands/serve.ts | low | <!-- confidence:0.87 --> |
| 2026-04-10 | Scan depth defaults to "all" for initial coverage | packages/cli/src/commands/init.ts | low | <!-- confidence:0.85 --> |
| 2026-04-10 | chronicle graph: interactive HTML topology from module + decision data | packages/cli/src/commands/graph.ts | low | <!-- confidence:0.84 --> |
| 2026-04-11 | Git hook CI auto-update workflow (chronicle.yml) — closes the loop | .github/workflows/chronicle.yml | high | <!-- confidence:0.97 --> |
| 2026-04-11 | RAG quality eval harness: recall, MRR, confidence accuracy metrics | packages/cli/src/commands/eval.ts | medium | <!-- confidence:0.91 --> |
| 2026-04-11 | Semantic search with optional local embeddings (@huggingface/transformers) | packages/core/src/semantic-search.ts, packages/core/src/embeddings.ts | high | [→](decisions/semantic-search-with-local-embeddings.md) <!-- confidence:0.93 --> |
| 2026-04-11 | Multi-source ingestion: index repos, dirs, URLs, PDFs alongside git | packages/core/src/sources.ts, packages/core/src/ingestor.ts | medium | <!-- confidence:0.90 --> |
| 2026-04-11 | Decision DAG with Mermaid visualization (chronicle relate) | packages/core/src/relations.ts, packages/cli/src/commands/relate.ts | medium | <!-- confidence:0.92 --> |
| 2026-04-11 | Confidence stored as inline comment per decision row | packages/core/src/extractor.ts, packages/cli/src/commands/process.ts | medium | <!-- confidence:0.94 --> |
| 2026-04-11 | Few-shot worked examples in extraction prompt to anchor LLM calibration | packages/core/src/extractor.ts | medium | <!-- confidence:0.93 --> |
| 2026-04-11 | callWithRetry: exponential backoff retry on malformed JSON responses | packages/core/src/extractor.ts | medium | <!-- confidence:0.91 --> |
| 2026-04-11 | Diff truncation at 3000 chars with explicit NOTE to LLM | packages/core/src/extractor.ts | low | <!-- confidence:0.88 --> |
| 2026-04-11 | chronicle verify: CI freshness gate (exits 1 when lag > threshold) | packages/cli/src/commands/verify.ts | medium | <!-- confidence:0.90 --> |
| 2026-04-11 | chronicle process: batch CI processor with process.log for observability | packages/cli/src/commands/process.ts | medium | <!-- confidence:0.90 --> |
| 2026-04-11 | chronicle status: single-line health summary combining stats + lag | packages/cli/src/commands/status.ts, packages/cli/src/status.ts | low | <!-- confidence:0.89 --> |
| 2026-04-11 | Rename-based test isolation for findLoreRoot() in CI environments | packages/cli/src/__tests__/cli-smoke.test.ts | low | <!-- confidence:0.86 --> |
| 2026-04-12 | Confidence threshold filtering: low-confidence → low-confidence.md | packages/cli/src/commands/process.ts, packages/cli/src/status.ts | medium | <!-- confidence:0.94 --> |
| 2026-04-12 | callWithRetry ctx: mutable error counter for per-batch failure signaling | packages/core/src/extractor.ts | low | <!-- confidence:0.92 --> |
| 2026-04-12 | Remove two-pass strategy stub from ExtractionStrategy type | packages/core/src/extractor.ts | low | <!-- confidence:0.95 --> |
| 2026-04-12 | GitHub Actions job summary after chronicle process (CI observability) | .github/workflows/chronicle.yml | low | <!-- confidence:0.91 --> |
| 2026-04-12 | Evolution era fix: date-range filter + risk sorting + suppress keyFiles | packages/core/src/evolution.ts | medium | <!-- confidence:0.93 --> |
