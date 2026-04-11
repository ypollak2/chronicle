/**
 * Shared test fixture factory.
 *
 * Creates realistic git repositories with a spectrum of commit types so tests
 * can verify that Chronicle captures different kinds of project knowledge:
 *   - Feature decisions       → decisions.md
 *   - Architecture changes    → evolution.md + decisions.md (isDeep)
 *   - Security changes        → risks.md + decisions.md (high risk)
 *   - Rejected approaches     → rejected.md
 *   - Noise (style/chore)     → filtered out by scanner
 */

import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { execSync } from 'child_process'
import { initStore, writeStore, lorePath } from '../store.js'
import type { ExtractionResult } from '../extractor.js'

// ─── Git repo builder ──────────────────────────────────────────────────────

export interface FixtureRepo {
  root: string
  cleanup: () => void
}

function git(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
}

function gitSetup(dir: string) {
  git('git init', dir)
  git('git config user.email "test@chronicle.dev"', dir)
  git('git config user.name "Chronicle Test"', dir)
}

function commit(dir: string, msg: string, files: Record<string, string>): string {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path)
    mkdirSync(join(dir, path.split('/').slice(0, -1).join('/') || '.'), { recursive: true })
    writeFileSync(full, content)
  }
  git('git add -A', dir)
  git(`git commit -m "${msg}"`, dir)
  return git('git rev-parse HEAD', dir)
}

/**
 * Builds a realistic project repo with 7 commits covering all change types.
 * Returns commit hashes keyed by type so tests can make targeted assertions.
 */
