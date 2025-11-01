// prisma/seed.js (CommonJS)
const { PrismaClient, Papel } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // IDs fixos
  const orgId = 'org_default';
  const setorSecretariaId = 'setor_secretaria';
  const setorSuporteId = 'setor_suporte';
  const catTIId = 'cat_ti';
  const catAcademicoId = 'cat_academico';

  // Organização
  await prisma.organizacao.upsert({
    where: { id: orgId },
    create: { id: orgId, nome: 'Fatec Cotia', sigla: 'FATEC' },
    update: {},
  });

  // Setores
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

  // Papéis do catálogo (usa upsert por NOME, pq é UNIQUE)
  const papeis = ['aluno', 'secretaria', 'tecnico', 'gestor'];
  for (const nome of papeis) {
    await prisma.papelCatalogo.upsert({
      where: { nome },          // <- evita colisão de unique por nome
      create: { nome },
      update: {},
    });
  }

  // Categorias
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

  // Serviços
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

  // Admin global
  const adminId = 'user_admin';
  await prisma.usuario.upsert({
    where: { id: adminId },
    create: {
      id: adminId,
      organizacaoId: orgId,
      nome: 'Admin do Sistema',
      emailPessoal: 'admin@example.com',
      senhaHash: 'hash_fake_trocar_depois',
      papel: Papel.ADMINISTRADOR,
      ativo: true,
    },
    update: {},
  });

  // Obter ids dos papeis do catálogo por nome (garante FK certa)
  const papelGestor = await prisma.papelCatalogo.findUnique({ where: { nome: 'gestor' } });

  // Vínculos do admin com setores
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

  // Cursos
  const cursos = [
    { id: 'curso_dsm', nome: 'Desenvolvimento de Software Multiplataforma', sigla: 'DSM', ativo: true },
    { id: 'curso_gpi', nome: 'Gestão da Produção Industrial', sigla: 'GPI', ativo: true },
    { id: 'curso_gestao', nome: 'Gestão Empresarial', sigla: 'GE', ativo: true },
    { id: 'curso_comex', nome: 'Comércio Exterior', sigla: 'COMEX', ativo: true },
    { id: 'curso_design', nome: 'Design de Produto', sigla: 'PD', ativo: true },
  ];

  for (const curso of cursos) {
    await prisma.curso.upsert({
      where: { id: curso.id },
      create: curso,
      update: {},
    });
  }

  // Usuários exemplo (alunos e secretaria)
  const usuariosExemplo = [
    // Alunos
    {
      id: 'user_aluno_dsm_1',
      organizacaoId: orgId,
      cursoId: 'curso_dsm',
      nome: 'João Silva - Aluno DSM',
      emailPessoal: 'joao.silva@aluno.fatec.sp.gov.br',
      ra: '123456789',
      senhaHash: 'hash_fake_aluno_1',
      papel: Papel.USUARIO,
      ativo: true,
    },
    {
      id: 'user_aluno_gpi_1',
      organizacaoId: orgId,
      cursoId: 'curso_gpi',
      nome: 'Maria Ribeiro - Aluno GPI',
      emailPessoal: 'maria.ribeiro@aluno.fatec.sp.gov.br',
      ra: '987654321',
      senhaHash: 'hash_fake_aluno_2',
      papel: Papel.USUARIO,
      ativo: true,
    },
    // Secretaria
    {
      id: 'user_secretaria_1',
      organizacaoId: orgId,
      nome: 'Ana Costa - Secretaria',
      emailPessoal: 'ana.costa@fatec.sp.gov.br',
      senhaHash: 'hash_fake_secretaria',
      papel: Papel.BACKOFFICE,
      ativo: true,
    }
  ];

  for (const usuario of usuariosExemplo) {
    await prisma.usuario.upsert({
      where: { id: usuario.id },
      create: usuario,
      update: {},
    });
  }

  // Vincular secretaria ao setor
  const papelSecretaria = await prisma.papelCatalogo.findUnique({ where: { nome: 'secretaria' } });
  await prisma.usuarioSetor.upsert({
    where: { id: 'us_secretaria_principal' },
    create: {
      id: 'us_secretaria_principal',
      usuarioId: 'user_secretaria_1',
      setorId: setorSecretariaId,
      papelId: papelSecretaria?.id ?? null
    },
    update: {},
  });

  console.log('✅ Seed concluído.');
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
