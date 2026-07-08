// scripts/backfill-outros-setor.js
//
// Atribui à Secretaria os chamados "Outra solicitação" (outros) que ficaram
// órfãos (setorId nulo) por terem sido criados antes do roteamento por setor.
// Idempotente: rodar de novo não muda nada além de eventuais novos órfãos.
//
// Uso:  node scripts/backfill-outros-setor.js
//       (respeita DATABASE_URL do ambiente)

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const secretaria = await prisma.setor.findFirst({
    where: { nome: { contains: 'Secretaria' } },
    select: { id: true, nome: true },
  });

  if (!secretaria) {
    console.error('[backfill-outros] Nenhum setor com "Secretaria" no nome. Abortando.');
    process.exitCode = 1;
    return;
  }

  const filtroOrfaos = {
    deletadoEm: null,
    setorId: null,
    OR: [
      { catalogoCategoriaId: 'outros' },
      { catalogoCategoriaNome: 'Outra solicitação' },
    ],
  };

  const total = await prisma.chamado.count({ where: filtroOrfaos });
  if (total === 0) {
    console.info('[backfill-outros] Nenhum chamado "outros" órfão encontrado. Nada a fazer.');
    return;
  }

  const { count } = await prisma.chamado.updateMany({
    where: filtroOrfaos,
    data: { setorId: secretaria.id },
  });

  console.info(`[backfill-outros] ${count} chamado(s) atribuído(s) ao setor "${secretaria.nome}" (${secretaria.id}).`);
}

main()
  .catch((e) => { console.error('[backfill-outros] Erro:', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
