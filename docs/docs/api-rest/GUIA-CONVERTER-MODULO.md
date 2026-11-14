---
sidebar_position: 3
---

# Como converter um módulo para REST nível 3 (HAL)

> Escrito a partir do que foi feito em **`tickets`** e **`ticket-messages`**, que são os módulos-modelo. Para ver um exemplo de cada passo, abra esses dois.
> Leia antes o `CONVENCOES-API.md` (como a API deve ficar). Este guia diz **como chegar lá**.

---

## A página: a ordem de trabalho

| # | Passo | Pronto quando |
|---|---|---|
| 1 | **Levantar.** Liste as rotas atuais do módulo e a rota nova de cada uma (tabela da seção 7 das convenções). Liste os estados e papéis que mudam o que o usuário pode fazer. Liste as telas do front que chamam o módulo. | Você sabe o que muda e quem é afetado |
| 2 | **Regras em funções puras.** Quem pode fazer o quê, em que estado (`can...`). Sem Prisma, sem `req`. | As regras têm teste e um único lugar |
| 3 | **Builder de links.** Usa as regras do passo 2 para montar o `_links`. | Link aparece se, e somente se, a ação é permitida |
| 4 | **Controller.** Valida, confere permissão, devolve recurso HAL ou lança `ApiError`. Sem `try/catch`. | Nenhum erro sai como `{ error }` nem como `500` cru |
| 5 | **Rotas e Swagger.** Rotas novas, status certos, schemas atualizados. | O Swagger descreve o que a API devolve de verdade |
| 6 | **Testes.** Rotas, status, formato HAL, links **presentes e ausentes** por papel e estado, e o teste de contrato. | `pnpm test` verde |
| 7 | **Front.** Troca as regras fixas (`status ===`, `role ===`) por `hasLink`/`followLink`. | Nenhuma URL montada à mão nem regra de papel na tela |
| 8 | **Publicar.** Se o formato mudou, backend e front **juntos**. | O grupo não vê tela quebrada |

---

## O que já existe (não recrie, use)

### Backend: `src/hateoas`

| Para quê | Use |
|---|---|
| Montar uma URL | `` path`/tickets/${id}/messages` `` (codifica o id) |
| Criar um link | `link(href, metodo, { title?, name? })`, com `metodo` sendo `"GET"`, `"POST"`, `"PATCH"`... |
| Montar o `_links` | `buildLinks({ self: link(...), reply: podeResponder && link(...) })`. Valor `false`, `null` ou `undefined` não entra. |
| Recurso | `toResource(dados, links)` |
| Coleção | `toCollection({ rel, basePath, items, page, size, total, filters, links })` |
| Paginação | `PaginationQuerySchema` (page a partir de **0**, size de 1 a 100, padrão 20) + `toSkipTake({ page, size })` |
| Manter filtros nos links `next`/`prev` | `pickFilters(req.query, ["status", ...])` |
| Validar | `parseOrThrow(Schema, { params: req.params, body: req.body, query: req.query })` |
| Quem está chamando | `viewerFrom(req)` (devolve `undefined` sem login) |
| Erro | `throw new ApiError(kind, titulo, detalhe?)` |
| Links de entrada (`GET /api`) | `entryLinks(viewer)` |

Tipos de erro (`kind`) e o status de cada um:

| `kind` | Status | Quando |
|---|---|---|
| `bad-request` | 400 | corpo ou query inválidos (o `parseOrThrow` já lança este) |
| `unauthorized` | 401 | sem login |
| `forbidden` | 403 | não tem permissão |
| `not-found` | 404 | não existe, ou não pode saber que existe |
| `conflict` | 409 | o **estado** atual não permite a ação |
| `unprocessable` | 422 | regra de negócio violada |
| `internal` | 500 | só falha inesperada (o handler global já cuida) |

### Frontend: `utils/hal.ts` e `utils/api.ts`

| Para quê | Use |
|---|---|
| Ler a lista de uma coleção | `embedded<Tipo>(data, "tickets")` |
| Mostrar botão? | `hasLink(recurso, "reply")`, ou com nome: `hasLink(chamado, "transition", "ENCERRADO")` |
| Listar os links de um tipo | `getLinks(recurso, "transition")` |
| Executar uma ação | `await followLink(recurso, "reply", { body: JSON.stringify({ ... }) })` |
| Ler o motivo de um erro | `await extractApiError(res, "mensagem padrão")` |

