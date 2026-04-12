import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/__tests__/**',
        // Entry-point wiring — not unit-testable (Commander setup / process entry)
        'packages/cli/src/cli.ts',
        'packages/cli/src/graph.ts',      // high-level graph layout utility, no business logic
        'packages/cli/src/llm.ts',        // LLM provider factory — tested via init/process integration
        // Deferred scope (explicitly out of scope for v1.0 per ROADMAP)
        'packages/cli/src/commands/serve.ts',
        'packages/cli/src/commands/add.ts',
        'packages/cli/src/commands/ingest.ts',
        'packages/core/src/ingestor.ts',
        'packages/core/src/sources.ts',
        // MCP server — covered by separate integration tests
        'packages/mcp/src/server.ts',
      ],
      thresholds: {
        lines: 55,
        functions: 55,
        branches: 48,
      },
    },
  },
})
