// prisma/seed.js (CommonJS)
const { PrismaClient, Papel } = require('@prisma/client');
const argon2 = require('argon2');
const prisma = new PrismaClient();

async function upsertByNome(model, nome, extraCreate = {}) {
  const found = await model.findFirst({ where: { nome } });
  if (found) return found;
  return model.create({ data: { nome, ...extraCreate } });
}

async function ensureUsuarioSetor(usuarioId, setorId, papelId) {
  const found = await prisma.usuarioSetor.findFirst({ where: { usuarioId, setorId } });
  if (found) return found;
  return prisma.usuarioSetor.create({ data: { usuarioId, setorId, papelId: papelId ?? null } });
}

async function main() {
  const [adminHash, demoHash] = await Promise.all([
    argon2.hash('wf-fatec2026'),
    argon2.hash('Fatec@2026'),
  ]);

  // Organização
  const org = await upsertByNome(prisma.organizacao, 'Fatec Cotia', { sigla: 'FATEC' });

  // Setores
  const setorSecretaria = await upsertByNome(prisma.setor, 'Secretaria', { organizacaoId: org.id });
  const setorSuporte    = await upsertByNome(prisma.setor, 'Suporte Técnico', { organizacaoId: org.id });

  // Papéis
  for (const nome of ['aluno', 'secretaria', 'tecnico', 'gestor']) {
    await upsertByNome(prisma.papelCatalogo, nome);
  }
  const papelGestor    = await prisma.papelCatalogo.findFirst({ where: { nome: 'gestor' } });
  const papelSecretaria = await prisma.papelCatalogo.findFirst({ where: { nome: 'secretaria' } });

  // Categorias
  const catTI       = await upsertByNome(prisma.categoria, 'TI', { organizacaoId: org.id });
  const catAcademico = await upsertByNome(prisma.categoria, 'Acadêmico', { organizacaoId: org.id });

  // Serviços
  const servicos = [
    { nome: 'Acesso ao Sistema',      descricao: 'Problemas de login e senha',              categoriaId: catTI.id,       ativo: true },
    { nome: 'Emissão de Declaração',  descricao: 'Declaração de matrícula/frequência',      categoriaId: catAcademico.id, ativo: true },
    { nome: 'Matrícula',              descricao: 'Processos de matrícula',                  categoriaId: catAcademico.id, ativo: true },
  ];
  for (const s of servicos) {
    const found = await prisma.servico.findFirst({ where: { nome: s.nome } });
    if (!found) await prisma.servico.create({ data: s });
  }

  // Categoria/Serviço "Outros" — antes era uma entrada só hardcoded no
  // frontend (catalogoCategoriaId "outros" / catalogoServicoId
  // "outros-solicitacao-geral"). Passa a ser um registro real, com ids
  // estáveis iguais aos que o wizard já envia, aparecendo na listagem oficial.
  await prisma.categoria.upsert({
    where:  { id: 'outros' },
    create: { id: 'outros', nome: 'Outra solicitação', descricao: 'Solicitações que não se encaixam nos demais serviços', organizacaoId: org.id },
    update: { nome: 'Outra solicitação' },
  });
  await prisma.servico.upsert({
    where:  { id: 'outros-solicitacao-geral' },
    create: { id: 'outros-solicitacao-geral', nome: 'Solicitação geral (Outros)', descricao: 'Descreva livremente sua necessidade; a Secretaria fará a triagem.', categoriaId: 'outros', ativo: true },
    update: { ativo: true, categoriaId: 'outros' },
  });

  // Admin (login imediato, sem troca de senha)
  const admin = await prisma.usuario.upsert({
    where:  { emailPessoal: 'admin@example.com' },
    create: {
      organizacaoId:       org.id,
      nome:                'Admin do Sistema',
      emailPessoal:        'admin@example.com',
      senhaHash:           adminHash,
      papel:               Papel.ADMINISTRADOR,
      ativo:               true,
      precisaTrocarSenha:  false,
    },
    update: {},
  });
  await ensureUsuarioSetor(admin.id, setorSecretaria.id, papelGestor?.id);
  await ensureUsuarioSetor(admin.id, setorSuporte.id,    papelGestor?.id);

  // Usuários demo (precisaTrocarSenha = true)
  const demos = [
    {
      emailPessoal: 'joao.silva@aluno.fatec.sp.gov.br',
      nome:         'João Silva - Aluno DSM',
      ra:           '123456789',
      papel:        Papel.USUARIO,
    },
    {
      emailPessoal: 'maria.ribeiro@aluno.fatec.sp.gov.br',
      nome:         'Maria Ribeiro - Aluno GPI',
      ra:           '987654321',
      papel:        Papel.USUARIO,
    },
    {
      emailPessoal: 'joao.feijo@aluno.fatec.sp.gov.br',
      nome:         'João Feijo - Aluno COMEX',
      ra:           '998877665',
      papel:        Papel.USUARIO,
    },
    {
      emailPessoal: 'ana.costa@fatec.sp.gov.br',
      nome:         'Ana Costa - Secretaria',
      papel:        Papel.BACKOFFICE,
      setorId:      setorSecretaria.id,
      papelId:      papelSecretaria?.id,
    },
  ];

  for (const { setorId, papelId, ...data } of demos) {
    const u = await prisma.usuario.upsert({
      where:  { emailPessoal: data.emailPessoal },
      create: { ...data, organizacaoId: org.id, senhaHash: demoHash, ativo: true, precisaTrocarSenha: true },
      update: {},
    });
    if (setorId) await ensureUsuarioSetor(u.id, setorId, papelId);
  }

  console.log('✅ Seed concluído.');
  console.log('   Admin : admin@example.com  /  wf-fatec2026');
  console.log('   Demo  : <email acima>      /  Fatec@2026  (troca de senha no 1º acesso)');
}

main()
  .catch((e) => { console.error('❌ Erro no seed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
