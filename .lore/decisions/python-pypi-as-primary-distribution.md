# ADR: Python PyPI as Primary Distribution Channel

**Date**: 2026-04-10
**Status**: Accepted
**Risk**: High

## Context

Chronicle targets developers who use AI coding tools (Claude Code, Cursor, Aider, Copilot, etc.). These tools are used by both Python and JavaScript developers, but the install story needs to be as simple as possible. npm requires Node.js, which many Python developers don't have configured globally.

## Decision

Distribute Chronicle primarily via PyPI (`pip install chronicle-dev`). The npm packages (`@chronicle/core`, `chronicle-dev`) are still published for JavaScript/TypeScript ecosystem users, but PyPI is the recommended install path in all documentation.

## Consequences

**Positive:**
- `pip install chronicle-dev` works on any machine with Python ≥ 3.8 (default on all macOS/Linux)
- No need to configure npm, npx, or node version managers
- PyPI package can vendor the compiled Node CLI, so `node` is the only additional runtime requirement

**Negative:**
- Release pipeline must build and publish to two registries
- Python version must be kept in sync with CLI package.json (solved by `scripts/sync-python-version.js`)
- The Python package is a thin wrapper — its real contents are TypeScript — which is unusual

## Rejected Alternative: npm-only

Dropped because the target user base (AI tool users) skews heavily Python. Requiring npm as a prerequisite would add unnecessary friction and exclude the audience we most want to reach.
