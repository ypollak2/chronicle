# ADR: Semantic Clustering Extraction Strategy (v2)

**Date**: 2026-04-10
**Status**: Accepted
**Risk**: High

## Context

The v1 extraction strategy batched commits in sequential groups of 6 (capped at 5000 chars). This worked but produced suboptimal results when related commits were split across batches — the LLM lost cross-commit context needed to identify that multiple changes constituted a single architectural decision.

## Decision

Implement a file-overlap clustering strategy (v2):
1. Parse the file set touched by each commit from its diff headers (`diff --git a/... b/...`)
2. Group commits into clusters where any two members share at least one touched file
3. Merge isolated commits (no file overlap with neighbors) into small batches of 4
4. Send one LLM call per cluster/batch

## Consequences

**Positive:**
- Related commits (e.g., "add Redis connection" + "update queue to use Redis") land in the same batch, giving the LLM the full picture
- Isolated noise commits (bumps, formatting) are grouped together rather than padded into cohesive clusters
- Produces fewer, higher-signal decisions with better rationale

**Negative:**
- More complex batching logic vs. fixed-size sequential
- Clusters can hit the `MAX_CLUSTER_CHARS = 8000` ceiling on large feature branches, requiring fallback

## Rejected Alternative: Sequential fixed batches

The simple v1 strategy (still available as `--strategy simple`) splits arbitrarily by order. It works well enough for small repos and is the default for `chronicle process` in CI (faster, predictable).
