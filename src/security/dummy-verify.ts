// src/security/dummy-verify.ts
import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "./password";

let dummyHash: Promise<string> | undefined;

/**
 * Faz uma verificação de senha "de mentira", com o MESMO custo (mesmos
 * parâmetros do hash real) de uma verificação verdadeira. Usada quando o
 * login falha antes de comparar senhas (conta inexistente ou sem hash), para
 * que o tempo de resposta não revele se a conta existe.
 * O hash falso é gerado uma única vez, na primeira chamada.
 */
export async function verifyDummyPassword(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(32).toString("hex")).catch((e) => {
    dummyHash = undefined; // não guarda falha: tenta de novo na próxima chamada
    throw e;
  });
  await verifyPassword(await dummyHash, password);
}
