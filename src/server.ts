import { buildApp } from "./app";


const port = Number(process.env.PORT ?? 3333);


async function main() {
const app = await buildApp();
await app.listen({ port, host: "0.0.0.0" });
console.log(`HTTP server running on http://localhost:${port}`);
}


main().catch((err) => {
console.error(err);
process.exit(1);
});