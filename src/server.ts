import { buildApp } from "./app";
import { env } from "./env";

async function main() {
  const app = await buildApp();

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`${signal} recebido – encerrando...`);
      await app.close();
      process.exit(0);
    });
  }

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(`Server ouvindo na porta ${env.PORT}`);
}

main().catch((err) => {
  console.error("Falha ao iniciar servidor:", err);
  process.exit(1);
});
