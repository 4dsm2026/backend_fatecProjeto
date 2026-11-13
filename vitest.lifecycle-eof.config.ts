import { defineConfig } from 'vitest/config'

// Regressão isolada: simula apenas o canal de lifecycle, mantendo API e banco reais.
export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/integration/lifecycle-eof/globalSetup.ts'],
    include: ['tests/integration/lifecycle-eof/eof.test.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    hookTimeout: 120_000,
    teardownTimeout: 90_000,
  },
})
