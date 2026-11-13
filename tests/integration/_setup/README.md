# Infraestrutura Compartilhada de Testes de Integração (Testcontainers + MySQL + Fastify HTTP)

Esta pasta contém o harness provisório de integração com **MySQL descartável**, **migrations reais via Prisma** e **servidor HTTP Fastify real** em execução serial, compartilhado pelos testes de infraestrutura, domínio de setores/vínculos, jornada J7 e adaptadores para os demais módulos.

---

## 1. Requisitos locais

- **Docker** em execução (Docker Desktop no Windows/macOS ou daemon Docker no Linux) com permissão para subir containers e pulls de imagem.
- **Node.js** e **npm** (com dependências instaladas em `backend_fatecProjeto`).
- Acesso de rede local para loopback (`127.0.0.1`) com porta efêmera alocada dinamicamente pelo Testcontainers e pelo `app.listen({ port: 0 })`.

> **Observação:** o setup provisório usa [vitest.container.config.ts](../../../vitest.container.config.ts) e não substitui a configuração definitiva do projeto (`vitest.config.ts` / futuro `vitest.integration.config.ts` sob responsabilidade do Andrey).

---

## 2. Como executar

A partir de `backend_fatecProjeto`:

```powershell
# Suíte completa do harness containerizado (smokes, setores, vínculos e jornada J7)
npx vitest run --config vitest.container.config.ts

# Apenas smokes de infraestrutura
npx vitest run --config vitest.container.config.ts tests/integration/smoke

# Apenas CRUD de setores
npx vitest run --config vitest.container.config.ts tests/integration/setores/crud.test.ts

# Apenas vínculos usuário-setor (inclui as 4 regressões vermelhas preservadas)
npx vitest run --config vitest.container.config.ts tests/integration/usuario-setor/bindings.test.ts

# Apenas jornada J7 (setores + chamados + auditoria)
npx vitest run --config vitest.container.config.ts tests/integration/journeys/j7-sector-audit.test.ts

# Verificação de encerramento de processo (EOF sem open handles presos)
npx vitest run --config vitest.lifecycle-eof.config.ts
```

Para forçar outra tag do MySQL em ambientes offline ou espelhados:

```powershell
$env:TEST_MYSQL_IMAGE = "mysql:8.0.39"
npx vitest run --config vitest.container.config.ts
```

---

## 3. Variáveis de ambiente de teste

O container e o ambiente são inicializados **antes** de qualquer import de `src/app.ts` ou `src/lib/prisma.ts`:

| Variável | Origem / Uso no harness | Observação |
|---|---|---|
| `TEST_MYSQL_IMAGE` | Opcional; padrão `mysql:8.0.39` | Lida em `globalSetup.ts`. |
| `NODE_ENV` | Definida como `'test'` no `workerSetup.ts` | Não é usada como proteção única do reset. |
| `DATABASE_URL` | URI dinâmica do container descartável (`inject('integrationDatabaseUrl')`) | Nunca aponta para bancos `.env` persistentes. |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `COOKIE_SECRET` | Segredos aleatórios gerados por execução (`randomBytes(32)`) | Nunca use segredos reais aqui. |
| `DEFAULT_TEMP_PASSWORD` | Senha temporária aleatória por execução | Atende à política de senha do backend em testes. |
| `STORAGE_DRIVER` / `LOCAL_STORAGE_DIR` | `'local'` + diretório temporário único `workflow-integration-*` em `os.tmpdir()` | Validado e limpo após os testes. |
| `MAIL_DRIVER` / `RESEND_API_KEY` / `RESEND_BASE_URL` | `'resend'`, `'test-only'`, `'http://127.0.0.1:9'` | Stub de descarte; não envia e-mails reais. |

Os valores compartilhados entre `globalSetup` e o worker serial são trafegados via `provide` / `inject` do Vitest (`integrationDatabaseUrl`, `integrationStorageDir`, `integrationToken`) e `tests/integration/_setup/contracts.ts` não possui imports de runtime de aplicação, Prisma ou ambiente.

---

## 4. Garantias de segurança e isolamento

- **Token de propriedade (`_integration_owner`)**: `globalSetup.ts` grava um token único gerado por execução na tabela `_integration_owner` dentro do MySQL descartável. `resetDatabase()` valida esse token antes de apagar qualquer registro e **aborta** se o banco não pertencer à execução atual (não depende apenas de `NODE_ENV=test`).
- **Limpeza respeitando chaves estrangeiras**: `resetDatabase()` **não** usa `SET FOREIGN_KEY_CHECKS = 0`. A limpeza ocorre em uma transação Prisma seguindo a ordem topológica das 23 tabelas mapeadas em `prisma/schema.prisma`, após anular a autorreferência `sessoes.substituidaPorId`.
- **Proteção contra tabelas não mapeadas**: `resetDatabase()` consulta `information_schema.tables` e falha explicitamente caso exista alguma tabela nova fora de `PRESERVED_TABLES` (`_prisma_migrations`, `_integration_owner`) e da lista conhecida de limpeza.
- **Preservação de migrations e re-seed atômico**: `_prisma_migrations` é preservada e `seedReference(tx)` executa dentro da mesma transação do reset para recriar o papel de referência (`id: 'integration-reference-role'`).
- **Limpeza segura de storage local**: `resetDatabase()` só remove diretórios contidos em `os.tmpdir()` cujo nome base inicie com `workflow-integration-`.
- **Worker único serial (`singleFork: true`)**: o worker reaproveita a instância Fastify (`createTestApp()`) entre arquivos no mesmo processo e realiza o encerramento no final (`tests/integration/smoke/close.test.ts` + teardown global).

