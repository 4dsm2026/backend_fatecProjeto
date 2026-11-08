---
sidebar_position: 4
---

# Guia de execução — API REST nível 3 (HAL) com qualidade Sonar

> **Atualizado em 24/10/2026.** As seções 3 (estado das decisões), 4 (estado dos achados de segurança) e 6.2 (matriz do chamado) foram revisadas com o que está implementado em `tickets` e `ticket-messages`. O restante é o texto original de 04/10 e **não foi medido de novo**.

> **Para quem é:** Andrey, Guilherme, Matheus, Rodrigo e Otávio.
> **Complementa** o `PLANO-DE-TRABALHO.md` e o `CONVENCOES-API.md` (leia os dois antes; este guia **não os substitui**, ele diz *como executar* e *o que o código atual realmente tem*).
> **Repos analisados:** `backend_fatecProjeto` (branch `Fiat-Uno`) e `frontend_fatecProjeto` (branch `Novas-Funcionalidades_1`).
> **Data da análise:** 04/10/2026.

**Legenda de confiança** (usada em todo o documento):
- ✅ **Verificado** — li no código ou executei e vi o resultado.
- ⚠️ **Inferido** — conclusão minha a partir do que li; confirme antes de depender.
- ❓ **Não verificado** — não consegui checar; está marcado como tarefa.
- 💡 **Proposta** — sugestão minha, ainda não é decisão do grupo.

---

## 0. Como usar este guia com o Claude

Cada pessoa vai executar sua parte conversando com o Claude. Para ele não perder o fio:

1. **Abra uma conversa nova por módulo** (conversas longas perdem contexto).
2. **Cole o bloco de contexto abaixo** + **a sua seção deste guia** + `CONVENCOES-API.md`.
3. **Anexe/clone** os repositórios. O Claude consegue clonar repositórios públicos do GitHub e editar a cópia local, mas **não consegue fazer push nem abrir PR**: ele entrega os arquivos alterados ou um patch, e **vocês** aplicam e fazem o commit.
4. **Limitação do ambiente do Claude:** o download do engine do Prisma foi bloqueado (403) no sandbox dele. Por isso `prisma generate` não completa lá, o `typecheck` mostra erros falsos de Prisma e alguns testes não carregam. **Rode `pnpm prisma:generate && pnpm typecheck && pnpm test` na máquina de vocês** antes de abrir o PR.
5. Peça sempre ao Claude: *"rode o lint com SonarJS e me mostre a saída"*. O lint com as regras do SonarJS (o motor que o SonarQube usa) **roda de verdade** e é o nosso detector principal.

### Bloco de contexto (copie e cole no início da conversa)

```text
Projeto: Workflow (helpdesk FATEC). Back: Fastify 5 + Prisma 6 + Zod 3 + Vitest 2, pnpm.
Front: Next.js. Estamos convertendo a API para REST nível 3 (HATEOAS, formato HAL,
erros RFC 7807, paginação page/size). Branch de integração: Fiat-Uno.
Leia CONVENCOES-API.md e a minha seção do GUIA-DE-EXECUCAO-HATEOAS.md (anexos).
Eu sou <NOME> e sou dono APENAS destes arquivos: <lista da minha seção>.
Não altere arquivos fora dessa lista; se precisar, me diga o que e por quê.
Regras: sem `any`; links só via helpers de src/hateoas; links dependem de estado e papel;
erros via ApiError (RFC 7807); testes cobrem links presentes e AUSENTES por papel/estado.
Antes de entregar: pnpm lint (SonarJS), pnpm typecheck, pnpm test --coverage.
Não invente: se não leu o arquivo, leia. Marque o que não conseguiu verificar.
```

### Roteiro de prompts (use na ordem)

1. *"Clone o back e o front, leia os arquivos da minha lista e me resuma as rotas atuais do meu módulo e o formato de cada resposta."*
2. *"Monte a tabela de links por recurso: para cada ação, o estado permite? o papel permite? (as 3 perguntas)."*
3. *"Implemente as rotas novas + builder de links + testes. Mostre o diff por arquivo."*
4. *"Rode lint (SonarJS), typecheck e testes. Corrija tudo que for do meu módulo."*
5. *"Faça uma revisão crítica do seu próprio diff como um revisor do SonarQube e me diga o que ainda pode falhar."*

---

## 1. Contexto em 5 minutos

### 1.1 Modelo de maturidade de Richardson — onde estamos

| Nível | Exigência | Estado atual do backend |
|---|---|---|
| 0 | Um endpoint, tudo via POST | ❌ já passamos disso |
| 1 | Recursos com URL própria | ✅ existe, **mas** há rotas de verbo: `/auth/login`, `/auth/esqueci-senha`, `/notifications/read-all`, `/:id/archive`, `/:id/unarchive`, `/anexos/:id/download-token` |
| 2 | Verbos e status HTTP corretos | ⚠️ **parcial**. Ações de estado usam `POST` (archive). Nenhum `201` manda `Location` (✅ `grep` não achou `Location` nem `exposedHeaders` em `src`). `DELETE /tickets/:id` devolve `200` com corpo, não `204`. Há 49 ocorrências de `code(500)` em blocos `catch` e nenhum `422` |
| 3 | HATEOAS: a resposta diz o que fazer a seguir | ❌ zero. Nenhum `_links` em `src` |

**Meta:** nível 3 em **todas** as rotas, com a regra mental: *"tem o link? mostra o botão. Não tem? esconde."*

### 1.2 HAL em uma tela

```json
{
  "id": "clx1", "titulo": "Sem acesso ao SIGA", "status": "RESOLVIDO",
  "_links": {
    "self":       { "href": "/tickets/clx1", "method": "GET" },
    "reply":      { "href": "/tickets/clx1/messages", "method": "POST" },
    "transition": [
      { "href": "/tickets/clx1", "method": "PATCH", "name": "EM_ATENDIMENTO" },
      { "href": "/tickets/clx1", "method": "PATCH", "name": "ENCERRADO" }
    ]
  }
}
```

- Um `rel` com **vários** links usa **array** (HAL permite) e o `name` identifica cada um. 💡 É a minha proposta para transições de status; o Matheus decide (D2).
- **Segurança:** esconder link **não é** autorização. O backend tem que **recusar** a ação (403/409) mesmo que alguém monte a URL na mão.

---

## 2. Linha de base medida (o que existe hoje)

### 2.1 Lint com regras SonarJS — ✅ executado de verdade

Instalei `eslint-plugin-sonarjs@4.2.2` (295 regras, 230 ativas no perfil `recommended`), `typescript-eslint@8.71` e rodei contra as cópias dos repositórios.

| Repositório | Achados | Principais |
|---|---:|---|
| **Back** (`src` + `tests`) | **177** | `no-explicit-any` 125 · `no-unused-vars` (TS) 22 · `sonarjs/unused-import` 15 · `cognitive-complexity` 2 · `concise-regex` 2 · `no-hardcoded-passwords` 2 · `no-nested-conditional` 2 · `no-duplicate-test-title` 2 · `todo-tag` 1 · `no-empty` 1 · `publicly-writable-directories` 1 · `no-unused-vars` 1 · `no-dead-store` 1 |
| **Front** | **156** (129 erros + 27 avisos) | `no-explicit-any` 56 · `no-nested-conditional` 33 · `no-unused-vars` (TS) 21 · `unused-import` 15 · `cognitive-complexity` 9 · `super-linear-regex` 5 · `react-hooks/exhaustive-deps` 4 |

Observações importantes:
- **Correção:** numa mensagem anterior eu disse "115 `any`". Esse número vinha de um `grep`. **O correto é 125**, medido pelo linter.
- O `eslint.config.js` do back estava **vazio (0 bytes)**; com ele `pnpm lint` não checava nada. A configuração descrita na seção 9.2 foi **validada no repositório** (rodou e produziu esses números).
- **Regras que só aparecem com informação de tipos** (rodei à parte no front): `prefer-read-only-props` 66 (props de componente sem `Readonly`), mais 1 `deprecation`, 1 `no-alphabetical-sort`, 1 `no-misleading-array-reverse`, 1 `different-types-comparison`. Podem aparecer no Sonar real.
- `no-duplicate-string` (S1192) vem **desligada** no perfil recomendado. Com limite 3 ocorrências: **33** no back e **14** no front. Podem entrar dependendo do perfil de qualidade do servidor Sonar de vocês.
- ❓ Não consegui rodar o **SonarQube/scanner em si** (precisa de servidor). O lint SonarJS é a melhor aproximação local, não é o gate oficial.

### 2.2 Testes e cobertura — ✅ medido, ⚠️ com ressalva de ambiente

Com o Prisma client **não gerado** (download bloqueado), no sandbox: **376 testes, 366 passam, 10 falham em 5 arquivos**.

