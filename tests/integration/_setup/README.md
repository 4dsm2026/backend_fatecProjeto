# Infraestrutura Compartilhada de Testes de Integração (Testcontainers + MySQL + Fastify HTTP)

Esta pasta contém o harness provisório de integração com **MySQL descartável**, **migrations reais via Prisma** e **servidor HTTP Fastify real** em execução serial, compartilhado pelos testes de infraestrutura, domínio de setores/vínculos, jornada J7 e adaptadores para os demais módulos.

---

## 1. Requisitos locais

- **Docker** em execução (Docker Desktop no Windows/macOS ou daemon Docker no Linux) com permissão para subir containers e pulls de imagem.
- **Node.js** e **pnpm** (com dependências instaladas em `backend_fatecProjeto`).
- Acesso de rede local para loopback (`127.0.0.1`) com porta efêmera alocada dinamicamente pelo Testcontainers e pelo `app.listen({ port: 0 })`.

> A configuração de integração usa [vitest.container.config.ts](../../../vitest.container.config.ts). Os testes unitários usam `vitest.config.ts` e não inicializam os containers.

---

## 2. Como executar

A partir de `backend_fatecProjeto`:

```powershell
# Testes unitários, sem Docker
pnpm test

# Integração com Docker, geração do Prisma e relatório de cobertura
pnpm test:integration

# Todas as etapas, parando se uma falhar
pnpm test:all

# Apenas smokes de infraestrutura
pnpm exec vitest run --config vitest.container.config.ts tests/integration/smoke

# Apenas CRUD de setores
pnpm exec vitest run --config vitest.container.config.ts tests/integration/setores/crud.test.ts

# Apenas vínculos usuário-setor (inclui as 4 regressões vermelhas preservadas)
pnpm exec vitest run --config vitest.container.config.ts tests/integration/usuario-setor/bindings.test.ts

# Apenas jornada J7 (setores + chamados + auditoria)
pnpm exec vitest run --config vitest.container.config.ts tests/integration/journeys/j7-sector-audit.test.ts

# Verificação de encerramento de processo (EOF sem open handles presos)
pnpm exec vitest run --config vitest.lifecycle-eof.config.ts
```

Para forçar outra tag do MySQL em ambientes offline ou espelhados:

