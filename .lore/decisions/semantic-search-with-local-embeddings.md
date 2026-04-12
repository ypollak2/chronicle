# ADR: Semantic Search with Optional Local Embeddings

**Date**: 2026-04-11
**Status**: Accepted
**Risk**: High

## Context

Keyword search over decisions.md works for exact terms but fails for semantic queries (e.g., "caching strategy" doesn't match a decision titled "Switch from in-memory to Redis"). Users asking their AI tool "what do we know about performance?" need vector similarity, not grep.

## Decision

Implement semantic search using `@huggingface/transformers` for local inference:
- Optional dependency — Chronicle works without it (keyword-only search)
- If installed, embed each decision row as a vector; cache embeddings in `.lore/embeddings.json`
- `chronicle search --semantic` uses pure vector similarity
- `chronicle search --hybrid` blends semantic (α=0.7) + keyword BM25 scores
- Graceful degradation: if `embed()` returns null, fall back to keyword results

## Consequences

**Positive:**
- No external API call — embeddings computed locally, no privacy concerns
- Embedding cache survives decisions.md edits (content-hash keyed)
- `chronicle inject --query "..."` can semantically rank decisions before trimming to token budget

**Negative:**
- First run downloads ~90MB model (all-MiniLM-L6-v2)
- Adds `@huggingface/transformers` as an optional dependency (~50MB install)
- Local inference is CPU-bound (~100ms per query without GPU)

## Rejected Alternative: External embedding API (OpenAI, Cohere)

Dropped because: (1) requires an API key even for a read operation, (2) sends decision content to a third party, (3) adds cost per query. Local inference aligns with Chronicle's air-gap and privacy goals.