| Arquivo | Falhas | Causa |
|---|---:|---|
| `notifications.controller.test.ts` | 3 | ✅ texto: o código diz "Notificação não encontrad**o**" (vem de `sendNotFound` em `utils/http.ts`) e o teste espera "encontrad**a**" |
| `usuarioSetor.service.test.ts` | 2 | ⚠️ erro `Right-hand side of 'instanceof'` — `Prisma.PrismaClientKnownRequestError` indefinido; **provavelmente é o ambiente** (client não gerado) |
| `anexos.routes.test.ts` | 3 | ❓ não investiguei |
| `03-chamado.test.ts` | 2 | ❓ não investiguei (PATCH de status) |
| `auditoria.controller.test.ts` | arquivo não carrega | ⚠️ provavelmente ambiente |

> **Correção:** antes eu falei em "6 testes já falhavam". O número medido agora é 10, e **parte pode ser só do meu ambiente**. Rodem localmente para a linha de base real.

**Cobertura (v8):** statements/lines **91,6%** · branches **75,17%** · functions **84,81%**. ⚠️ Medida só sobre `src/core/**` + `src/validators/**` (é o `include` atual do vitest). Os demais arquivos de `src` **não entram** na conta; no Sonar eles contariam como 0%. Trocar o `include` para `src/**/*.ts` vai **baixar** o número, e é o número honesto.

`coverage/lcov.info` é gerado corretamente (57 arquivos), mas o `vitest.config.ts` precisa de `reporter: ['lcov']` e `reportOnFailure: true` (seção 9.2).

---

## 3. Decisões pendentes (resolver ANTES de codar o que depende delas)

Cada decisão tem um **padrão recomendado**: se o grupo não decidir de outra forma, siga o padrão.

| # | Decisão | Padrão recomendado 💡 | Dono | Quem depende |
|---|---|---|---|---|
| **D1** | Paginação: base 0 ou 1? | **Base 0**, como diz `CONVENCOES-API.md` (`page` 0, `size` 20, máx. 100). Hoje back e front usam `page=1` e nomes diferentes (`pageSize`, `perPage`). Notificações aceitam até **1000** por página (✅ validator). O front precisa trocar toda a paginação | Matheus | todos |
| **D2** | Matriz **estado × papel × ação** do chamado (seção 6.2), regra nova de **bloquear mensagem/anexo em `ENCERRADO`** e transições válidas com **409** | Usar a matriz proposta na seção 6.2 | Matheus | Guilherme (anexos), Rodrigo (`/users/me`) |
| **D3** | `POST /users` está em **conflito**: o mapa manda `/auth/register` (público) **e** o `POST /usuarios` (admin) para a mesma rota | `POST /users` **só ADMINISTRADOR**; remover o registro público (o front **não** chama `/auth/register`, ✅ grep) ou forçar `role: USUARIO` | Rodrigo + Andrey | — |
| **D4** | Catálogo: vem da API ou do front? Há `app/catalogo/route.ts` e `utils/catalogo.ts` estáticos no front | Decidir com o grupo; se for API, `GET /catalog` e o front remove os estáticos | Guilherme | — |
| **D5** | `DELETE /sessions/current`: como achar a sessão? O access token só leva `sub`, `email`, `role` (✅ `utils/jwt.ts`) | Incluir claim **`sid`** (id da `Sessao`) no access token. O id é estável: `rotateSession` troca só o hash do refresh (✅) | Rodrigo | Matheus (`/api`) |
| **D6** | `POST …/download-tokens`: o token (5 min) é gerado, mas **nenhum código chama `verifyDownloadToken`** (✅ grep) e o front não usa | **Remover** o endpoint, a menos que alguém defina um uso | Guilherme | — |
| **D7** | O front chama `/tickets/:id/mensagens/lidas`, que **não existe** no back (✅ grep) | Decidir: implementar (⚠️ precisa de campo de leitura na mensagem; confira `schema.prisma`) ou remover a chamada | Matheus | Otávio |
| **D8** | Quem faz o handler RFC 7807? O plano põe no Matheus (Fase 1) | A **especificação do núcleo** (seção 9.1) inclui o handler RFC 7807; o Matheus gera o núcleo e o Rodrigo faz a **integração** (substituir handler, `auth-verify`, `sendNotFound`, `sendReply`) | Matheus + Rodrigo | todos |
| **D9** | Rotas de apoio: `POST /notifications/test`, `POST /admin/comunicacoes/teste`, `POST /auditoria` | Mapear para recursos (`…/communication-tests`) **ou** restringir/remover. **Quem pode `POST /auditoria`?** (❓ confira `authorize`) | Otávio / Andrey / Guilherme | — |
| **D10** | Nomes dos `rel` em `_embedded` e links | **Inglês** (`tickets`, `messages`); campos e enums continuam em português | Matheus | todos |
| **D11** | `GET /auth/usuarios`: qualquer usuário logado lista todos os usuários (segundo o Swagger do próprio código) | **Remover** (o front não usa, ✅ grep) | Rodrigo | — |

### Estado das decisões em 24/10/2026

| # | Estado | Onde está |
|---|---|---|
| **D1** | ✅ implementada | Base 0 com `page` e `size` em `tickets` e `ticket-messages`, e nas telas de chamado |
| **D2** | ✅ implementada | Matriz da seção 6.2 (atualizada), em `src/core/tickets/ticket-rules.ts` |
| **D7** | ✅ implementada | Campo `lidaEm` na mensagem, `PATCH /tickets/:id/messages` com `{ "lida": true }` e link `mark-read` na coleção |
| **D8** | ✅ integrada (pelos commits do Rodrigo) | Handler global em `problem+json`, `auth-verify` e `ApiError` |
| **D10** | ✅ aplicada | `rel` em inglês (`tickets`, `messages`); campos e enums em português |
| D3, D4, D5, D6, D9, D11 | não verificado | Cada dono confirma o estado no próprio módulo |

✅ **Corrigido em `CONVENCOES-API.md`:** o exemplo da seção 4 agora usa `protocolo` e `ABERTO`.

---

## 4. Segurança e correções que NÃO são Sonar (mas viram trabalho)

Achados lendo o código. Estão no seu módulo; resolva junto da conversão.

| # | Achado | Confiança | Dono |
|---|---|---|---|
| **S1** | `ticketInclude` usa `base[k] = true` para `criadoPor`/`responsavel`. No Prisma, `include: { criadoPor: true }` devolve **todas as colunas** do usuário, **incluindo `senhaHash`**. Não vi nenhum `omit`/extensão em `lib/prisma.ts` nem nos plugins. O `POST /tickets` já usa `include criadoPor` e o front pede `include=setor,responsavel` | ⚠️ pelo código; ❓ **confirme com um teste contra banco real**. Trocar por `select` explícito (`id`, `nome`, `emailPessoal`...) | Matheus |
| **S2** | `RegisterSchema` aceita `role` de qualquer chamador. O Swagger do código afirma que isso permite criar `ADMINISTRADOR` sem login | ✅ validator; ❓ não li o corpo do `register` | Rodrigo (D3) |
| **S3** | Erro 500 do login devolve `debug: e.message` ao cliente | ✅ | Rodrigo |
| **S4** | `authRateLimit` (10/min) existe em `plugins/rateLimit.ts` mas **nenhuma rota o importa**; o login cai no limite global de 100/min. O `keyGenerator` confia em `X-Forwarded-For` (falsificável) | ✅ grep; ❓ não verifiquei `trustProxy` | Rodrigo |
| **S5** | `PATCH /tickets/:id` só checa dono para o aluno; o schema aceita `status`, `responsavelId`, `prioridade`, SLA. Aluno pode ainda `DELETE` do próprio chamado | ✅ (análise anterior) | Matheus |
| **S6** | Não há máquina de estados: `updateTicket` aceita qualquer status→qualquer status e `createTicketMessage` aceita mensagem em `ENCERRADO`. **Só o front** esconde o campo (`isEncerrado` em `aluno/chamados/[id]/page.tsx`) | ✅ | Matheus (D2) |
| **S7** | `apenasNaoLidas: z.coerce.boolean()`: `Boolean("false")` é `true`, então `?apenasNaoLidas=false` **filtra só as não lidas** | ✅ validator | Otávio |
| **S8** | `Content-Disposition: attachment; filename="${fileName}"` sem escape | ✅ | Guilherme |
| **S9** | Política de senha duplicada e incoerente: `FirstAccess` e `TrocarSenha` têm a cadeia de regex; `ResetSenhaSchema` só exige `min(8)` (o service valida depois) | ✅ | Rodrigo |
| **S10** | Front guarda `refreshToken` em `localStorage` (legível por XSS) e também usa cookies | ✅ `utils/api.ts` | Rodrigo |
| **S11** | Token na URL (`/password-resets/:token`, `/account-activations/:token`) pode vazar em log de acesso | 💡 | Rodrigo (redigir o path nos logs) |

**Estado em 24/10/2026 (módulo `tickets`):**

