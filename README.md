# Chronicle

> AI-native development memory — markdown RAG for every AI coding tool

Chronicle builds a living knowledge base inside your repo. It scans your git history, captures architectural decisions as you work, and injects compressed context into any AI coding tool — Claude Code, Codex, Cursor, Gemini CLI, Aider, and more.

**No vector database. No embeddings. Just markdown.**

## Why

Code shows what exists. It doesn't show what was tried and rejected, why an approach was chosen, or what a future AI session needs to know. Chronicle captures the invisible layer.

```
# What code looks like to an AI with Chronicle:

## Rejected: Prisma ORM — 2025-03-10
Replaced by raw `pg` queries. Type conflicts with existing Zod schemas caused
3 broken integration tests. Do not reintroduce until validation layer is unified.

## Decision: JWT over sessions — 2025-04-08 [high risk]
Affects: auth/, api/middleware.ts
OAuth vendor integration blocked until Q3. JWT allows stateless scaling.
```

## Install

```bash
npm install -g chronicle-dev
```

## Quick Start

```bash
# In any git repo
chronicle init                    # scans last 6 months of history
chronicle inject | claude         # pipe context into Claude
chronicle inject | codex          # or Codex
chronicle hooks install           # passive capture on every commit
```

## Commands

| Command | Description |
|---------|-------------|
| `chronicle init [--depth=6months\|1year\|all]` | Bootstrap from git history |
| `chronicle inject [--files=src/auth/]` | Output compressed context |
| `chronicle deepen [--depth=1year\|all]` | Extend scan further back |
| `chronicle hooks install` | Install git hooks for passive capture |
| `chronicle hooks remove` | Remove hooks |
| `chronicle mcp` | Start MCP server for Claude Code |

## Works With

| Tool | Integration |
|------|-------------|
| Claude Code | MCP server + hooks (native) |
| Codex | `chronicle inject \| codex` |
| Cursor | `.cursorrules` auto-generated |
| Gemini CLI | `GEMINI.md` auto-generated |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Aider | `--read .lore/index.md` |
| Any tool | `chronicle inject` → stdout pipe |

## The `.lore/` Store

```
.lore/
├── index.md          # Project summary + key constraints
├── decisions.md      # Lightweight index of all decisions
├── decisions/        # Deep ADR files for complex decisions
├── rejected.md       # What was tried and why it failed ← crown jewel
├── risks.md          # High-blast-radius files
├── evolution.md      # System milestones timeline
├── diagrams/         # Auto-generated Mermaid diagrams
└── sessions/         # Per-session AI summaries
```

## Claude Code Setup

See [CLAUDE_CODE_SETUP.md](./CLAUDE_CODE_SETUP.md) for MCP + hooks configuration.

## Roadmap

- [x] Phase 0: git history bootstrap with progressive depth
- [x] Phase 1: core CLI (init, inject, deepen)
- [x] Phase 2: git hooks (passive capture)
- [x] Phase 3: MCP server (Claude Code native)
- [ ] Phase 4: tool adapters (Cursor, Aider, Gemini, Copilot)
- [ ] Phase 5: Mermaid diagram generation
- [ ] Phase 6: evolution records + timeline
- [ ] Phase 7 (v2): semantic clustering extraction strategy
- [ ] Phase 8 (v3): two-pass extraction (cheap filter + quality model)

## License

MIT
