# Chronicle

> AI-native development memory — markdown RAG for every AI coding tool

[![CI](https://github.com/ypollak2/chronicle/actions/workflows/ci.yml/badge.svg)](https://github.com/ypollak2/chronicle/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/chronicle-dev)](https://www.npmjs.com/package/chronicle-dev)
[![PyPI](https://img.shields.io/pypi/v/chronicle-dev)](https://pypi.org/project/chronicle-dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Chronicle builds a living knowledge base inside your repo. It scans your git history, captures architectural decisions as you work, and injects compressed context into any AI coding tool — without a vector database, without embeddings, without infrastructure.

**Just markdown files.**

> **Roadmap:** Chronicle is growing into a full multi-source RAG system — semantic search, multi-repo federation, non-git knowledge ingestion, and a RAG quality eval harness. See [ROADMAP.md](./ROADMAP.md) for the versioned plan.

---

## Why

Code shows what *exists*. It doesn't show:
- What was **tried and rejected** (and why)
- Why a particular approach was **chosen over alternatives**
- What context a future AI session **needs to not repeat past mistakes**

Chronicle captures the invisible layer.

```markdown
## Rejected: Prisma ORM — 2025-03-10
Replaced by raw `pg` queries. Type conflicts with Zod schemas caused
3 broken integration tests. Do not reintroduce.

## Decision: JWT over sessions — 2025-04-08 [risk: high]
Affects: auth/, api/middleware.ts
OAuth vendor blocked until Q3. JWT allows stateless scaling.
```

In ~200 tokens, your next AI session knows what took you days to learn.

---

## Install

```bash
pip install chronicle-dev
```

**Requires Python ≥ 3.9 and Node.js ≥ 20.**

The pip package bundles the Node.js CLI — no separate `npm install` needed.

### LLM provider

Chronicle needs one API key to analyze your git history:

| Provider | Env var | Notes |
|----------|---------|-------|
| **Gemini** (default) | `GEMINI_API_KEY` | Free tier. Fast, high quality |
| **OpenAI** | `OPENAI_API_KEY` | GPT-4o-mini |
| **Anthropic** | `ANTHROPIC_API_KEY` | Claude Haiku |
| **Ollama** | _(none)_ | Local, free, slower |

```bash
export GEMINI_API_KEY=...    # get from aistudio.google.com/apikey
chronicle init --llm gemini  # or anthropic / openai / ollama
```

---

## Quick Start

```bash
# Bootstrap from the last 6 months of git history
chronicle init

# Pipe context into any AI tool
chronicle inject | claude
chronicle inject | codex
chronicle inject | aider

# Install passive capture (runs after every git commit)
chronicle hooks install

# Scan further back when you're ready
chronicle deepen --depth=1year
```

---

## How It Works

### 1. Bootstrap (one-time)

`chronicle init` scans your git history, filters noise (chore/style/docs commits, tiny diffs), and sends meaningful commits in batches to a cheap LLM (Haiku/Flash/GPT-4o-mini). Extraction results are cached by commit SHA — re-running is free.

### 2. Capture (ongoing)

A `post-commit` git hook fires asynchronously after every commit. It processes only the new commit, checks the cache, and appends to your `.lore/` store. Zero latency on your workflow.

### 3. Inject (per session)

`chronicle inject` reads your `.lore/` store and outputs compressed context. Scope it to specific files for precision, or pipe the full context for cross-cutting tasks.

```bash
chronicle inject --files=src/auth/     # scoped: only auth-relevant context
chronicle inject --full                # everything including deep ADRs
chronicle inject --format=xml          # XML format for Claude system prompts
```

---

## The `.lore/` Store

```
.lore/
├── index.md          Project summary + constraints
├── decisions.md      Lightweight index of all decisions
├── decisions/        Deep ADR files for complex decisions
├── rejected.md       What was tried and failed ← most valuable
├── risks.md          High-blast-radius files
├── evolution.md      System timeline
├── diagrams/         Mermaid diagrams (auto-generated)
└── sessions/         Per-session AI summaries
```

Commit `.lore/` to git. It's the institutional memory of your codebase.

---

## Works With Every AI Tool

| Tool | Integration |
|------|-------------|
| **Claude Code** | MCP server + auto-inject hooks (native) |
| **Codex** | `chronicle inject \| codex` |
| **Cursor** | `.cursorrules` auto-generated |
| **Gemini CLI** | `GEMINI.md` auto-generated |
| **GitHub Copilot** | `.github/copilot-instructions.md` |
| **Aider** | `chronicle inject \| aider` or `--read .lore/` |
| **OpenCode / Trae / Factory** | `chronicle inject` stdout pipe |
| **Any tool** | `chronicle inject` → stdout |

---

## Claude Code Setup

Add to `.claude/mcp.json`:

```json
{
  "servers": {
    "chronicle": { "command": "chronicle", "args": ["mcp"] }
  }
}
```

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": "chronicle inject --format=markdown 2>/dev/null || true",
    "Stop": "chronicle capture --from-commit HEAD 2>/dev/null || true"
  }
}
```

Chronicle tools Claude calls automatically:
- `chronicle_log_decision` — when making architectural choices
- `chronicle_log_rejection` — when abandoning an approach
- `chronicle_get_risks` — before touching high-blast-radius files
- `chronicle_save_session` — at session end

---

## Commands

| Command | Description |
|---------|-------------|
| `chronicle init [--depth=6months\|1year\|all] [--llm=gemini\|anthropic\|openai\|ollama] [--limit=N] [--concurrency=N]` | Bootstrap from git history |
| `chronicle inject [--files=<paths>] [--full] [--format=markdown\|xml\|plain]` | Output context to stdout |
| `chronicle deepen [--depth=1year\|all] [--limit=N]` | Extend scan without reprocessing |
| `chronicle doctor` | Validate `.lore/` health (files, links, cache, hooks) |
| `chronicle search <query> [--limit=N] [--json]` | Full-text search across knowledge base |
| `chronicle serve [--port=4242]` | Local web viewer — opens in browser |
| `chronicle session save [message]` | Save a session note |
| `chronicle session list` | List saved sessions |
| `chronicle session show [n]` | Show last N sessions |
| `chronicle evolution [--regen] [--view]` | Build/view system evolution timeline |
| `chronicle diagram [--type=architecture\|dependencies\|evolution]` | Generate ASCII diagrams |
| `chronicle hooks install` | Install git hooks |
| `chronicle hooks remove` | Remove git hooks |

---

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full system design, data flows, and extension points.

---

## Contributing

See [ROADMAP.md](./ROADMAP.md) for the versioned feature plan and what's coming next.
See [CHANGELOG.md](./CHANGELOG.md) for version history of what's shipped.

```bash
git clone https://github.com/ypollak2/chronicle
cd chronicle
npm install
npm test           # run all tests
npm run build      # build all packages
```

---

## License

MIT © [ypollak2](https://github.com/ypollak2)