export function buildProjectRepo(): FixtureRepo & {
  hashes: {
    initial: string
    feature: string
    architecture: string
    security: string
    rejection: string
    noise: string
    vulnerability: string
  }
} {
  const root = join(os.tmpdir(), `chronicle-fixture-${Date.now()}`)
  mkdirSync(root)
  gitSetup(root)

  // 1. Initial scaffolding
  const initial = commit(root, 'chore: initial project setup', {
    'package.json': '{"name":"myapp","version":"1.0.0"}',
    'src/index.ts': 'export const app = {}',
    'src/db/client.ts': 'export const db = null',
    'README.md': '# MyApp',
  })

  // 2. Feature decision — adds JWT auth across 2 modules
  const feature = commit(root,
    'feat: add JWT authentication\n\nReplaces cookie sessions. Sessions required Redis which added ops overhead.\nJWT is stateless, works across microservices. Downside: no server-side revocation.',
    {
      'src/auth/jwt.ts': `
import { sign, verify } from 'jsonwebtoken'
export const SECRET = process.env.JWT_SECRET!
export const signToken = (payload: object) => sign(payload, SECRET, { expiresIn: '7d' })
export const verifyToken = (token: string) => verify(token, SECRET)
`.repeat(5),
      'src/auth/middleware.ts': `
export function requireAuth(req: any, res: any, next: any) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  req.user = verifyToken(token)
  next()
}
`.repeat(4),
      'src/users/router.ts': `
import { requireAuth } from '../auth/middleware'
export const router = express.Router()
router.get('/me', requireAuth, (req, res) => res.json(req.user))
`.repeat(3),
    }
  )

  // 3. Architecture change — migration from monolith to services
  const architecture = commit(root,
    'refactor!: migrate from monolith to microservices\n\nExtract auth, users, and billing into separate services.\nEach service owns its own DB schema.\nCommunication via message queue (RabbitMQ) instead of direct imports.\nThis affects deployment, testing, and local dev setup significantly.',
    {
      'services/auth/index.ts': 'export * from "./service"'.repeat(10),
      'services/auth/service.ts': `
export class AuthService {
  // Extracted from monolith src/auth/
  // Owns: JWT issuance, refresh, revocation
  // Communicates: UserService via queue
}
`.repeat(8),
      'services/users/index.ts': 'export * from "./service"'.repeat(10),
      'services/billing/index.ts': 'export * from "./service"'.repeat(10),
      'infra/queue.ts': 'export const queue = new RabbitMQ()'.repeat(8),
      'docker-compose.yml': 'version: "3"\nservices:\n  auth:\n  users:\n  billing:\n'.repeat(5),
    }
  )

  // 4. Security vulnerability + fix
  const security = commit(root,
    'fix: harden auth against timing attacks and add rate limiting\n\nDiscovered: constant-time comparison not used for token validation.\nCVE-adjacent: timing oracle could allow token forgery.\nAdded: helmet, rate-limit on auth routes, CORS restriction.',
    {
      'src/auth/jwt.ts': `
import { timingSafeEqual } from 'crypto'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
// Fix: use timingSafeEqual to prevent timing attacks
// Fix: rate limit auth routes to 10req/min
// Fix: restrict CORS to known origins only
export const authLimiter = rateLimit({ windowMs: 60000, max: 10 })
export function safeCompare(a: string, b: string) {
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}
`.repeat(6),
      'src/auth/middleware.ts': `
// Added security headers and input validation
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') ?? []
`.repeat(5),
    }
  )

  // 5. Rejected approach — attempt to use GraphQL, abandoned
  const rejection = commit(root,
    'feat: remove GraphQL API layer — reverting to REST for team velocity\n\nWe tried adding Apollo Server to unify API access.\nTeam velocity dropped 40% due to schema maintenance overhead.\nDecision: revisit GraphQL only if we have dedicated API team.',
    {
      'src/api/rest/router.ts': `
import { Router } from 'express'
import { requireAuth } from '../auth/middleware'

export const router = Router()

// GET /users
router.get('/users', requireAuth, (req, res) => res.json([]))
router.post('/users', requireAuth, (req, res) => res.json({}))
router.get('/users/:id', requireAuth, (req, res) => res.json({}))
router.put('/users/:id', requireAuth, (req, res) => res.json({}))
router.delete('/users/:id', requireAuth, (req, res) => res.status(204).end())

// GET /items
router.get('/items', requireAuth, (req, res) => res.json([]))
router.post('/items', requireAuth, (req, res) => res.json({}))
router.get('/items/:id', requireAuth, (req, res) => res.json({}))
router.put('/items/:id', requireAuth, (req, res) => res.json({}))
router.delete('/items/:id', requireAuth, (req, res) => res.status(204).end())
`.repeat(3),
      'src/graphql/schema.ts': '// GraphQL schema removed — see rejected.md\n'.repeat(5),
    }
  )

  // 6. Noise commit — should be filtered by scanner
  const noise = commit(root, 'style: fix linting warnings and trailing whitespace', {
    'src/index.ts': 'export const app = {}  ',  // minor style change
    '.eslintrc': '{"rules":{"no-trailing-spaces":"error"}}',
  })

  // 7. Vulnerability pattern — hardcoded credentials (should appear in risks)
  const vulnerability = commit(root,
    'feat: add database connection pooling\n\nMoves from single connection to pool of 10.\nImproves throughput under load by 3x.\nConnection string moved to env var (was hardcoded in v1).',
    {
      'src/db/pool.ts': `
import { Pool } from 'pg'
// IMPORTANT: connection string must come from env, never hardcoded
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
})
`.repeat(6),
      'src/db/client.ts': `
// Deprecated: old client with hardcoded connection
// export const db = new Client({ connectionString: 'postgres://localhost/myapp' })
export { pool as db } from './pool'
`.repeat(4),
    }
  )

  return {
    root,
    hashes: { initial, feature, architecture, security, rejection, noise, vulnerability },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

// ─── Pre-populated .lore/ fixture ─────────────────────────────────────────────

/**
 * Builds a .lore/ store pre-populated with realistic decisions, rejections, risks,
 * and evolution data. Used for inject and quality tests that don't need LLM extraction.
 */
export function buildPopulatedLore(root: string) {
  initStore(root)

  writeStore(root, 'index', `# MyApp — Project Memory

Last updated: 2026-04-11
Decisions: 4 | Rejections: 2 | Risks: 3
`)

  writeStore(root, 'decisions', `# Architecture Decisions

| Date | Decision | Affects | Risk |
|------|----------|---------|------|
| 2026-04-01 | Use JWT for authentication | src/auth/, services/auth/ | high | <!-- confidence:0.92 --> <!-- author:dev@myapp.com -->
| 2026-04-03 | Migrate to microservices | services/, infra/, docker-compose.yml | high | <!-- confidence:0.88 --> [→](decisions/microservices-migration.md) <!-- author:arch@myapp.com -->
| 2026-04-05 | Add connection pooling | src/db/ | medium | <!-- confidence:0.95 --> <!-- author:dev@myapp.com -->
| 2026-04-06 | Fix timing attack in token comparison | src/auth/jwt.ts, src/auth/middleware.ts | high | <!-- confidence:0.95 --> <!-- author:sec@myapp.com -->
| 2026-04-07 | Rate-limit auth routes | src/auth/middleware.ts | medium | <!-- confidence:0.90 --> <!-- author:sec@myapp.com -->
`)

  writeStore(root, 'rejected', `# Rejected Approaches

## GraphQL API layer (2026-04-04)
**What**: Apollo Server on top of REST endpoints
**Replaced by**: Plain REST with OpenAPI spec
**Reason**: Team velocity dropped 40% due to schema maintenance. Revisit only with dedicated API team.

## Redis session store (2026-03-28)
**What**: server-side sessions backed by Redis
**Replaced by**: JWT stateless tokens
**Reason**: Ops overhead for Redis cluster; JWT is stateless and works across services.
`)

  writeStore(root, 'risks', `# Risk Register

## High Blast Radius Files
- src/auth/jwt.ts — touched by 4 decisions; token issuance affects all auth flows
- src/auth/middleware.ts — all routes behind auth pass through here
- src/db/pool.ts — all DB operations, connection pool saturation causes system-wide failure
`)

  writeStore(root, 'evolution', `# System Evolution

---

## Phase 1 — Initial Auth (2026-03-28 → 2026-04-01)

> Bootstrapped auth with JWT, replacing cookie sessions.

Key decisions: JWT adoption, Redis rejection
Most changed: src/auth/

---

## Phase 2 — Microservices Split (2026-04-01 → 2026-04-07)

> Extracted monolith into 3 services: auth, users, billing.

Key decisions: Microservices migration, RabbitMQ queue
Architecture change: monolith → distributed services
Most changed: services/, infra/
`)

  writeFileSync(
    join(root, '.lore', 'decisions', 'microservices-migration.md'),
    `# ADR: Migrate to Microservices

## Status: Accepted

## Context
The monolith has grown to 50K LOC. Auth, Users, and Billing are tightly coupled.
Onboarding new developers takes 2 weeks because the entire codebase must be understood.

## Decision
Extract into 3 independent services communicating via RabbitMQ message queue.

## Consequences
- (+) Each service can be deployed independently
- (+) Failure isolation — auth outage doesn't affect billing
- (-) Local dev requires docker-compose with 3 services
- (-) Distributed tracing needed for debugging request flows
- (-) Message queue adds latency (~5ms per hop)

## Alternatives Considered
- **Modular monolith**: Lower complexity but doesn't solve deployment coupling
- **gRPC direct calls**: Simpler than queue but creates tight coupling between services
`
  )
}

// ─── Mock LLM that returns realistic decisions ─────────────────────────────────

/**
 * A mock LLM provider that generates contextually appropriate decisions
 * based on keywords in the prompt. Used for pipeline integration tests.
 */
export function buildMockLLM(overrides?: Partial<Record<string, ExtractionResult[]>>) {
  const defaults: Record<string, ExtractionResult[]> = {
    jwt: [{
      isDecision: true, isRejection: false,
      title: 'Use JWT for authentication',
      affects: ['src/auth/', 'src/users/'],
      risk: 'high', rationale: 'Stateless tokens eliminate Redis dependency',
      isDeep: false, confidence: 0.92,
    }],
    microservice: [{
      isDecision: true, isRejection: false,
      title: 'Migrate to microservices',
      affects: ['services/', 'infra/', 'docker-compose.yml'],
      risk: 'high', rationale: 'Monolith coupling slowing team velocity',
      isDeep: true, confidence: 0.88,
    }],
    'timing attack': [{
      isDecision: true, isRejection: false,
      title: 'Harden auth against timing attacks',
      affects: ['src/auth/jwt.ts', 'src/auth/middleware.ts'],
      risk: 'high', rationale: 'CVE-adjacent: timing oracle could allow token forgery',
      isDeep: false, confidence: 0.95,
    }],
    graphql: [{
      isDecision: false, isRejection: true,
      title: 'GraphQL API layer',
      affects: ['src/api/'],
      risk: 'low', rationale: 'Team velocity dropped 40%; reverting to REST',
      isDeep: false, confidence: 0.90,
    }],
    pool: [{
      isDecision: true, isRejection: false,
      title: 'Add database connection pooling',
      affects: ['src/db/'],
      risk: 'medium', rationale: '3x throughput improvement under load',
      isDeep: false, confidence: 0.95,
    }],
    ...overrides,
  }

  return async (prompt: string): Promise<string> => {
    for (const [keyword, results] of Object.entries(defaults)) {
      if (prompt.toLowerCase().includes(keyword)) {
        return JSON.stringify(results)
      }
    }
    return JSON.stringify([])  // noise / filtered commit
  }
}
