<a href="https://github.com/4dsm2026" target="_blank">
  <img alt="WorkFlow" src="https://capsule-render.vercel.app/api?type=waving&color=0:B71C1C,100:FF1744&height=200&section=header&text=WorkFlow&fontSize=80&fontAlignY=35&animation=fadeIn&fontColor=white" width="100%"/>
</a>

# WorkFlow FATEC — Backend (API)

[![CI](https://github.com/4dsm2026/backend_fatecProjeto/actions/workflows/ci.yml/badge.svg)](https://github.com/4dsm2026/backend_fatecProjeto/actions/workflows/ci.yml)
[![Versão](https://img.shields.io/github/v/release/4dsm2026/backend_fatecProjeto?label=vers%C3%A3o)](https://github.com/4dsm2026/backend_fatecProjeto/releases)
[![Manual](https://img.shields.io/badge/manual-docs-0075ca)](https://4dsm2026.github.io/docs_fatecProjeto/)
![Node](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-obrigat%C3%B3rio-F69220?logo=pnpm&logoColor=white)

API do **WorkFlow FATEC**, o portal de atendimento acadêmico da Fatec. Cuida de autenticação (e-mail ou RA), solicitações (chamados) com conversa e anexos, catálogo de serviços, setores e papéis, caixa de sugestões, notificações em tempo real, e-mails automáticos e auditoria.

**Interface:** [frontend_fatecProjeto](https://github.com/4dsm2026/frontend_fatecProjeto) · **Manual e arquitetura:** [site de documentação](https://4dsm2026.github.io/docs_fatecProjeto/) · **Quadro:** [WorkFlow 2026](https://github.com/orgs/4dsm2026/projects/3) · **Como contribuir:** [guia da organização](https://github.com/4dsm2026/.github/blob/main/CONTRIBUTING.md)

## Sumário

- [Stack](#stack)
- [Pré-requisitos](#pré-requisitos)
- [Como rodar localmente](#como-rodar-localmente)
- [Usuários de teste](#usuários-de-teste)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Scripts](#scripts)
- [Testes](#testes)
- [API](#api)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Problemas comuns](#problemas-comuns)
- [Deploy](#deploy)

## Stack

| | |
|---|---|
| Servidor | [Fastify 5](https://fastify.dev/) + TypeScript |
| Banco | MySQL 8 com [Prisma 6](https://www.prisma.io/) (migrações em `prisma/migrations/`) |
| Validação | [Zod](https://zod.dev/) |
| Autenticação | JWT (access + refresh), senhas com Argon2 |
| E-mail | [Resend](https://resend.com/) ou AWS SES |
| Arquivos | Disco local ou S3 |
| Tempo real | WebSocket (`/ws`) |
| Testes | [Vitest](https://vitest.dev/) |
| Documentação da API | Swagger em `/docs` |

## Pré-requisitos

- **Node.js 20+**
- **pnpm**. ⚠️ Use sempre `pnpm`, nunca `npm`: o projeto tem `pnpm-lock.yaml`, e o `npm` instala versões diferentes. Para ativar: `corepack enable`.
- **Docker Desktop** instalado e **aberto** (para o MySQL).

## Como rodar localmente

```bash
# 1. Dependências
git clone https://github.com/4dsm2026/backend_fatecProjeto.git
cd backend_fatecProjeto
pnpm install

# 2. Banco de dados (MySQL na porta 3307 + Adminer em http://localhost:8080)
docker compose up -d

# 3. Variáveis de ambiente
cp .env.example .env
#   → no .env, troque a porta do DATABASE_URL de 3306 para 3307
#   → troque os segredos "change-me" (veja Variáveis de ambiente)

# 4. Prisma: client, tabelas e dados de teste
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed

# 5. Subir a API
pnpm dev
```

A API sobe em **http://localhost:3333**:

- `GET /health`: deve responder `{"status":"ok","db":"connected"}`;
- **http://localhost:3333/docs**: Swagger, com todas as rotas.

Depois, suba o [frontend](https://github.com/4dsm2026/frontend_fatecProjeto#como-rodar-localmente).

> Se o `pnpm install` mostrar `ERR_PNPM_IGNORED_BUILDS`, rode `pnpm approve-builds`, marque todos com `a`, confirme com Enter e rode `pnpm install` de novo.

**Por que a porta 3307?** O `docker-compose.yml` expõe o MySQL na 3307 para não conflitar com um MySQL que já esteja instalado na 3306. No Adminer, use: servidor `db`, usuário `root`, senha `root`, banco `workflow_fatec`. Se a porta 8080 estiver ocupada, troque `"8080:8080"` por `"8081:8080"` no `docker-compose.yml`.

## Usuários de teste

Criados pelo `pnpm prisma:seed` (`prisma/seed.js`). **Só existem no banco local.**

| Perfil | Login (aba) | Senha | Observação |
|---|---|---|---|
| Administrador | `admin@example.com` (Funcionário) | `wf-fatec2026` | Entra direto |
| Secretaria (Backoffice) | `ana.costa@fatec.sp.gov.br` (Funcionário) | `Fatec@2026` | Troca a senha no 1º acesso |
| Aluno | RA `123456789` (Aluno) | `Fatec@2026` | Troca a senha no 1º acesso |
| Aluno | RA `987654321` (Aluno) | `Fatec@2026` | Troca a senha no 1º acesso |
| Aluno | RA `998877665` (Aluno) | `Fatec@2026` | Troca a senha no 1º acesso |

A nova senha do primeiro acesso precisa ter 8+ caracteres, letra maiúscula, minúscula, número e símbolo.

## Variáveis de ambiente

Validadas na inicialização por `src/env.ts`: se faltar uma obrigatória, a API não sobe e mostra qual é.

| Variável | Obrigatória | Padrão | Para quê |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | Conexão com o MySQL. Local: `mysql://root:root@localhost:3307/workflow_fatec` |
| `JWT_ACCESS_SECRET` | ✅ | — | Assina o token de acesso. **Tem que ser igual ao do frontend** |
| `JWT_REFRESH_SECRET` | ✅ | — | Assina o token de renovação |
| `JWT_ISSUER` / `JWT_AUDIENCE` | | `helpdesk` / `helpdesk-app` | Emissor e público do token. **Iguais aos do frontend** |
| `JWT_ACCESS_EXPIRES` / `JWT_REFRESH_EXPIRES` | | `15m` / `7d` | Validade dos tokens |
| `DEFAULT_TEMP_PASSWORD` | ✅ | — | Senha temporária de alunos e funcionários cadastrados pelo painel |
| `COOKIE_SECRET` | em produção | — | Assina os cookies |
| `PORT` | | `3333` | Porta da API |
| `CORS_ORIGIN` | | — | Origens liberadas, separadas por vírgula. Local: `http://localhost:3000` |
| `APP_WEB_URL` | em produção | — | Endereço do frontend, usado nos links dos e-mails (primeiro acesso, redefinir senha) |
| `MAIL_DRIVER` | | `resend` | `resend` ou `ses` |
| `MAIL_FROM` | | `Suporte <no-reply@workflowfatec.com.br>` | Remetente dos e-mails |
| `RESEND_API_KEY` | se `resend` | — | Chave do Resend |
| `AWS_SES_REGION`, `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY` | se `ses` | — | Credenciais do SES |
| `STORAGE_DRIVER` | | `local` | `local` ou `s3` |
| `LOCAL_STORAGE_DIR` | | `./uploads` | Pasta dos anexos quando `local` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | se `s3` | — | Bucket dos anexos |

Para gerar segredos fortes: `openssl rand -hex 32`. **Nunca faça commit do `.env`**: o hook `pre-commit` bloqueia.

Sem uma chave de e-mail válida, o sistema funciona, mas os e-mails (redefinição de senha, avisos) não são entregues.

## Scripts

| Comando | O que faz |
|---|---|
| `pnpm dev` | API com recarga automática (lê o `.env`) |
| `pnpm build` / `pnpm start` | Compila para `dist/` / roda a versão compilada |
| `pnpm test` / `pnpm test:watch` | Testes (uma vez / observando) |
| `pnpm typecheck` | Checagem de tipos do TypeScript |
| `pnpm lint` | ESLint |
| `pnpm prisma:generate` | Gera o Prisma Client (rode após mudar o `schema.prisma`) |
| `pnpm prisma:migrate` | Aplica as migrações e cria uma nova se o schema mudou (`prisma migrate dev`) |
| `pnpm prisma:seed` | Popula o banco com os dados de teste |
| `pnpm prisma:studio` | Interface web para ver e editar o banco |
| `pnpm backfill:outros` | Script pontual: atribui à Secretaria os chamados "Outra solicitação" criados sem setor (antes do roteamento por setor) |

O CI roda `typecheck`, `lint` e `test` em todo PR para `develop` e `main`.

## Testes

```bash
pnpm test                                     # todos
pnpm vitest run tests/produtos/03-chamado.test.ts   # um arquivo
pnpm vitest run -t "Caixa de Sugestões"       # pelo nome do teste ou do grupo
```

Os testes **não precisam de banco**: o Prisma é substituído por um mock (`src/lib/__mocks__/prisma.ts`) e as rotas são chamadas com `app.inject()`. Os auxiliares ficam em `tests/helpers/` (tokens, fábricas de dados, reset de mocks).

- `tests/produtos/`: fluxos completos pela API (login, aluno, chamado, catálogo, autorização, sugestões…).
- `tests/core/` e demais pastas: testes de controllers e services.

## API

A referência completa, com o formato de cada requisição e resposta, está no **Swagger** (`/docs`). Grupos de rotas:

| Prefixo | Assunto |
|---|---|
| `/auth` | Login (e-mail ou RA), refresh, logout, primeiro acesso, esqueci/redefinir senha |
| `/usuarios` | Alunos e funcionários |
| `/tickets` | Chamados, mensagens (`/tickets/:id/mensagens`) e estatísticas |
| `/catalogo` | Categorias e serviços |
| `/sugestoes` | Caixa de sugestões |
| `/notifications` | Notificações do usuário |
| `/admin` | Setores, papéis, funcionários por setor e modelos de e-mail |
| `/tickets/:id/anexos`, `/anexos/:id/download` | Upload, lista e download de anexos (sempre autenticado) |
| `/ws` | WebSocket: o cliente envia `{ "type": "auth", "token": "<access token>" }` logo após conectar |

As rotas exigem `Authorization: Bearer <token>`, exceto as de autenticação (login, primeiro acesso, senha), `GET /catalogo` e `/health`. Os perfis são `USUARIO` (aluno), `BACKOFFICE`, `TECNICO` e `ADMINISTRADOR`.

## Estrutura do projeto

```text
src/
├── server.ts          # ponto de entrada
├── app.ts             # registra plugins e rotas, WebSocket
├── env.ts             # validação das variáveis de ambiente
├── core/<módulo>/     # um módulo por assunto (tickets, sugestoes, auth…):
│   ├── *.routes.ts    #   rotas e permissões
│   ├── *.controller.ts#   valida a entrada e responde
│   └── *.service.ts   #   regras de negócio e acesso ao banco
├── validators/        # schemas Zod de cada módulo
├── plugins/           # autenticação, CORS, rate limit, Swagger…
├── lib/               # Prisma Client e auditoria
└── jobs/              # tarefas agendadas (limpeza de anexos)
prisma/                # schema, migrações e seed
tests/                 # testes (Vitest)
analytics/report.py    # relatório de análise de chamados (Python, usa a API)
```

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `P1001: Can't reach database server` | Docker fechado ou porta errada | Abra o Docker Desktop, rode `docker compose up -d` e confira a porta **3307** no `DATABASE_URL` |
| A API não sobe e lista variáveis inválidas | Falta variável obrigatória | Compare o `.env` com a tabela acima |
| Login no frontend falha com "Failed to fetch" | CORS | Inclua `http://localhost:3000` em `CORS_ORIGIN` e reinicie a API |
| Login parece funcionar, mas volta para `/login` | Segredo JWT diferente no frontend | `JWT_ACCESS_SECRET`, `JWT_ISSUER` e `JWT_AUDIENCE` precisam ser iguais nos dois `.env` |
| `ERR_PNPM_IGNORED_BUILDS` | pnpm bloqueou scripts de instalação | `pnpm approve-builds` → `a` → Enter → `pnpm install` |

## Deploy

- `Dockerfile`: imagem de produção (Node 20).
- `.github/workflows/deploy.yml`: deploy na AWS ECS, disparado **manualmente** em *Actions → Deploy to AWS ECS*.
- Versões: cada merge em `main` gera uma release automática (veja [Releases](https://github.com/4dsm2026/backend_fatecProjeto/releases)).

## Contribuindo

Siga o [guia de contribuição da organização](https://github.com/4dsm2026/.github/blob/main/CONTRIBUTING.md): issue → branch `<tipo>/issue-<número>-<descrição>` → PR para `develop`. O `pnpm install` ativa os hooks do git, que conferem a mensagem de commit e bloqueiam arquivos grandes e `.env`.