- **S1** ✅ corrigido: `criadoPor` e `responsavel` usam `select` com `id`, `nome` e `emailPessoal`. Ainda falta confirmar contra banco real que `senhaHash` não sai.
- **S5** ✅ corrigido: o aluno não edita `status`, `responsavelId`, `prioridade` nem SLA (`403`), e `DELETE /tickets/:id` não existe mais.
- **S6** ✅ corrigido: há máquina de estados no backend (`409` para transição inválida, para mensagem em chamado fechado ou arquivado, e para reabertura fora do prazo).
- **S12** ✅ corrigido (achado novo): o `/ws` repassava a todos os conectados qualquer frame `nova_mensagem` enviado por um cliente autenticado, o que permitia forjar uma mensagem de outra pessoa. O relay foi removido (o front só recebe o evento, que o servidor emite no `POST /messages`) e o teste `tests/security/ws-sem-relay.test.ts` impede a volta.
- **S2 a S4 e S7 a S11** são dos outros donos: não verificados.

---

## 5. Regras comuns (todos)

### 5.1 Git e arquivos

- Branch por módulo saindo de `Fiat-Uno`: `feat/rest-<modulo>`. PR **revisado por outra pessoa**.
- **Não renomeie pastas** de `src/core/*` (são em português). **Só as URLs mudam.** Renomear pasta gera conflito de merge à toa.
- **Arquivos compartilhados têm dono único:**

| Arquivo | Dono | Os outros... |
|---|---|---|
| `src/app.ts` (registro de rotas, CORS `exposedHeaders: ['Location']`, `GET /api`) | Matheus | pedem a linha de registro ao Matheus |
| `src/hateoas/**` | Matheus | só **usam**; precisou de algo novo? avise antes |
| `package.json`, `pnpm-lock.yaml`, `eslint.config.*`, `vitest.config.ts`, `sonar-project.properties`, `.github/**` | Andrey | pedem ao Andrey |
| `src/middlewares/errorHandler.ts`, `src/utils/http.ts`, `src/utils/zod-helpers.ts`, `src/plugins/auth-verify.ts`, `src/plugins/rateLimit.ts` | Rodrigo | — |
| `src/plugins/swagger.ts`, `src/utils/openapi-fragments.ts` | Matheus | cada um mexe só no **fragmento do próprio módulo** |
| `tests/helpers/*`, `tests/setup.ts` | Matheus | pedem ao Matheus |
| `utils/api.ts` (front) | Matheus (cliente HAL) | **Rodrigo** põe a lógica de refresh em `utils/session.ts` (novo); **Guilherme** move `downloadAnexo`/`fetchAnexoImageUrl` para `utils/attachments.ts` (novo) **depois** do merge da Fase 1 |
| `app/(dashboard)/*/chamados/[id]/page.tsx` | Matheus | **Guilherme** entrega o painel de anexos como componente `AnexosPanel.tsx` (novo) que o Matheus importa. Assim os dois não editam o mesmo arquivo |

### 5.2 Padrão de código (Sonar)

1. **Sem `any`.** Use `unknown` + type guard, `Pick`, `z.infer`. É 125 no back e 56 no front hoje; cada módulo limpa o seu enquanto reescreve o controller.
2. **Complexidade cognitiva ≤ 15** por função (regra S3776). Hoje estouram `buildWhere` (22, `tickets.service.ts:28`) e `app.ts:170` (16).
3. **Sem ternário aninhado**, **sem import não usado**, **sem variável morta**.
4. **Sem duplicação:** o código novo **não** copia/cola blocos de erro (os 49 `catch → 500` somem; o handler global resolve).
5. **Links só via `link()`, `path` (template tag) e `buildLinks()`** de `src/hateoas`. Nunca `"/tickets/" + id`. O `path` codifica o id.
6. **Fonte única da regra de papel:** extraia a lista de `authorize([...])` da rota para uma constante exportada (ex.: `TICKET_STAFF_ROLES`) e use a **mesma** no `preHandler` e no builder de links. Assim rota e link nunca divergem.
7. **Erros:** lance `ApiError(kind, title, detail?)`; nunca `res.code(500).send({ error: e.message })` (vaza detalhe interno).
8. Respostas: `201` + `Location` na criação, `204` no delete, `404/409/422` no lugar de `500`.

### 5.3 Definition of Done por módulo (use como checklist no PR)

- [ ] Rotas renomeadas conforme o mapa (seção 8): substantivo, plural, inglês, sem verbo
- [ ] Verbos e status corretos (`201`+`Location`, `204`, `404`/`409`/`422`)
- [ ] Recurso e coleção em HAL, com `self`; coleção com `_embedded`, `page`, `first/prev/next/last`
- [ ] Links condicionados a **estado e papel**, com a regra vinda de constante única
- [ ] Erros via `ApiError` (RFC 7807, `application/problem+json`); nenhum `catch → 500` cru
- [ ] Zero `any` e zero achado SonarJS **no código do módulo**
- [ ] Schemas do Swagger atualizados (inclusive o schema `Link`)
- [ ] Testes refeitos; **para cada papel, link presente ⇔ ação permitida**; para cada estado, link ausente quando não permitido
- [ ] **Teste de contrato:** para cada link devolvido, chamar `href`+`method` com o papel que o recebeu e confirmar que **não** dá `403`/`405`
- [ ] Cobertura do código novo **≥ 80%**, duplicação **≤ 3%**
- [ ] Front do módulo: `hasLink()` no lugar de regra fixa de papel/status; **nenhuma URL montada à mão**
- [ ] `pnpm lint && pnpm typecheck && pnpm test` verdes **na sua máquina**

### 5.4 Portão de qualidade (Sonar)

Meta no **código novo** (padrão "Sonar way"; ⚠️ confirme no gate configurado de vocês): cobertura ≥ 80%, duplicação ≤ 3%, notas **A** em confiabilidade, segurança e manutenibilidade, e 100% dos *security hotspots* revisados.

Comandos:

```bash
pnpm lint                              # ESLint + SonarJS (depois da Fase 0 do Andrey)
pnpm exec eslint src/core/<modulo> -f unix   # só o seu módulo
pnpm typecheck
pnpm exec vitest run --coverage        # gera coverage/lcov.info
```

---

## 6. Fases e ordem

| Fase | Quem | O quê | Bloqueia |
|---|---|---|---|
| **0 — Qualidade** | Andrey | Configuração de lint/cobertura/Sonar/CI (seção 7.5 e 9.2). **Primeiro**, porque mexe em `package.json` | todos (rebase) |
| **1 — Núcleo** | Matheus | Criar `src/hateoas` conforme a especificação da seção 9.1, `GET /api`, `tickets` completo, cliente HAL no front, guia de conversão (a seção 6.1 é o rascunho) | Fase 2 |
| **1b — Erros** | Rodrigo | Integrar o handler RFC 7807 (D8) | Fase 2 |
| **2 — Módulos** | todos, em paralelo | Converter o próprio módulo (backend + front + testes) | Fase 3 |
| **3 — Integração** | todos | Seção 10 | entrega |

Enquanto a Fase 1 acontece, cada um faz o **levantamento do módulo** (seção 7 de cada pessoa, passos "A").

### 6.1 Receita de conversão de um módulo (rascunho do "guia de 1 página")

> O guia definitivo, com receitas de código e as armadilhas que já aconteceram, é o `GUIA-CONVERTER-MODULO.md`. Esta lista é o rascunho original.

1. `grep -n authorize src/core/<modulo>/*.routes.ts` → anote o papel de cada rota.
2. Extraia os papéis para constantes exportadas.
3. Renomeie as rotas (mapa da seção 8). `201`+`Location`, `204`.
4. Troque cada `catch(e){ res.code(500)... }` por `throw` (ou `ApiError`). Apague o `try/catch` se ele só repassava erro.
5. Troque validação manual por `PaginationQuerySchema` + `toSkipTake` (listas).
6. Escreva `build<Recurso>Links(recurso, viewer)` com `buildLinks({...})` e as 3 perguntas.
7. Devolva `toResource(dado, links)` e `toCollection({...})`.
8. Troque `select`/`include` genérico por `select` explícito (sem campo sensível).
9. Atualize o fragmento do Swagger.
10. Reescreva os testes: status, formato HAL, links presentes/ausentes por papel/estado, contrato.
11. Front: troque URL à mão por `followLink`/`hasLink`.
12. `pnpm lint && pnpm typecheck && pnpm test`.


### 6.2 Matriz do chamado (D2): implementada

Fonte única no código: `src/core/tickets/ticket-rules.ts`. **Equipe** = `BACKOFFICE`, `TECNICO` e `ADMINISTRADOR`. **Dono** = o aluno que abriu o chamado.

