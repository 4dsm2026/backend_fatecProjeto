import { buildApp } from "./app";

async function main() {
  const app = await buildApp();
  const port = process.env.PORT ? Number(process.env.PORT) : 8080;

  await app.listen({ port, host: "0.0.0.0" });
  console.log(`🚀 HTTP server running on http://0.0.0.0:${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
