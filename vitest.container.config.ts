import { defineConfig } from 'vitest/config'
import type { WorkspaceSpec } from 'vitest/node'

class SmokeSequencer {
  async sort(files: WorkspaceSpec[]) {
    return [...files].sort((a, b) => Number(a[1].replace(/\\/g, '/').endsWith('/close.test.ts')) - Number(b[1].replace(/\\/g, '/').endsWith('/close.test.ts')))
  }
  async shard(files: WorkspaceSpec[]): Promise<WorkspaceSpec[]> {
    throw new Error(`A configuração usa banco compartilhado e não permite dividir ${files.length} arquivos em shards`)
  }
}

// Suíte de integração serial com banco e servidor HTTP reais.
export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/integration/_setup/globalSetup.ts'],
    setupFiles: ['./tests/integration/_setup/workerSetup.ts'],
    include: [
      'tests/integration/smoke/*.test.ts',
      'tests/integration/setores/*.test.ts',
      'tests/integration/usuario-setor/*.test.ts',
      'tests/integration/tickets/*.shared.test.ts',
      'tests/integration/core/*.test.ts',
      'tests/integration/journeys/j7-*.test.ts',
    ],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    isolate: false,
    sequence: { sequencer: SmokeSequencer },
    testTimeout: 30_000,
    hookTimeout: 120_000,
    teardownTimeout: 90_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: './coverage/integration',
      reportOnFailure: true,
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/server.ts'],
    },
  },
})