| Estado atual | A equipe pode ir para | O dono pode ir para | Responder / anexar | Editar dados |
|---|---|---|---|---|
| `ABERTO` | `EM_ATENDIMENTO`, `RESOLVIDO`, `ENCERRADO` | — | dono e equipe | equipe |
| `EM_ATENDIMENTO` | `AGUARDANDO_USUARIO`, `RESOLVIDO`, `ENCERRADO` | — | dono e equipe | equipe |
| `AGUARDANDO_USUARIO` | `EM_ATENDIMENTO`, `RESOLVIDO`, `ENCERRADO` | — | dono e equipe (se o dono responde, volta para `EM_ATENDIMENTO`) | equipe |
| `RESOLVIDO` | `EM_ATENDIMENTO`, `ENCERRADO` | `EM_ATENDIMENTO`, `ENCERRADO` | **ninguém** (precisa reabrir) | equipe |
| `ENCERRADO` | `EM_ATENDIMENTO` | `EM_ATENDIMENTO` | **ninguém** (precisa reabrir) | **ninguém** |

Regras que valem para a tabela toda:

- **Reabrir** é ir de `RESOLVIDO` ou `ENCERRADO` para `EM_ATENDIMENTO`, e só vale em até **30 dias** contados de `encerradoEm` (o 30º dia ainda conta). Depois disso, ninguém reabre, mas ainda é possível encerrar um chamado `RESOLVIDO`.
- **Arquivar** só o `ADMINISTRADOR`, em qualquer status. O chamado arquivado fica **somente leitura** (nenhuma transição, resposta ou edição) e continua consultável.
- **Ninguém apaga** chamado: não existe `DELETE`, nem link `delete`.
- Bloqueio por **estado** responde `409`; bloqueio por **permissão** responde `403`; aluno que não é dono recebe `404`.

As três perguntas que estavam em aberto ficaram assim: (1) o aluno que responde em `AGUARDANDO_USUARIO` **volta o chamado sozinho** para `EM_ATENDIMENTO`; (2) a equipe **pode reabrir** `ENCERRADO`, no mesmo prazo de 30 dias; (3) **ninguém** faz `DELETE`: só arquiva.

---

## 7. Passo a passo por pessoa

### 7.1 Matheus — núcleo + `tickets` + `ticket-messages` + `GET /api` + home/chamados

**Arquivos dono (back):** `src/hateoas/**`, `src/app.ts`, `src/core/tickets/**`, `src/core/ticket-messages/**`, `src/plugins/swagger.ts`, `src/utils/openapi-fragments.ts`, `tests/helpers/*`, `tests/setup.ts`, `tests/tickets/**`, `tests/produtos/03-chamado.test.ts`, `tests/core/ticket-messages/**`.
**Arquivos dono (front):** `utils/api.ts`, `utils/hal.ts` (novo), `app/(dashboard)/{aluno,admin}/chamados/**`, `{aluno,admin}/home/**`, `admin/mensagens/**`.

#### Rotas

| Hoje (✅) | Proposta |
|---|---|
| `GET /tickets/stats` | `GET /ticket-stats` |
| `GET /tickets`, `POST /tickets` | igual (lista paginada HAL; `POST` → `201`+`Location`) |
| `GET/PATCH/DELETE /tickets/:id` | igual (`DELETE` → **`204`**, hoje devolve `200` com o chamado) |
| `POST/GET /tickets/:id/mensagens` | `/tickets/:id/messages` |

#### Passos

**A — Levantamento (durante a Fase 1)**
1. Liste os campos de `Chamado` em `prisma/schema.prisma` e o `select` atual de cada resposta.
2. Confirme **S1** (`senhaHash` via `include`) com um teste; troque por `select` explícito.
3. Leia `messages.controller.ts` e confirme se o aluno só lê/escreve mensagens dos **próprios** chamados (a regra anti-IDOR `alunoSemAcessoAoChamado` existe; ❓ confirme que as rotas de mensagem a usam).
4. Decida D1, D2, D7, D10 com o grupo.

**B — Núcleo (Fase 1)**
5. Crie `src/hateoas/**` seguindo a **especificação da seção 9.1** (peça ao Claude para gerar e exija os testes listados lá). **Mudanças em `src/hateoas` só por você**; os outros apenas usam.
6. Em `app.ts`: registrar o handler (`registerProblemHandler`), CORS com `exposedHeaders: ['Location']`, `GET /api`. O `GET /api` devolve `entryLinks(viewer)` por papel (links de entrada: `tickets`, `users`, `notifications`, `sessions`...). Exporte `entryLinks` para o Rodrigo reutilizar em `/users/me`.
7. **Atenção front:** o `next.config.mjs` faz proxy de `/:path*` para o backend (✅) e o `middleware.ts` **exclui** caminhos que começam com `api` do matcher (✅). Isso tende a deixar `/api` passar direto para o backend; ❓ **teste no ambiente de deploy**.
8. Publique o contrato (tipos e assinaturas) cedo para os outros começarem em paralelo.

**C — `tickets` (módulo-modelo)**
9. Máquina de estados em **uma função pura** (`allowedTransitions(ticket, viewer)`, baseada na matriz da seção 6.2). O **service** usa a mesma função para responder `409` em transição inválida; o **builder** usa para os links. Regra em um lugar só.
10. Fechar **S5/S6**: no `PATCH`, aluno só muda status por transição permitida; aluno **não** altera `responsavelId`/`prioridade`/SLA (retorne `403`). Mensagem e anexo em `ENCERRADO` → `409` (ou `422`, decidam).
11. Refatore `buildWhere` (complexidade 22 → ≤15), por exemplo uma lista de "filtros opcionais" aplicada com um laço.
12. `GET /tickets/:id` incorpora `_embedded` de mensagens/histórico (hoje retorna `mensagens` e `historico` embutidos) com autor via `select` seguro.
13. Links do chamado: `self`, `collection`, `messages`, `attachments`, `reply`/`upload` (se não `ENCERRADO` e dono ou staff), `update` (staff e não `ENCERRADO`), `transition[]` (um por transição permitida). Exporte `canInteractWithTicket(ticket, viewer)` para o Guilherme usar no anexo.

**D — `ticket-messages`**
14. Coleção `_embedded.messages` (hoje a chave é `mensagens`), com `page`. `POST` → `201`+`Location`. Item com `self`.

**E — Front**
15. `utils/hal.ts`: `hasLink(resource, rel)`, `getLink`, `followLink(resource, rel, init?)` (usa `href` e `method` do link) e leitor de `_embedded`. `apiFetch` passa a entender `application/problem+json` (hoje `extractApiError` só olha `issues`/`error`/`message`).
16. Páginas de chamado: troque os **79 testes de papel/status espalhados em 18 arquivos** por `hasLink`. O `middleware.ts` pode manter o guard de rota por papel; botões e menus passam a vir dos links.
17. O WebSocket (`/ws`, usado em `admin/chamados/[id]/page.tsx`) **não é REST**: documente como exceção e adapte o payload das mensagens ao novo formato.

**Lint do seu módulo (✅ medido):** `any`: tickets 15 + ticket-messages 7 + app.ts 7. Achados: `tickets.service.ts:28` (complexidade 22), `app.ts:170` (complexidade 16), `app.ts:267` (TODO), `tickets.controller.ts:3` (import `sendUnauthorized` morto). Front: `aluno/chamados/[id]/page.tsx:135` (complexidade 17) e `:122` (comparação de tipos), `admin/chamados/[id]/page.tsx:128` (variável `err` morta), `admin/mensagens/page.tsx:56` (`loadingMe` morta), `admin/home/page.tsx:104` (deps do hook).

**Testes:** refaça `03-chamado.test.ts` e os de `tickets`/`ticket-messages`. Cubra a matriz estado×papel inteira (seção 6.2): para cada célula, o link existe se e somente se a ação é permitida.

---

### 7.2 Rodrigo — `auth` + handler de erros + telas públicas + `/users/me`

**Arquivos dono (back):** `src/core/auth/**`, **novo** `src/core/sessions/**` (rotas `/users/me` e `/users/me/password`, para **não** editar o `users.routes.ts` do Andrey), `src/middlewares/errorHandler.ts`, `src/utils/http.ts`, `src/utils/zod-helpers.ts`, `src/utils/zod-to-json.ts`, `src/plugins/auth-verify.ts`, `src/plugins/rateLimit.ts`, `src/security/**`, `tests/produtos/01-auth.test.ts`, `tests/produtos/06-trocar-senha.test.ts`, `tests/utils/jwt.test.ts`, `tests/utils/crypto.test.ts`.
**Arquivos dono (front):** `app/(public)/**`, `middleware.ts`, `utils/auth.ts`, `utils/session.ts` (novo), `app/(dashboard)/aluno/dados/**`.

#### Rotas (✅ hoje → proposta; as 10 rotas do módulo)

