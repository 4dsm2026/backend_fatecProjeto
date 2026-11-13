import { defineConfig } from "vitest/config";

/** Configuração temporária só dos chamados; não altera a suíte unitária. */
export default defineConfig({
  test: {
    include: ["tests/integration/tickets/tickets.real.ts"],
    environment: "node",
    pool: "forks",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
