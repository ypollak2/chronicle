# ADR: Activate Claude Code integration — SessionStart hook + MCP server

**Date**: 2026-04-15
**Status**: Accepted
**Affects**: ../.claude/settings.json, ./Projects/chronicle/.claude/settings.json, ./Projects/chronicle/.claude/mcp.json
**Risk**: low

## Decision

Eliminate per-session context loss. Chronicle MCP server now auto-injects .lore/ decisions at session start in all projects. Unlocks use of 35+ documented architectural decisions and prevents knowledge loss between sessions.

## Consequences

_To be annotated as consequences become clear._