| Hoje | Proposta | Notas |
|---|---|---|
| `POST /auth/login` | `POST /sessions` | `201`. Corpo: `{ user, accessToken, refreshToken }` + `_links`. Mantenha o lockout (`loginAttempts`/`lockedUntil`) e a auditoria; leia `auth.controller.ts` ~linhas 181-300 antes |
| `POST /auth/refresh` | `POST /tokens` | rotação de refresh já existe (`rotateSession`) |
| `POST /auth/logout` | `DELETE /sessions/current` | `204`. Revoga com `revogadaEm`. Precisa de **D5** |
| `POST /auth/register` | **D3** | não pode conflitar com `POST /users` do admin |
| `POST /auth/primeiro-acesso` | `PUT /account-activations/:token` | token sai do corpo e vai para o path |
| `POST /auth/esqueci-senha` | `POST /password-resets` | `202` **sempre**, sem revelar se o e-mail existe (❓ confira o comportamento atual em `enviarLinkEsqueciSenha`) |
| `POST /auth/reset-senha` | `PUT /password-resets/:token` | |
| `GET /auth/me` | `GET /users/me` | recurso HAL com `entryLinks(viewer)` |
| `POST /auth/trocar-senha` | `PUT /users/me/password` | `204` |
| `GET /auth/usuarios` | **remover** (D11) | |

Rota estática `/users/me` convive com `/users/:id` no Fastify (segmento estático tem prioridade) ✅, mesmo registrada por plugins diferentes.

#### Passos

**A — Levantamento**
1. Leia `auth.controller.ts` e anote cada `res.code(...)`; mapeie para `ApiError` (`400/401/403/404/409/422/429`).
2. Rode `pnpm exec eslint src/core/auth -f unix` e liste o que é seu.

**B — Erros RFC 7807 (D8, Fase 1b)**
3. Substitua `registerErrorHandler` por `registerProblemHandler` (spec na seção 9.1). Hoje o handler existe (✅ `middlewares/errorHandler.ts`, registrado em `app.ts:91`), **mas** `auth-verify.ts`, `sendNotFound`, `sendReply` e os `catch` respondem direto e o **ignoram**: o RFC 7807 só vale quando todos passarem por ele.
4. `utils/http.ts`: reescreva `sendNotFound` etc. como `throw new ApiError(...)`. Corrija a inconsistência de gênero do texto (quebra 3 testes de notificação).
5. `auth-verify.ts`: `401`/`403` como `ApiError("unauthorized"|"forbidden", ...)`.
6. `zod-helpers.ts:20`: o ternário aninhado (2 achados) vira função `formatZodError` usando `fieldErrorsFromZod` (spec na seção 9.1).
7. Avise os donos de módulo quando o handler estiver integrado, para eles apagarem os `catch → 500` deles.

**C — Auth**
8. Corrigir **S3** (sem `debug: e.message`), **S4** (aplicar `authRateLimit` em `POST /sessions`, `/password-resets`, `/account-activations`; definir `trustProxy` corretamente), **S9** (um único `zStrongPassword` reutilizado nos três schemas; some a duplicação).
9. `D5`: adicione `sid` ao access token (`utils/jwt.ts`, assinatura de `generateAccessToken`) e use no `DELETE /sessions/current`.
10. `POST /sessions` → `201` com `Location: /sessions/current` ⚠️ (a "sessão corrente" não tem id público; confirme o formato com o grupo).
11. **S11:** redigir `:token` nos logs (serializer do Fastify).
12. `GET /users/me`: use `userPublicSelect` (✅ já é usado em `me`) + `entryLinks(viewer)` + links `update`, `password`, `session`.
13. `PUT /users/me/password` e reset: ao trocar a senha, revogar sessões (o código já revoga com `revogadaEm`, ~linhas 578-579; ⚠️ confirme em qual fluxo).

**D — Front**
14. Telas: `login`, `esqueci-senha`, `reset-senha` (token vem da query string → vai para o path), `primeiro-acesso`, e `aluno/dados` (me + troca de senha).
15. `utils/session.ts`: mova a lógica de refresh que hoje está em `utils/api.ts` (guarda `refreshToken` no `localStorage`, ✅). Avalie manter só o cookie `httpOnly` (**S10**).
16. `middleware.ts:28` (complexidade 19): extrair verificação de token e decisão de redirect em funções.
17. O `middleware.ts` verifica o JWT com `JWT_ACCESS_SECRET` **no front** ✅ (o segredo de assinatura está no ambiente do Next). Anote como risco; não mude agora.

**Lint do seu módulo (✅):** `any`: auth 19 + security 1 + utils 3 (+ parte de `plugins`). Achados: `auth.controller.ts:47,49` (`[0-9]` → `\d`), `auth.routes.ts:53` (`no-hardcoded-passwords`: é a constante `EXAMPLE_STRONG_PASSWORD = "NovaSenha1#"` do Swagger, ⚠️ provável falso positivo; renomeie ou marque como falso positivo com justificativa), `zod-to-json.ts:2` (import `z` morto), `auth.controller.ts:60` (bloco vazio), testes: `jwt.test.ts` (7 achados, `token1` morto + imports), `crypto.test.ts:3`, `01-auth.test.ts:116` (senha de teste). Front: `LoginContent.tsx:67` (regex super-linear), `:97` (template aninhado), `PrimeiroAcessoContent.tsx:64` (regex), `aluno/dados/page.tsx:99` (**complexidade 35**) e `:162` (regex).

**Testes:** login ok/falha/bloqueio, refresh com rotação, logout, reset/ativação, `GET /users/me` com links por papel, e `429` no limite.

---

### 7.3 Otávio — `setores` + `usuario-setor` + `notifications`

**Arquivos dono (back):** `src/core/setores/**`, `src/core/usuario-setor/**`, `src/core/notifications/**`, `tests/core/setores/**`, `tests/core/usuarioSetor/**`, `tests/core/notifications/**`.
**Arquivos dono (front):** `app/(dashboard)/admin/setores/**`, `{aluno,admin}/notificacoes/**`, `aluno/_components/AlunoTopbar.tsx`, `admin/_components/SistemaTopbar.tsx`, `app/components/shared/NotificationIcon.tsx`.

#### Rotas

| Hoje (✅) | Proposta |
|---|---|
| `POST/GET /admin/setores`, `GET/PATCH/DELETE /admin/setores/:id` | `/admin/sectors` (`DELETE` → `204`) |
| `POST/GET /admin/usuarios/:usuarioId/setores` | `/admin/users/:id/sectors` |
| `GET /admin/setores/:setorId/usuarios` | `/admin/sectors/:id/users` (⚠️ **faltava no mapa das convenções**; o front usa) |
| `PATCH/DELETE /admin/usuarios-setores/:usuarioSetorId` | `/admin/user-sectors/:id` |
| `GET /notifications` | igual (HAL + `page`/`size`) |
| `PATCH /notifications/:id/lida`, `POST …/archive`, `POST …/unarchive` | `PATCH /notifications/:id` com `{ "lida": bool }` / `{ "arquivada": bool }` |
| `POST /notifications/read-all` | `PATCH /notifications` com `{ "lida": true }` |
| `POST /notifications/test` | D9 |

#### Passos

**A — Levantamento**
1. Campos de `Notificacao` (✅): `id, usuarioId, titulo, mensagem, tipo, canal, criadoEm, lidaEm, arquivadaEm, erroEntrega, meta, organizacaoId, chamadoId, mensagemId, anexoId`. No banco **não** existe `lida`/`arquivada` booleano: são **datas** (`lidaEm`, `arquivadaEm`). O PATCH mapeia `true → now()`, `false → null`.
2. Hoje `markAsRead` também desarquiva (⚠️ confirme em `notifications.service.ts`). Decida se o PATCH mantém essa regra.
3. Liste `authorize([...])` de cada rota de setor/vínculo.

**B — Notificações**
4. **S7:** `apenasNaoLidas: z.coerce.boolean()` é bug. Troque por `z.enum(["true","false"]).transform(v => v === "true")` (ou `z.stringbool` se a versão do zod permitir; ❓ o projeto usa `zod ^3.25`).
5. Paginação: hoje `pageSize` máx. **1000** e padrão 50. Passe para `size` com máx. 100 (D1).
6. PATCH individual e em lote (`PATCH /notifications` marca **todas do usuário logado**; `204`, ou `200` com a contagem).
7. Links por item: `self`; `mark-read` só se `lidaEm == null`; `mark-unread` só se lida; `archive` só se não arquivada; `unarchive` só se arquivada; `ticket` (`/tickets/:id`) só se `chamadoId` existir **e** o usuário puder ver o chamado. Coleção: `mark-all-read` só se houver não lidas.
8. Escopo: o usuário só enxerga **as próprias** notificações (✅ `listNotifications(prisma, userId, …)`); mantenha em todas as rotas.
9. `notifications.controller.ts:3` (import `sendUnauthorized` morto) some quando migrar para `ApiError`.

