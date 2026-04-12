# Chronicle

**Your AI coding assistant keeps forgetting everything. Chronicle fixes that.**

[![CI](https://github.com/ypollak2/chronicle/actions/workflows/ci.yml/badge.svg)](https://github.com/ypollak2/chronicle/actions/workflows/ci.yml)
[![PyPI](https://img.shields.io/pypi/v/chronicle-dev)](https://pypi.org/project/chronicle-dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Every AI session starts blank. You explain the same context over and over — why you chose this architecture, what you already tried, what broke last time. Chronicle captures that knowledge automatically from your git history and injects it into every AI session so you never repeat yourself.

**No vector database. No embeddings server. No infrastructure. Just markdown files in your repo.**

```bash
pip install chronicle-dev
chronicle init        # scan git history → build .lore/ knowledge base
chronicle inject | claude   # every future session starts with full context
```

> v1.0.2 — See [CHANGELOG.md](./CHANGELOG.md)

---

## The Problem

Every time you start a new AI coding session, you lose:

| What's lost | Why it matters |
|-------------|---------------|
| Why you chose this architecture | The AI suggests the same rejected approach again |
| What you already tried | You waste time re-exploring dead ends |
| Which files are fragile | The AI breaks things it shouldn't touch |
| What decisions are still active | The AI contradicts your previous choices |

Chronicle captures this invisible layer automatically — from your git history, your decisions as you work, and your session notes.

## How It Works

```
git history → chronicle init → .lore/ knowledge base → chronicle inject → any AI tool
                                        ↑
                          git hooks keep it current automatically
```

1. **Bootstrap once**: `chronicle init` scans your git history, extracts architectural decisions using a cheap LLM (or your Claude Code / Codex subscription — no extra cost), and builds a `.lore/` store of markdown files.

2. **Stays current automatically**: A git hook runs after every commit. A pre-push hook updates `.lore/` before every push. Zero extra steps.

3. **Works with every AI tool**: `chronicle inject | claude` — pipe context into any tool. Or use the native MCP server for Claude Code.

```markdown
## Rejected: Prisma ORM — 2025-03-10
Replaced by raw pg queries. Type conflicts with Zod schemas caused 3 broken tests. Do not reintroduce.

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

Chronicle uses a cheap LLM to analyze git diffs and extract decisions. It auto-detects what you already have — no setup needed if you use Claude Code or Codex:

| Provider | How | Cost |
|----------|-----|------|
| **Claude Code** | `claude` CLI (subscription) | Free — uses your existing plan |
| **Codex** | `codex` CLI (subscription) | Free — uses your existing plan |
| **Gemini** | `GEMINI_API_KEY` | Free tier available |
| **OpenAI** | `OPENAI_API_KEY` | ~$0.01 per 1000 commits |
| **Anthropic** | `ANTHROPIC_API_KEY` | ~$0.01 per 1000 commits |
| **Ollama** | local, no key | Free, slower |

```bash
# If you use Claude Code or Codex — no config needed, auto-detected:
chronicle init

# Or set an API key:
export GEMINI_API_KEY=...    # free tier: aistudio.google.com/apikey
chronicle init --llm gemini
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

# Check store health at a glance
chronicle status

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
├── index.md              Project summary + constraints
├── decisions.md          Lightweight index of all decisions
├── decisions/            Deep ADR files for complex decisions
├── rejected.md           What was tried and failed ← most valuable
├── risks.md              High-blast-radius files
├── evolution.md          System timeline
├── low-confidence.md     Quarantined extractions (below threshold)
├── diagrams/             Mermaid diagrams (auto-generated)
└── sessions/             Per-session AI summaries
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

### Setup & Bootstrap

| Command | Description |
|---------|-------------|
| `chronicle quickstart [--yes] [--llm=gemini\|anthropic\|openai\|ollama]` | Interactive 5-minute setup wizard — init + migrate + hooks + tool adapter |
| `chronicle init [--depth=6months\|1year\|all] [--llm=...] [--limit=N] [--concurrency=N]` | Bootstrap `.lore/` from git history |
| `chronicle migrate` | Upgrade `.lore/` schema to current version (idempotent) |
| `chronicle hooks install` | Install git hooks (post-commit capture, prepare-commit-msg) |
| `chronicle hooks remove` | Remove git hooks |
| `chronicle setup [--tool=claude-code\|cursor\|aider\|gemini-cli\|copilot\|codex\|...] [--all]` | Install AI tool adapter (generates `.cursorrules`, `GEMINI.md`, etc.) |
| `chronicle mcp` | Start MCP server for Claude Code (add to `.claude/mcp.json`) |

### Daily Workflow

| Command | Description |
|---------|-------------|
| `chronicle inject [--files=<paths>] [--full] [--format=markdown\|xml\|plain] [--query=<text>] [--top=N] [--tokens=N]` | Output compressed context to stdout; pipe into any AI tool |
| `chronicle process [--since=<sha>] [--min-confidence=0.5]` | Batch-process new commits; CI-safe |
| `chronicle capture` | Process HEAD commit (called by post-commit hook) |
| `chronicle deepen [--depth=1year\|all] [--limit=N]` | Extend scan further back without reprocessing |
| `chronicle status [--json]` | Health summary: decisions, ADRs, unprocessed commits, errors |

### Decisions & Knowledge

| Command | Description |
|---------|-------------|
| `chronicle decision list` | Show all decisions with lifecycle status |
| `chronicle decision deprecate "<title>"` | Mark a decision as deprecated |
| `chronicle decision supersede "<title>" --by "<new-title>"` | Mark decision as superseded by a newer one |
| `chronicle decision promote "<title>"` | Promote from `low-confidence.md` to `decisions.md` |
| `chronicle relate "<title>" --depends-on\|--supersedes\|--related-to "<title>"` | Link decisions in the DAG |
| `chronicle relate --list [--diagram]` | Print relation graph; `--diagram` renders Mermaid flowchart |
| `chronicle who <file>` | Show file owner(s) + all decisions and risks affecting the file |
| `chronicle context add --goal\|--constraint\|--team\|--stack <text>` | Add project context fact |
| `chronicle context remove\|show\|edit` | Manage project context |

### Analysis & Search

| Command | Description |
|---------|-------------|
| `chronicle search <query> [--semantic] [--hybrid] [--text] [--limit=N] [--json]` | Search across all `.lore/` content (hybrid semantic + keyword) |
| `chronicle eval [--init] [--json] [--verbose]` | Run RAG quality KPIs: Recall ≥80%, Rejection ≥90%, MRR@5 ≥0.70, False Confidence ≤10% |
| `chronicle doctor` | Validate `.lore/` health (files, links, cache, hooks, ADR orphans) |
| `chronicle verify [--max-lag=N] [--json]` | CI gate: exits 1 when `.lore/` lags by more than N commits |
| `chronicle evolution [--regen] [--view]` | Build/view system evolution timeline |
| `chronicle graph [--depth=N] [--monorepo]` | Interactive HTML topology from module + decision data |
| `chronicle diagram [--type=architecture\|dependencies\|evolution]` | Generate ASCII diagrams |

### Multi-Source Ingestion

| Command | Description |
|---------|-------------|
| `chronicle add --repo\|--dir\|--url\|--pdf <source> [--list] [--remove=<id>]` | Register additional knowledge sources |
| `chronicle ingest [--id=<id>] [--force]` | Index registered sources into `.lore/chunks/` |

### Sessions

| Command | Description |
|---------|-------------|
| `chronicle session save [message]` | Save a session note |
| `chronicle session list` | List saved sessions |
| `chronicle session show [n]` | Show last N sessions |
| `chronicle session archive` | Archive old sessions (moves to `.lore/sessions/archive/`) |
| `chronicle serve [--port=4242]` | Local web viewer — opens in browser |

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