---

## 5. Limitações conhecidas e decisões pendentes

1. **4 regressões conhecidas mantidas vermelhas em `tests/integration/usuario-setor/bindings.test.ts` (`BE-12`)**:
   - Criação concorrente de vínculo com `papelId: null` produz `[201, 201]` e 2 registros em vez de impedir duplicidade.
   - Criação sequencial de vínculo com `papelId: null` produz `201` e 2 registros em vez de `409`.
   - `POST /admin/sectors/:setorId/users` com `usuarioId` / `setorId` / `papelId` inexistentes deixa escapar Prisma `P2003` retornando **HTTP 500** (decisão pendente entre `400` e `404`).
   - `PATCH /admin/user-sectors/:usuarioSetorId` com `papelId` inexistente deixa escapar Prisma `P2003` retornando **HTTP 500** (decisão pendente entre `400` e `404`).
2. **Patches de ciclo de vida ainda pendentes de aprovação em produção**:
   - O timer de limpeza de anexos (`src/app.ts`) e falhas parciais de inicialização dependem das propostas registradas na raiz do projeto (`proposta-cancelamento-cleanup.patch` e `proposta-falha-inicializacao.patch`), que **não** foram aplicadas automaticamente ao código de produção.
3. **E-mail / Resend**: `RESEND_BASE_URL=http://127.0.0.1:9` funciona para fluxos que disparam envio assíncrono tolerante a erro, mas **não** captura nem verifica conteúdo de e-mails (ex.: token de reset de senha). Fluxos que exigem leitura de caixa postal dependem do mailbox de teste (Rodrigo).
4. **Execução exclusivamente serial**: `resetDatabase()` limpa o banco inteiro; portanto os arquivos que compartilham este harness **não** devem rodar em paralelo entre workers.

---

## 6. Diagnóstico de falhas frequentes

- **Erro ao subir container / socket Docker**: verifique se o Docker Desktop está iniciado e acessível pelo usuário atual.
- **`Tabela(s) não mapeada(s) no resetDatabase`**: um novo model foi adicionado ao `prisma/schema.prisma` sem atualizar `DELETE_ORDER` em `tests/integration/_setup/resetDatabase.ts`.
- **Erro de propriedade do banco (`Token de integração ausente ou incompatível`)**: `DATABASE_URL` não aponta para o MySQL inicializado pelo `globalSetup.ts` desta execução.
- **`Falha de autenticação / usuário inativo` após reset**: cada `it`/`beforeEach` que chama `resetDatabase(ctx)` recria apenas o papel de referência (`id: 'integration-reference-role'`); usuários, setores e vínculos precisam ser recriados pelo próprio teste ou helper.
- **Processo Vitest travado no encerramento (`open handles`)**: certifique-se de que `tests/integration/smoke/close.test.ts` executa por último no `vitest.container.config.ts` ou que todo `app` criado fora do singleton teve `await app.close()` executado em `finally`.

---

## 7. Como os demais integrantes devem integrar seus testes

- **Contratos compartilhados**: importe apenas tipos de `tests/integration/_setup/contracts.ts` (zero imports de runtime).
- **Matheus (Chamados / J1)**: utilize `prepareTicketFixtures` ou `createPrepareTicketFixtures(authDeps?)` em `tests/integration/_setup/prepareTicketFixtures.ts` com `registerTicketScenarios` e `registerJ1` sem subir um segundo container ou uma segunda instância Fastify.
- **Rodrigo (Autenticação / Usuários / Mailbox)**: ao substituir a criação/login padrão por helpers definitivos de autenticação, passe `{ createUser, loginAs }` para `createPrepareTicketFixtures` e reutilize `ctx` (`createTestApp`) para injetar URL de mailbox HTTP antes de importar `src/app.ts` (ou evoluir `workerSetup.ts` quando a suíte unificada for consolidada).
- **Guilherme (HAL / Auditoria)**: utilize `ctx.baseUrl`, tokens de `POST /sessions` e validação real contra `/admin/audit-logs` e `/tickets/:id/history` conforme demonstrado em `tests/integration/journeys/j7-sector-audit.test.ts`.
- **Andrey (Vitest / CI / Coverage)**: consolide os arquivos de `tests/integration/_setup/` na configuração definitiva (`vitest.integration.config.ts`), mantendo `singleFork: true` (ou `poolOptions.forks.singleFork`), ordem de fechamento do singleton e inclusão das pastas `smoke/`, `setores/`, `usuario-setor/` e `journeys/` conforme os scripts e políticas de cobertura do projeto.