**C — Setores e vínculos**
10. Coleção de setores (hoje `{data,total,page,perPage}` ✅) → HAL. Links: `self`, `collection`, `update`/`delete` (admin; use a constante de papéis), `users` (`/admin/sectors/:id/users`).
11. Vínculo usuário-setor: `POST` → `201`+`Location`; **conflito** (hoje `P2002` → 409 num `try/catch` no service) vira `ApiError("conflict")` e o handler cuida.
12. `usuarioSetor.service.ts` usa `instanceof Prisma.PrismaClientKnownRequestError`; o `normalizeError` do núcleo (seção 9.1) já trata `code === "P2002"/"P2025"`, então o `try/catch` some.

**D — Front**
13. Setores e notificações (admin e aluno) usam `hasLink`. O sino de notificação (`SistemaTopbar`/`AlunoTopbar`) busca "não lidas" com `apenasNaoLidas`: corrija junto com **S7**.
14. `SistemaTopbar.tsx:14` (**complexidade 24**), `:98,107,154` (ternários aninhados) e `:95` (deps do hook); `AlunoTopbar.tsx:16` (19). Extraia subcomponentes (ex.: `NotificationBell`) e funções de formatação.

**Lint do seu módulo (✅):** `any`: usuario-setor 6 + notifications 5 + setores 3. Front: `admin/setores` 8 `any`, `admin/notificacoes/page.tsx:71` (`unread` morta), `NotificationIcon.tsx:2` (import `Check` morto), `setores.controller.test.ts:5,6` (imports `list`, `patch` mortos).

**Testes:** matriz de links de notificação (lida/não lida, arquivada/não), escopo por usuário, `PATCH` em lote, `409` no vínculo duplicado, `404` em setor inexistente. Os 3 testes que falham no `notifications.controller` são de texto de erro e **serão reescritos**.

---

### 7.4 Guilherme — `anexos` + `auditoria` + `sugestoes` + `catalogo`

**Arquivos dono (back):** `src/core/anexos/**`, `src/core/auditoria/**`, `src/core/sugestoes/**`, `src/core/catalogo/**`, `tests/core/anexos/**`, `tests/core/auditoria/**`.
**Arquivos dono (front):** `app/(dashboard)/admin/relatorios/**`, `aluno/catalogo/**`, `app/catalogo/route.ts`, `utils/catalogo.ts`, `tests/catalogo.test.ts`, `utils/attachments.ts` (novo), `AnexosPanel.tsx` (novo; o Matheus importa).

#### Rotas

| Hoje (✅) | Proposta |
|---|---|
| `GET/POST /tickets/:id/anexos` | `/tickets/:id/attachments` |
| `GET /anexos/:anexoId/download` | `GET /attachments/:id/content` |
| `POST /anexos/:anexoId/download-token` | **D6** (remover, ou `POST /attachments/:id/download-tokens`) |
| `GET /auditoria`, `/auditoria/usuario/:id`, `/auditoria/periodo`, `POST /auditoria` | `GET /admin/audit-logs?userId=&from=&to=` (e `POST`: D9, ❓ **quem pode?**) |
| `POST/GET /sugestoes`, `GET /sugestoes/:id`, `PATCH /sugestoes/:id` | `/suggestions` |
| `GET /catalogo` | `GET /catalog` (D4) |

#### Passos

**A — Levantamento**
1. **Sugestões:** o front **não chama** `/sugestoes` (✅ grep). O que existe em `aluno/catalogo/outros` é um recomendador **local** (`sugerirServicos`), sem relação. Portanto: **não há tela de sugestões para adaptar**; só o backend (ou crie a tela se o grupo quiser).
2. **Auditoria:** o único uso no front é um texto estático em `admin/configuracoes/page.tsx:130`. ❓ Descubra quais rotas `admin/relatorios` consome (o grep achou `GET /tickets?pageSize=100&include=setor,responsavel`).
3. Confirme em `auditoria.routes.ts` quais papéis acessam e se `POST /auditoria` deveria existir publicamente.

**B — Anexos**
4. Lista por chamado (`GET`) → coleção HAL com `content` por item. Upload (`POST`, multipart) → `201`+`Location: /attachments/:id`.
5. Link `upload` na coleção **só** se o chamado aceita interação: use `canInteractWithTicket` exportado pelo Matheus (dependência! combine o nome antes).
6. **S8:** `Content-Disposition` com `filename*=UTF-8''${encodeURIComponent(nome)}` e `filename` ASCII sanitizado.
7. **D6:** remova `generateDownloadTokenRoute`/rota e o token, ou implemente o consumo (`GET …/content?token=`) com `verifyDownloadToken` + teste.
8. Mantenha `getAnexoForDownload(prisma, anexoId, userId, role)` (regra de acesso) e **teste IDOR**: aluno não baixa anexo de chamado de outro aluno.
9. Os 3 testes de `anexos.routes.test.ts` que falharam no meu ambiente verificam o **registro de rotas** (métodos/paths). Eles serão reescritos; ❓ investigue a causa se continuar falhando.

**C — Sugestões**
10. `responderSugestao` já distingue `NOT_FOUND` e `LOCKED` (✅): mapeie para `404` e **`409`**.
11. Links: `answer` (`PATCH /suggestions/:id`) **só** para `BACKOFFICE/TECNICO/ADMINISTRADOR` **e** status `NAO_RESPONDIDO`. Depois de `RESPONDIDO` não há mais link (a resposta é imutável ✅).

**D — Auditoria e catálogo**
12. Auditoria hoje devolve **array puro**: vira coleção HAL com `size` máx. 100; filtros `userId`, `from`, `to` preservados nos links.
13. Catálogo: `GET /catalogo` devolve `{ categorias }` (✅). Decida D4 e remova a duplicidade (rota local do Next vs API).

**E — Front**
14. Mova `downloadAnexo` e `fetchAnexoImageUrl` (hoje em `utils/api.ts`) para `utils/attachments.ts`, **depois** que o Matheus mergear o cliente HAL. Entregue `AnexosPanel.tsx` (lista, upload, baixar) com `hasLink`.
15. `admin/relatorios/page.tsx`: `any` ×8; `:534,561` ternários aninhados; ❓ ordenação sem comparador (`:135`, regra com tipos).
16. `aluno/catalogo/outros/page.tsx:51` (**complexidade 22**) e `:95` (`.sort()` que muta o array antes do `.slice`).

**Lint do seu módulo (✅):** `any`: auditoria 9 + anexos 8 + sugestoes 3 + catalogo 1; `auditoria.controller.test.ts:3` (import `log` morto). Front: `utils/catalogo.ts` 3 `any`, `tests/catalogo.test.ts` 3 `any`.

**Testes:** acesso por papel/dono nos anexos, `409` em sugestão já respondida, filtros da auditoria e paginação.

---

### 7.5 Andrey — **qualidade/Sonar (Fase 0)** + `papeis` + `users` + `comunicacoes`

**Arquivos dono (back):** `package.json`, `pnpm-lock.yaml`, `eslint.config.js`, `vitest.config.ts`, `sonar-project.properties`, `.github/**`, `src/core/papeis/**`, `src/core/users/**`, `src/core/comunicacoes/**`, `src/lib/**`, `src/config/**`, `src/types/**`, `tests/users/**`, `tests/core/papeis/**`, `jest.setup.ts`.
**Arquivos dono (front):** `eslint.config.mjs`, `package.json`, `app/(dashboard)/admin/{alunos,funcionarios,comunicacoes}/**`, `admin/_components/{FormAlunoCreate,FormFuncionarioCreate,ImportAlunos}.tsx`, `app/components/ui/**`, `app/page.tsx`.

#### Fase 0 — Configuração de qualidade (**faça primeiro**, antes dos outros rebaserem; receita na seção 9.2)

1. Back: crie o `eslint.config.js` conforme a seção 9.2 e instale `eslint-plugin-sonarjs@^4.2.2`, `typescript-eslint@^8.71`, `@eslint/js@^9.37` (**não** a `^10`), `globals`. ✅ validado: com isso o `pnpm lint` passa a reportar os 177 achados.
2. `vitest.config.ts`: `reporter: ['text-summary','lcov']`, `reportsDirectory`, `reportOnFailure: true`. Troque `include` para `src/**/*.ts` (número honesto). Atenção: `server.ts` fica excluído.
3. `sonar-project.properties` e workflow `.github/workflows/sonar.yml` (receita na seção 9.2). ❓ **Não validados** (o scanner e o Actions não rodam no meu ambiente): ajuste `projectKey`, secrets (`SONAR_TOKEN`, `SONAR_HOST_URL`) e confirme a versão da action. Na documentação da Sonar, `sonar.javascript.lcov.reportPaths` serve para JS **e** TS. O CI atual só roda em `main`; o workflow novo roda em `main` e `Fiat-Uno`.
4. **Decisão de política (💡):** com `no-explicit-any` como **erro**, o CI falha com os 125 `any` atuais. Sugestão: deixar como `warn` até a Fase 3, trocar para `error` ao integrar. Combine com o grupo.
5. Front: no `eslint.config.mjs` existente, adicione `sonarjs.configs.recommended` e instale `eslint-plugin-sonarjs`. ✅ validado: 129 erros + 27 avisos hoje.
6. ❓ Verifique se `jest.config.js`, `jest.setup.ts` e a dependência `ts-jest` ainda são usados (o projeto roda **Vitest**). Se não, apague (o lint acusa `jest.setup.ts`).
7. Rode `pnpm install` e **avise o grupo** para rebasear (lockfile muda).