```powershell
$env:TEST_MYSQL_IMAGE = "mysql:8.0.39"
pnpm exec vitest run --config vitest.container.config.ts
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
| `MAIL_DRIVER` / `RESEND_API_KEY` / `RESEND_BASE_URL` | `'resend'`, `'test-only'`, URL dinâmica do container de mailbox | Captura e-mails localmente, sem envio real. |

Os valores compartilhados entre `globalSetup` e o worker serial são trafegados via `provide` / `inject` do Vitest (`integrationDatabaseUrl`, `integrationStorageDir`, `integrationToken`, `integrationMailboxUrl`) e `tests/integration/_setup/contracts.ts` não possui imports de runtime de aplicação, Prisma ou ambiente.

---

## 4. Garantias de segurança e isolamento

- **Token de propriedade (`_integration_owner`)**: `globalSetup.ts` grava um token único gerado por execução na tabela `_integration_owner` dentro do MySQL descartável. `resetDatabase()` valida esse token antes de apagar qualquer registro e **aborta** se o banco não pertencer à execução atual (não depende apenas de `NODE_ENV=test`).
- **Limpeza respeitando chaves estrangeiras**: `resetDatabase()` **não** usa `SET FOREIGN_KEY_CHECKS = 0`. A limpeza ocorre em uma transação Prisma seguindo a ordem topológica das tabelas mapeadas em `prisma/schema.prisma`, após anular a autorreferência `sessoes.substituidaPorId`.
- **Proteção contra tabelas não mapeadas**: `resetDatabase()` consulta `information_schema.tables` e falha explicitamente caso exista alguma tabela nova fora de `PRESERVED_TABLES` (`_prisma_migrations`, `_integration_owner`) e da lista conhecida de limpeza.
- **Preservação de migrations e re-seed atômico**: `_prisma_migrations` é preservada e `seedReference(tx)` executa dentro da mesma transação do reset para recriar o papel de referência (`id: 'integration-reference-role'`).
- **Limpeza segura de storage local**: `resetDatabase()` só remove diretórios contidos em `os.tmpdir()` cujo nome base inicie com `workflow-integration-`.
- **Worker único serial (`singleFork: true`)**: o worker reaproveita a instância Fastify (`createTestApp()`) entre arquivos no mesmo processo e realiza o encerramento no final (`tests/integration/smoke/close.test.ts` + teardown global).

---

## 5. Limitações conhecidas e decisões pendentes

1. **Vínculos (`BE-12`)**: a migration de unicidade exige apenas um vínculo por usuário e setor. Em banco existente, identifique e revise duplicatas antes de aplicá-la; a migration falha em vez de apagar registros. Referências inexistentes no POST e no PATCH retornam HTTP 400.
2. **Patches de ciclo de vida ainda pendentes de aprovação em produção**:
   - O timer de limpeza de anexos (`src/app.ts`) e falhas parciais de inicialização dependem das propostas registradas na raiz do projeto (`proposta-cancelamento-cleanup.patch` e `proposta-falha-inicializacao.patch`), que **não** foram aplicadas automaticamente ao código de produção.
3. **E-mail / Resend**: um container Node executa uma API falsa de mailbox, limpa antes de cada teste. As jornadas testam e-mails de ativação e recuperação de senha e notificações conforme a preferência. A preferência de e-mail é independente da preferência interna e começa desativada.
4. **Cobertura e CI**: os relatórios unitário e de integração são separados e configurados como entrada do Sonar. O CI publica o relatório de integração como artefato mesmo em caso de falha. A execução remota, a importação dos dois relatórios e a chave do projeto Sonar ainda precisam ser verificadas.
5. **Execução exclusivamente serial**: `resetDatabase()` limpa o banco inteiro; portanto os arquivos que compartilham este harness **não** devem rodar em paralelo entre workers.
6. **Privacidade no WebSocket**: o teste de integração em `tests/integration/core/messages-ws-security.test.ts` verifica que o dono e a equipe recebem a mensagem, enquanto outro aluno não a recebe.

---

## 6. Diagnóstico de falhas frequentes

- **Erro ao subir container / socket Docker**: verifique se o Docker Desktop está iniciado e acessível pelo usuário atual.
- **`Tabela(s) não mapeada(s) no resetDatabase`**: um novo model foi adicionado ao `prisma/schema.prisma` sem atualizar `DELETE_ORDER` em `tests/integration/_setup/resetDatabase.ts`.
- **Erro de propriedade do banco (`Token de integração ausente ou incompatível`)**: `DATABASE_URL` não aponta para o MySQL inicializado pelo `globalSetup.ts` desta execução.
- **`Falha de autenticação / usuário inativo` após reset**: cada `it`/`beforeEach` que chama `resetDatabase(ctx)` recria apenas o papel de referência (`id: 'integration-reference-role'`); usuários, setores e vínculos precisam ser recriados pelo próprio teste ou helper.
- **Processo Vitest travado no encerramento (`open handles`)**: certifique-se de que `tests/integration/smoke/close.test.ts` executa por último no `vitest.container.config.ts` ou que todo `app` criado fora do singleton teve `await app.close()` executado em `finally`.

---

## 7. Como acrescentar testes

- Use `createTestApp()` e os helpers em `tests/integration/_helpers/`; o servidor e os containers são compartilhados.
- As fixtures de chamados usam `prepareTicketFixtures`. As suítes de chamados e J1 são registradas em `tests/integration/tickets/tickets.shared.test.ts`.
- O banco, os arquivos temporários e a mailbox são limpos entre testes. Não execute esses arquivos em paralelo usando o mesmo banco.
- Coloque novos testes compartilhados em `tests/integration/core/` ou inclua-os explicitamente em `vitest.container.config.ts`.
- Se o schema ganhar uma tabela, atualize a ordem de limpeza antes de executar a suíte.
