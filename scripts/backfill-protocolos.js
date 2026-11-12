// scripts/backfill-protocolos.js
//
// Gera protocolo (TCK-XXXXXX, o mesmo formato de gerarProtocolo em
// src/core/tickets/tickets.service.ts) para os chamados antigos que ficaram sem.
// Idempotente: rodar de novo só afeta chamados que ainda estejam sem protocolo.
//
// Uso:  pnpm backfill:protocolos      (respeita DATABASE_URL do ambiente)

const { randomBytes } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const TENTATIVAS = 5;

const novoProtocolo = () => `TCK-${randomBytes(3).toString('hex').toUpperCase()}`;

async function atribuir(id) {
  for (let i = 0; i < TENTATIVAS; i++) {
    try {
      // where com protocolo: null evita sobrescrever se outro processo já preencheu
      const { count } = await prisma.chamado.updateMany({ where: { id, protocolo: null }, data: { protocolo: novoProtocolo() } });
      return count;
    } catch (e) {
      if (e && e.code === 'P2002') continue; // protocolo já existe: sorteia outro
      throw e;
    }
  }
  throw new Error(`Não foi possível gerar protocolo único para o chamado ${id}`);
}

async function main() {
  const semProtocolo = await prisma.chamado.findMany({ where: { protocolo: null }, select: { id: true } });
  if (semProtocolo.length === 0) {
    console.info('[backfill-protocolos] Todos os chamados já têm protocolo. Nada a fazer.');
    return;
  }
  let feitos = 0;
  for (const { id } of semProtocolo) feitos += await atribuir(id);
  console.info(`[backfill-protocolos] ${feitos} chamado(s) receberam protocolo.`);
}

main()
  .catch((e) => {
    console.error('[backfill-protocolos] Falhou:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