#### Rotas do seu módulo

| Hoje (✅) | Proposta |
|---|---|
| `POST/GET /usuarios`, `GET/PATCH/DELETE /usuarios/:id` | `/users`, `/users/:id` (`DELETE` → `204`) |
| `/admin/papeis` (`GET/POST`, `GET/PATCH/DELETE /:id`) | `/admin/roles` |
| `GET /admin/comunicacoes`, `PUT /admin/comunicacoes/:chave`, `POST /admin/comunicacoes/teste` | `/admin/communication-templates`, `PUT …/:chave`, e o teste como recurso (`POST /admin/communication-tests`; D9) |

#### Passos

**A — Levantamento**
1. `users`: lista hoje `{items, page, perPage, total, pages}` com `perPage` máx. 100 e padrão 20, filtro `q` (✅ validators); passe para `size` (D1).
2. **Regra de dono no `PATCH`:** o papel `USUARIO` está autorizado e `users.controller.ts:83-117` aplica a regra (⚠️ releia antes de montar o link `update`). **Link `update` só se o usuário puder de fato**; **nunca** link para alterar `role` se quem edita não é admin (e valide no back).
3. `papeis`: hoje é **array puro** (✅). Leia `schema.prisma` para saber se é tabela ou o enum `Papel` (4 valores); isso muda se `POST/PATCH/DELETE` fazem sentido.
4. `comunicacoes`: modelo por `chave` (1..64 chars). `PUT` é idempotente: criação → `201`, atualização → `200` (decida e documente).

**B — Implementação**
5. `POST /users` **só ADMINISTRADOR** (D3): resolve o conflito com `register`. `201`+`Location: /users/:id`.
6. Respostas de usuário sempre com `select` público (`userPublicSelect`); **nunca** `senhaHash`, `loginAttempts`, `lockedUntil`.
7. Links de usuário: `self`, `collection` (staff), `update` (dono ou admin, conforme regra), `delete` (admin), `sectors` (`/admin/users/:id/sectors`, admin).
8. `papeis`/`comunicacoes`: coleções HAL; links `update`/`delete` só para admin; `communication-tests` só para quem pode enviar.
9. `users.service.ts:11` (import `env` morto) e demais `any` (users 20, papeis 3).

**C — Front**
10. `admin/alunos`, `admin/funcionarios`, `admin/comunicacoes` com `hasLink`. Corrija a paginação das telas (`size`, base 0).
11. `FormAlunoCreate.tsx:45` (complexidade 17) e `:86` (regex super-linear), `FormFuncionarioCreate.tsx:59` (regex), `ImportAlunos.tsx:154` (**complexidade 31**). Extraia parsing/validação de CSV para funções puras testáveis.
12. `comunicacoes/page.tsx:241` (`returnValue` depreciado, use `e.preventDefault()` e retorne string só onde preciso), `:372` (exceção ignorada), `any` ×6.
13. `app/components/ui/CookieBanner.tsx:20` (atribuição dentro de expressão), `Button.tsx`, `ConfirmDialog.tsx`, `app/page.tsx`.

**Lint do seu módulo (✅):** `any`: users 20 + papeis 3 (+ lib 4, types 2, config 1). Front: `admin/alunos` (5 `any`, 8 Sonar), `funcionarios` (3, 2), `comunicacoes` (6, 3), `admin/alunos/[id]/page.tsx` (imports mortos `XCircle`, `Check`, `MessageCircle`, `Building2`, `BookOpen`; `:342` ternário aninhado). Testes: `papeis.controller.test.ts:150,235` (títulos de teste duplicados), `tests/setup.ts:16` (diretório gravável público: revise se usa `/tmp`).

---

## 8. Mapa de rotas completo: hoje → proposta

(inclui as rotas que **faltavam** no mapa das convenções)

| Hoje (✅ lido no código) | Proposta | Dono |
|---|---|---|
| — | `GET /api` (raiz, links por papel) | Matheus |
| `GET /health` | igual (exceção, infraestrutura) | Matheus |
| `GET /ws` (WebSocket) | igual (exceção, não REST) | Matheus |
| `POST /auth/login` | `POST /sessions` | Rodrigo |
| `POST /auth/logout` | `DELETE /sessions/current` | Rodrigo |
| `POST /auth/refresh` | `POST /tokens` | Rodrigo |
| `POST /auth/register` | D3 | Rodrigo+Andrey |
| `POST /auth/primeiro-acesso` | `PUT /account-activations/:token` | Rodrigo |
| `POST /auth/esqueci-senha` | `POST /password-resets` | Rodrigo |
| `POST /auth/reset-senha` | `PUT /password-resets/:token` | Rodrigo |
| `GET /auth/me` | `GET /users/me` | Rodrigo |
| `POST /auth/trocar-senha` | `PUT /users/me/password` | Rodrigo |
| `GET /auth/usuarios` | remover (D11) | Rodrigo |
| `POST/GET /usuarios`, `GET/PATCH/DELETE /usuarios/:id` | `/users`, `/users/:id` | Andrey |
| `GET /tickets/stats` | `GET /ticket-stats` | Matheus |
| `GET/POST /tickets`, `GET/PATCH/DELETE /tickets/:id` | igual | Matheus |
| `POST/GET /tickets/:id/mensagens` | `/tickets/:id/messages` | Matheus |
| `GET/POST /tickets/:id/anexos` | `/tickets/:id/attachments` | Guilherme |
| `GET /anexos/:anexoId/download` | `GET /attachments/:id/content` | Guilherme |
| `POST /anexos/:anexoId/download-token` | D6 | Guilherme |
| `GET /catalogo` | `GET /catalog` (D4) | Guilherme |
| `POST/GET /sugestoes`, `GET/PATCH /sugestoes/:id` | `/suggestions` | Guilherme |
| `GET /auditoria`, `/auditoria/usuario/:id`, `/auditoria/periodo`, `POST /auditoria` | `/admin/audit-logs?userId=&from=&to=` (D9) | Guilherme |
| `/admin/setores…` | `/admin/sectors…` | Otávio |
| `POST/GET /admin/usuarios/:id/setores` | `/admin/users/:id/sectors` | Otávio |
| `GET /admin/setores/:setorId/usuarios` | `/admin/sectors/:id/users` | Otávio |
| `PATCH/DELETE /admin/usuarios-setores/:id` | `/admin/user-sectors/:id` | Otávio |
| `GET /notifications` | igual | Otávio |
| `PATCH /notifications/:id/lida`, `POST …/archive`, `POST …/unarchive` | `PATCH /notifications/:id` | Otávio |
| `POST /notifications/read-all` | `PATCH /notifications` | Otávio |
| `POST /notifications/test` | D9 | Otávio |
| `/admin/papeis…` | `/admin/roles…` | Andrey |
| `GET /admin/comunicacoes`, `PUT /admin/comunicacoes/:chave`, `POST /admin/comunicacoes/teste` | `/admin/communication-templates…` / D9 | Andrey |

---

## 9. Especificações (para pedir ao Claude gerar o código)

Não há arquivos prontos para baixar: cada dono pede ao Claude para gerar o código a partir das especificações abaixo. **Eu testei uma implementação com estas regras** (compilou, 21 testes passaram, 0 achados ESLint+SonarJS), mas ela não faz parte desta entrega. Por isso, ao gerar, exija os testes listados.

### 9.1 Núcleo `src/hateoas` (Matheus)

**Arquivos:** `types.ts`, `links.ts`, `resource.ts`, `pagination.ts`, `problem.ts`, `index.ts`. Sem `any`; sem dependência de Prisma (o tipo de papel é uma união de strings).

**Tipos**
- `HttpMethod` = `GET|POST|PUT|PATCH|DELETE`; `Role` = `USUARIO|BACKOFFICE|TECNICO|ADMINISTRADOR`.
- `Link { href; method?; title?; name? }`; `Links = Record<string, Link | readonly Link[]>`.
- `Viewer { id; role }`; `Resource<T> = T & { _links }`.
- `PageInfo { size; number; totalElements; totalPages }`; `Collection<T> { _embedded: Record<string, Resource<T>[]>; page; _links }`.

**`links.ts`**
- `isStaff(viewer)` (BACKOFFICE/TECNICO/ADMINISTRADOR) e `isAdmin(viewer)`.
- Template tag `path` que aplica `encodeURIComponent` em cada valor interpolado: uma chamada como ``path`/tickets/${id}/messages` ``. Exemplo: `a/b?c` vira `a%2Fb%3Fc`.
- `link(href, method = "GET", { title?, name? })`.
- `buildLinks(entries)` recebe `Record<string, Link | Link[] | false | null | undefined>` e **descarta** `false`, `null`, `undefined` e arrays vazios. É o ponto central de "só entra o link que estado e papel permitem".

