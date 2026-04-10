import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  outDir: 'dist',
  format: ['esm'],
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
})
