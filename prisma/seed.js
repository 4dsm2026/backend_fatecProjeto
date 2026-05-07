// prisma/seed.js (CommonJS)
const { PrismaClient, Papel } = require('@prisma/client');
const argon2 = require('argon2');
const prisma = new PrismaClient();

async function main() {
  const orgId = 'org_default';
  const setorSecretariaId = 'setor_secretaria';
  const setorSuporteId = 'setor_suporte';
  const catTIId = 'cat_ti';
  const catAcademicoId = 'cat_academico';

  // Hash real passwords at seed time — never store plaintext-equivalent stubs
  const [adminHash, demoHash] = await Promise.all([
    argon2.hash('wf-fatec2026'),
    argon2.hash('Fatec@2026'),
  ]);

  await prisma.organizacao.upsert({
    where: { id: orgId },
    create: { id: orgId, nome: 'Fatec Cotia', sigla: 'FATEC' },
    update: {},
  });

  await prisma.setor.upsert({
    where: { id: setorSecretariaId },
    create: { id: setorSecretariaId, nome: 'Secretaria', organizacaoId: orgId },
    update: {},
  });
  await prisma.setor.upsert({
    where: { id: setorSuporteId },
    create: { id: setorSuporteId, nome: 'Suporte Técnico', organizacaoId: orgId },
    update: {},
  });

  const papeis = ['aluno', 'secretaria', 'tecnico', 'gestor'];
  for (const nome of papeis) {
    await prisma.papelCatalogo.upsert({
      where: { nome },
      create: { nome },
      update: {},
    });
  }

  await prisma.categoria.upsert({
    where: { id: catTIId },
    create: { id: catTIId, nome: 'TI', organizacaoId: orgId },
    update: {},
  });
  await prisma.categoria.upsert({
    where: { id: catAcademicoId },
    create: { id: catAcademicoId, nome: 'Acadêmico', organizacaoId: orgId },
    update: {},
  });

  await prisma.servico.upsert({
    where: { id: 'svc_login' },
    create: { id: 'svc_login', nome: 'Acesso ao Sistema', descricao: 'Problemas de login e senha', categoriaId: catTIId, ativo: true },
    update: {},
  });
  await prisma.servico.upsert({
    where: { id: 'svc_declaracao' },
    create: { id: 'svc_declaracao', nome: 'Emissão de Declaração', descricao: 'Declaração de matrícula/frequência', categoriaId: catAcademicoId, ativo: true },
    update: {},
  });
  await prisma.servico.upsert({
    where: { id: 'svc_matricula' },
    create: { id: 'svc_matricula', nome: 'Matrícula', descricao: 'Processos de matrícula', categoriaId: catAcademicoId, ativo: true },
    update: {},
  });

  // Admin — can log in immediately with wf-fatec2026, no forced first-access
  const adminId = 'user_admin';
  await prisma.usuario.upsert({
    where: { id: adminId },
    create: {
      id: adminId,
      organizacaoId: orgId,
      nome: 'Admin do Sistema',
      emailPessoal: 'admin@example.com',
      senhaHash: adminHash,
      papel: Papel.ADMINISTRADOR,
      ativo: true,
      precisaTrocarSenha: false,
    },
    update: {},
  });

  const papelGestor = await prisma.papelCatalogo.findUnique({ where: { nome: 'gestor' } });

  await prisma.usuarioSetor.upsert({
    where: { id: 'us_admin_secretaria' },
    create: { id: 'us_admin_secretaria', usuarioId: adminId, setorId: setorSecretariaId, papelId: papelGestor?.id ?? null },
    update: {},
  });
  await prisma.usuarioSetor.upsert({
    where: { id: 'us_admin_suporte' },
    create: { id: 'us_admin_suporte', usuarioId: adminId, setorId: setorSuporteId, papelId: papelGestor?.id ?? null },
    update: {},
  });

  // Demo users — all use Fatec@2026 and must go through first-access to set their own password
  const usuariosExemplo = [
    {
      id: 'user_aluno_dsm_1',
      organizacaoId: orgId,
      cursoNome: 'Desenvolvimento de Software Multiplataforma',
      cursoSigla: 'DSM',
      nome: 'João Silva - Aluno DSM',
      emailPessoal: 'joao.silva@aluno.fatec.sp.gov.br',
      ra: '123456789',
      senhaHash: demoHash,
      papel: Papel.USUARIO,
      ativo: true,
      precisaTrocarSenha: true,
    },
    {
      id: 'user_aluno_gpi_1',
      organizacaoId: orgId,
      cursoNome: 'Gestão da Produção Industrial',
      cursoSigla: 'GPI',
      nome: 'Maria Ribeiro - Aluno GPI',
      emailPessoal: 'maria.ribeiro@aluno.fatec.sp.gov.br',
      ra: '987654321',
      senhaHash: demoHash,
      papel: Papel.USUARIO,
      ativo: true,
      precisaTrocarSenha: true,
    },
    {
      id: 'user_aluno_comex_1',
      organizacaoId: orgId,
      nome: 'João Feijo - Aluno COMEX',
      emailPessoal: 'joao.feijo@aluno.fatec.sp.gov.br',
      ra: '998877665',
      senhaHash: demoHash,
      papel: Papel.USUARIO,
      ativo: true,
      precisaTrocarSenha: true,
    },
    {
      id: 'user_secretaria_1',
      organizacaoId: orgId,
      nome: 'Ana Costa - Secretaria',
      emailPessoal: 'ana.costa@fatec.sp.gov.br',
      senhaHash: demoHash,
      papel: Papel.BACKOFFICE,
      ativo: true,
      precisaTrocarSenha: true,
    },
  ];

  for (const usuario of usuariosExemplo) {
    await prisma.usuario.upsert({
      where: { id: usuario.id },
      create: usuario,
      update: {},
    });
  }

  const papelSecretaria = await prisma.papelCatalogo.findUnique({ where: { nome: 'secretaria' } });
  await prisma.usuarioSetor.upsert({
    where: { id: 'us_secretaria_principal' },
    create: {
      id: 'us_secretaria_principal',
      usuarioId: 'user_secretaria_1',
      setorId: setorSecretariaId,
      papelId: papelSecretaria?.id ?? null,
    },
    update: {},
  });

  console.log('✅ Seed concluído.');
  console.log('   Admin: admin@example.com / wf-fatec2026');
  console.log('   Demo users: Fatec@2026 (precisaTrocarSenha = true)');
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