---

## Receitas

### 1. Um recurso com links

```ts
export function toMessageResource<T extends { id: string }>(message: T, ticketId: string) {
  return toResource(
    message,
    buildLinks({
      self: link(path`/tickets/${ticketId}/messages/${message.id}`),
      collection: link(path`/tickets/${ticketId}/messages`),
      ticket: link(path`/tickets/${ticketId}`),
    }),
  );
}
```

Para links que dependem de estado e papel, o builder pergunta às funções `can...`, e **o controller usa as mesmas funções** para recusar. Assim o link e a regra nunca divergem (veja `ticket-rules.ts` e `tickets.links.ts`).

### 2. Uma coleção

```ts
const { params, query } = parseOrThrow(ListMessagesSchema, { params: req.params, query: req.query });

return res.send(
  toCollection({
    rel: "messages",
    basePath: path`/tickets/${params.id}/messages`,
    items: result.mensagens.map((m) => toMessageResource(m, params.id)),
    page: result.page,
    size: result.size,
    total: result.total,
    filters: pickFilters(req.query, ["orderDir"]),
  }),
);
```

No service: `...toSkipTake({ page, size })` dentro do `findMany`, e `count` com o **mesmo** `where`.

### 3. Criar: `201` + `Location`

```ts
return res
  .header("Location", path`/tickets/${params.id}/messages/${created.id}`)
  .code(201)
  .send(toMessageResource(created, params.id));
```

O `Location` precisa apontar para uma rota que **existe**. Se o recurso não tinha endereço próprio, crie o `GET` dele.

### 4. Erros: o controller só lança

```ts
const viewer = viewerFrom(req);
if (!viewer) throw new ApiError("unauthorized", "Não autenticado");

if (!canInteractWithTicket(ticket, viewer)) {
  throw new ApiError("conflict", "Ação não permitida", "O chamado não aceita novas mensagens.");
}
```

Regra para escolher **403 ou 409** quando uma ação é bloqueada: se o **estado** do recurso é o que impede (chamado encerrado, arquivado, prazo vencido), é `409`. Se falta **permissão** do papel, é `403`. O aluno que não é dono recebe `404`, igual ao recurso inexistente, para não revelar que ele existe.

### 5. Ação que muda estado: `PATCH`, nunca verbo na URL

| Antes | Depois |
|---|---|
| `POST /x/:id/archive` | `PATCH /x/:id` com `{ "arquivado": true }` |
| `POST /x/read-all` | `PATCH /x` com `{ "lida": true }` |
| `DELETE /x/:id` (quando a regra de negócio é "ninguém apaga") | `PATCH` com `arquivado`. Remova a rota `DELETE`. |

O link da ação só aparece quando ela é possível, e o **corpo** que o front manda é o contrato daquele `rel`. Valide só o corpo que faz sentido (`z.literal(true)` quando só existe "marcar").

### 6. Teste: o padrão do projeto

```ts
vi.mock('../../src/lib/prisma')
// ... buildApp(), prismaMock, makeUserToken({ sub, role }), bearerAuth, resetMocks()

const expectProblem = (res, status) => {
  expect(res.statusCode).toBe(status)
  expect(String(res.headers['content-type'])).toContain('application/problem+json')
  expect(res.json()).toMatchObject({ status })
}
```

Todo módulo precisa de testes de:

- **Formato:** o corpo tem `_embedded`/`page`/`_links` (coleção) ou `_links.self` (recurso).
- **Status:** `201` + `Location`, `400`, `401`, `403`, `404`, `409`.
- **Links presentes e ausentes** por papel e estado.
- **Contrato** (`tests/produtos/03b-chamado-contrato.test.ts` é o modelo): para cada papel e estado, todo link devolvido, ao ser seguido, funciona; e toda ação **sem** link é recusada (403 ou 409).

### 7. No front

```ts
// ler
const lista = embedded<Mensagem>(data, "messages");

// mostrar botão só se a API ofereceu
{podeResponder && <button onClick={enviar}>Enviar</button>}   // podeResponder = hasLink(chamado, "reply")

// executar
const res = await followLink(chamado, "reply", { body: JSON.stringify({ conteudo }) });
if (!res.ok) throw new Error(await extractApiError(res, "Erro ao enviar"));
```

