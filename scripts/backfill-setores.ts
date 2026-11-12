// scripts/backfill-setores.ts
//
// Atribui um setor aos chamados que ficaram sem (#114), com a mesma regra da abertura:
// setor com nome parecido com o "setor provável" do serviço ou, se nenhum combinar, a
// Secretaria. Idempotente: só mexe em chamados ainda sem setor.
//
// Uso:  pnpm backfill:setores      (respeita DATABASE_URL do ambiente)

import { PrismaClient } from '@prisma/client';
import { resolverSetorDoChamado } from '../src/core/tickets/tickets.service';

const prisma = new PrismaClient();

async function main() {
  const orfaos = await prisma.chamado.findMany({
    where: { setorId: null, deletadoEm: null },
    select: { id: true, protocolo: true, setorProvavel: true },
  });
  if (orfaos.length === 0) {
    console.info('[backfill-setores] Todos os chamados já têm setor. Nada a fazer.');
    return;
  }
  const nomes = new Map((await prisma.setor.findMany({ select: { id: true, nome: true } })).map((s) => [s.id, s.nome]));
  const resumo = new Map<string, number>();
  for (const c of orfaos) {
    const setorId = await resolverSetorDoChamado(prisma, c.setorProvavel);
    if (!setorId) {
      console.error('[backfill-setores] Nenhum setor cadastrado. Abortando.');
      process.exitCode = 1;
      return;
    }
    await prisma.chamado.updateMany({ where: { id: c.id, setorId: null }, data: { setorId } });
    const chave = `${c.setorProvavel ?? '(sem setor provável)'} -> ${nomes.get(setorId)}`;
    resumo.set(chave, (resumo.get(chave) ?? 0) + 1);
  }
  console.info(`[backfill-setores] ${orfaos.length} chamado(s) receberam setor:`);
  for (const [chave, n] of resumo) console.info(`  ${n} × ${chave}`);
}

main()
  .catch((e) => {
    console.error('[backfill-setores] Falhou:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