**`pagination.ts`** (D1)
- `PaginationQuerySchema` (zod): `page` inteiro ≥ 0, padrão 0; `size` inteiro 1..100, padrão 20; ambos com `z.coerce.number()`.
- `toSkipTake({page,size})` → `{ skip: page*size, take: size }`.
- `withQuery(basePath, params)`: chaves em ordem alfabética, ignora `undefined` e string vazia.
- `pageInfo(page,size,total)`: `totalPages = ceil(total/size)`.
- `paginationLinks`: `self` e `first` sempre; `last` sempre (página `0` se a coleção está vazia); `prev` só se `page > 0` (aponta para `min(page-1, última)`); `next` só se `page < última`. Os filtros da query são preservados.
- `toCollection({ rel, basePath, items, page, size, total, filters?, links? })` → `{ _embedded: { [rel]: items }, page, _links }`, mesclando `links` extras (ex.: `create`, só se o usuário puder criar).

**`problem.ts`** (RFC 7807, D8)
- `Content-Type: application/problem+json`.
- `ApiError(kind, title, detail?, errors?)`. `kind` → status: `bad-request` 400, `unauthorized` 401, `forbidden` 403, `not-found` 404, `conflict` 409, `unprocessable` 422, `too-many-requests` 429, `internal` 500. `type` do problem = `/errors/<kind>`.
- `normalizeError(unknown)`: `ApiError` passa direto; erro com `validation` (Fastify) → 400 com `errors[{field,message}]` (`/body/email` vira `body.email`); `code === "P2025"` → 404; `code === "P2002"` → 409; `statusCode` 400/401/403/404/409/422/429 → o `kind` correspondente; **qualquer outra coisa → 500 genérico, sem repassar a mensagem original** (hoje vários `catch` vazam `e.message`).
- `fieldErrorsFromZod(issues)`: `path` unido por ponto.
- `sendProblem(reply, request, apiError)`: `instance` = caminho da requisição sem a query string.
- `registerProblemHandler(app)`: `setErrorHandler` (loga só 5xx) e `setNotFoundHandler` (404 problem+json). Substitui `registerErrorHandler`.
- Limitação conhecida: erros 4xx do Fastify sem mapeamento (ex.: 413) cairiam em 500. Ajuste se necessário.

**Testes obrigatórios (vitest)**
- `path` codifica e impede path traversal; `buildLinks` descarta os 4 casos.
- Paginação: defaults, limite 100, `page=-1` inválido, `size=101` inválido, 1ª página (sem `prev`), última (sem `next`), coleção vazia, página única, página além do fim, filtros preservados.
- Problem: formato das convenções (seção 6), 5xx não vaza mensagem, `P2025`/`P2002`, validação do Fastify, 429.
- **Links do chamado por papel e estado** (matriz da seção 6.2): `self` e `collection` sempre; `ENCERRADO` sem `reply`/`upload`/`update`/`transition` para ninguém; aluno dono em `RESOLVIDO` com `transition` para `EM_ATENDIMENTO` e `ENCERRADO`; aluno que não é dono sem nenhum link de ação; staff com `update` e as transições do estado; `href` relativo e codificado.

### 9.2 Receita de qualidade (Andrey)

**Back — `eslint.config.js`** (flat config, CommonJS; ✅ esta composição rodou no repositório):
1. `ignores`: `node_modules`, `dist`, `coverage`, `docs`, `prisma`, `uploads`.
2. `@eslint/js` recommended + `typescript-eslint` recommended + **`sonarjs.configs.recommended`** (todas as regras do SonarJS).
3. Para `src/**/*.ts`: `parserOptions: { projectService: true, tsconfigRootDir: __dirname }` (habilita as regras que dependem de tipos).
4. Para `**/*.js` (arquivos CommonJS soltos): `sourceType: "commonjs"`, globals de Node (pacote `globals`) e `@typescript-eslint/no-require-imports` desligada. Sem isso aparecem ~17 erros `no-undef` falsos.
5. Para `tests/**/*.ts`: desligar `sonarjs/no-duplicate-string` e `no-explicit-any`.
6. Dependências de desenvolvimento: `eslint-plugin-sonarjs@^4.2.2`, `typescript-eslint@^8.71`, `@eslint/js@^9.37` (**não** a `^10`, que conflita com o ESLint 9 do projeto), `globals`.

**Back — cobertura (`vitest.config.ts`)**: `coverage.provider: 'v8'`, `reporter: ['text-summary','lcov']`, `reportsDirectory: './coverage'`, `reportOnFailure: true`, `include: ['src/**/*.ts']`, `exclude: ['src/**/*.d.ts','src/server.ts']`. ✅ Com `reporter: lcov` o arquivo `coverage/lcov.info` foi gerado (57 arquivos na medição atual).

**Front — `eslint.config.mjs`**: importar `eslint-plugin-sonarjs` e acrescentar `sonarjs.configs.recommended` depois do `compat.extends("next/core-web-vitals", "next/typescript")`. ✅ rodou no repositório: 129 erros + 27 avisos.

**Sonar (❓ não validado, o scanner e o GitHub Actions não rodam no meu ambiente):**
- `sonar-project.properties`: `sonar.projectKey` (ajuste), `sonar.sources=src`, `sonar.tests=tests`, `sonar.test.inclusions=tests/**/*.test.ts`, `sonar.exclusions=**/node_modules/**,dist/**,docs/**,coverage/**,prisma/migrations/**`, `sonar.coverage.exclusions=src/server.ts,src/**/*.d.ts,tests/**` e `sonar.javascript.lcov.reportPaths=coverage/lcov.info` (serve para JS e TS segundo a documentação da Sonar). No front: `sonar.sources=app,utils,middleware.ts`.
- Workflow `.github/workflows/sonar.yml`, em `push` e `pull_request` para `main` e `Fiat-Uno`: `actions/checkout` com `fetch-depth: 0` (o Sonar precisa do histórico para "código novo"), pnpm + Node 22, `pnpm install --frozen-lockfile`, `pnpm prisma:generate`, `pnpm lint`, `pnpm typecheck`, `pnpm exec vitest run --coverage` e o passo `SonarSource/sonarqube-scan-action` (confirme a versão atual na documentação). Secrets: `SONAR_TOKEN` e, se o servidor for próprio, `SONAR_HOST_URL`.
- Hoje o `ci.yml` só roda em `main`.

---

## 10. Fase 3 — Integração e fechamento

1. Merge de todas as branches em `Fiat-Uno`; rode `pnpm install`, `pnpm prisma:generate`, `pnpm lint`, `pnpm typecheck`, `pnpm exec vitest run --coverage`.
2. **Teste de alcance:** partindo de `GET /api` (por papel), siga todos os links `GET` e compare com as rotas registradas (`app.printRoutes()`/hook `onRoute`). Toda rota deve ser alcançável (direta ou por link), exceto as exceções documentadas (`/health`, `/ws`).
3. **Teste de contrato em massa:** para cada papel, percorra todos os links e confirme que nenhum devolve `403`/`405`.
4. Varredura no front: nenhuma URL antiga (`/mensagens`, `/anexos`, `/auth/…`, `/usuarios`), nenhuma regra fixa de papel/status em botão (`grep -rn "role ===\|status ===" app`).
5. Os `any` restantes: trocar `no-explicit-any` para **erro** (decisão da Fase 0).
6. Rodar o Sonar real no servidor de vocês: corrigir *issues* do código novo, revisar *security hotspots*, conferir os 3 critérios do gate (cobertura, duplicação, notas).
7. Swagger completo (schema `Link`, `Problem`, `PageInfo`), README e docs atualizados.
8. Conferir **S1–S11** (seção 4) fechados.

---

## 11. O que NÃO foi verificado (não confie sem checar)

- SonarQube/scanner real e o **quality gate** de vocês.
- `typecheck` e testes completos **com o Prisma client gerado** (o sandbox bloqueou o download do engine). Parte das 10 falhas pode ser do ambiente.
- **S1** (`senhaHash` via `include`) é conclusão por leitura de código, **sem executar contra banco real**.
- Corpo de `register`, comportamento atual de `esqueci-senha` (anti-enumeração), regras exatas de `authorize` de todas as rotas (use `grep -n authorize`), campo de leitura em mensagens (D7), quem acessa `POST /auditoria`.
- Se o proxy do Next entrega `GET /api` ao backend no deploy.
- `sonar.yml` e `sonar-project.properties` (não executados).
- Contagens de `79 verificações em 18 arquivos` do front e `49 ocorrências de code(500)` vêm de `grep` da análise anterior (não refeitas aqui).