Quando uma tela tem várias ações (salvar dados e mudar status), envie **só o que mudou**, uma ação por link. Mandar tudo junto faz a API recusar o que o estado não permite.

---

## Armadilhas que já custaram tempo (13 até agora)

1. **Janela quebrada.** Mudar o formato de uma resposta quebra as telas dos colegas. Faça backend **e** front antes de publicar, ou mantenha a rota antiga como alias até o front trocar. Avise o grupo antes do push.
2. **`include: { usuario: true }` devolve a linha inteira**, inclusive `senhaHash`. Use sempre `select: { id, nome, emailPessoal }`.
3. **`try/catch` engole o `ApiError`** e vira `500`. Se precisar de `catch`, faça `if (e instanceof ApiError) throw e`. O melhor é não ter `catch`: o handler global já trata erro do Prisma (`P2025` vira 404, `P2002` vira 409).
4. **O `schema` das rotas é só documentação** (`useDocsOnlySchemas`). Ele não valida nem serializa, mas o Swagger é avaliado, então descreva o que a API devolve de verdade (incluindo os erros em `problem+json`).
5. **Rota estática antes de `/:id`.** `/tickets/stats` declarada depois de `/tickets/:id` é lida como se `stats` fosse um id.
6. **O mock do Prisma é escrito à mão** (`src/lib/__mocks__/prisma.ts`). Se o teste dá `Cannot read properties of undefined (reading 'mockResolvedValue')`, falta a função no mock. Acrescente (é só uma linha) e avise o grupo.
7. **Migration.** Dê um nome à migration quando o Prisma pedir. Depois de qualquer `git pull` com migration nova, rode `pnpm prisma:migrate`. Se pedir para resetar o banco, **não confirme**. O banco é MySQL, então SQL à mão usa crases, não aspas duplas.
8. **Depois de `prisma generate`, o VS Code mostra o tipo antigo.** `Ctrl+Shift+P` → `TypeScript: Restart TS Server`.
9. **Ler o corpo de uma resposta duas vezes** (`await res.json()` duas vezes) dá erro: o corpo só pode ser lido uma vez.
10. **`pnpm prisma` e testes rodam na sua máquina.** Eles precisam do Prisma gerado, que ambientes sem acesso à internet não conseguem baixar.
11. **Colar um bloco por cima de outro pode apagar linhas vizinhas sem avisar.** Já aconteceu: duas linhas (`encerradoEm,` e `arquivadoEm,`) sumiram de um `update`, o código continuou compilando, e arquivar passou a responder `200` sem gravar nada. Depois de substituir um trecho, **releia o bloco inteiro**, e confie nos testes que olham o que vai para o banco (`prismaMock.<modelo>.update.mock.calls[0][0].data`), não só no status da resposta.
12. **Para provar que uma rota ou um texto sumiu, procure o padrão certo.** `grep "tickets/stats"` não acha `app.get("/stats", ...)`, porque a linha não tem a palavra `tickets`. Busque o trecho que de fato aparece no código (`grep -rn '"/stats"' src`).
13. **Ordem para remover uma rota antiga (alias):** primeiro o front troca e publica, depois o backend remove. Do contrário a tela perde os dados no intervalo.

---

## Checklist de pronto (copie para a descrição do PR)

- [ ] Rotas renomeadas conforme a tabela da seção 7 das convenções (substantivo, plural, inglês, sem verbo)
- [ ] Status certos: `201` + `Location`, `204` no delete (se existir), `404`/`409`/`422` em vez de `500`
- [ ] Recurso e coleção em HAL, com `self`; coleção com `_embedded`, `page` e links de paginação
- [ ] Links condicionados a **estado e papel**, usando as mesmas regras do controller
- [ ] Erros via `ApiError`, sem `try/catch` que devolva `500` cru
- [ ] Nenhum `select`/`include` que devolva `senhaHash` ou dado pessoal desnecessário
- [ ] Swagger atualizado, com os erros em `problem+json`
- [ ] Testes: formato, status, links presentes e ausentes, contrato
- [ ] Front: `embedded`, `hasLink`, `followLink`; nenhuma URL montada à mão nem regra de papel na tela
- [ ] `pnpm lint && pnpm typecheck && pnpm test` verdes no back e no front
- [ ] Backend e front publicados juntos (ou alias temporário combinado com o grupo)
- [ ] Revisado por outra pessoa do grupo
