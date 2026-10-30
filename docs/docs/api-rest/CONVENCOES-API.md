---
sidebar_position: 2
---

# Convenções da API — REST nível 3 (HAL)

> Documento da Fase 0, **atualizado em 24/10/2026** com o que foi implementado em `tickets` e `ticket-messages` (módulos-modelo).
> As decisões estão fechadas; o único ponto em aberto está na seção 8.
> Regra de ouro: se não está aqui, pergunte ao líder antes de inventar.

## 1. Decisões já confirmadas com o professor

| Tema | Decisão |
|---|---|
| Escopo | Backend **e** frontend |
| Nível | API inteira no nível 3 (HATEOAS) |
| Formato de hipermídia | HAL (`_links`, `_embedded`) |
| Idioma das URLs | Inglês |
| Prefixo `/admin` | Mantido (as rotas serão refeitas) |
| Erros | RFC 7807 (`application/problem+json`) |
| Paginação | `page` e `size` na query; links `next`, `prev`, `last` |
| Endpoint raiz | `GET /api` com os links de entrada |
| Status do chamado | `PATCH /tickets/:id` com `{ status }` |
| `/auth` | Deve mudar (sem verbos na URL) |
| Notificações | Ações viram recursos |
| Testes | Serão refeitos |
| Campos do corpo e enums | Continuam em **português** (`titulo`, `descricao`, `ABERTO`...). Só URLs e `rel` dos links ficam em inglês |

## 2. Regras de URL

- Substantivos, **plural**, minúsculos, com hífen para palavras compostas: `/audit-logs`
- Nunca verbo na URL (`/read-all`, `/archive`, `/login` não podem existir)
- Filtros e ordenação vão na **query string**, nunca no caminho
- Relacionamentos aninhados só um nível: `/tickets/:id/messages`
- Ação = mudança de estado de um recurso (`PATCH`) **ou** criação de um recurso (`POST`)

## 3. Verbos e status

| Operação | Verbo | Sucesso | Observação |
|---|---|---|---|
| Listar | `GET` | `200` | Sempre com paginação |
| Ver um | `GET` | `200` | |
| Criar | `POST` | `201` | Header `Location` com a URL do novo recurso |
| Atualizar parcial | `PATCH` | `200` | |
| Substituir | `PUT` | `200` | |
| Apagar | `DELETE` | `204` | Sem corpo |

Erros: `400` formato inválido · `401` sem login · `403` sem permissão · `404` não existe · `409` conflito (ex.: transição de status inválida) · `422` regra de negócio violada · `500` só para falha inesperada de verdade.

## 4. Formato de recurso (HAL)

```json
{
  "id": "clx123",
  "protocolo": "TCK-A1B2C3",
  "titulo": "Sem acesso ao SIGA",
  "status": "ABERTO",
  "_links": {
    "self":       { "href": "/tickets/clx123", "method": "GET" },
    "collection": { "href": "/tickets", "method": "GET" },
    "messages":   { "href": "/tickets/clx123/messages", "method": "GET" },
    "reply":      { "href": "/tickets/clx123/messages", "method": "POST" },
    "transition": [
      { "href": "/tickets/clx123", "method": "PATCH", "name": "EM_ATENDIMENTO" },
      { "href": "/tickets/clx123", "method": "PATCH", "name": "RESOLVIDO" }
    ],
    "archive":    { "href": "/tickets/clx123", "method": "PATCH" }
  }
}
```

- Todo recurso tem `self`.
- Cada link inclui `href` e `method` (extensão nossa ao HAL puro, porque o mesmo `href` serve a ações diferentes). Quando um `rel` tem vários links, o campo `name` distingue um do outro (em `transition`, o `name` é o status de destino). `title` é um rótulo opcional.
- Os nomes dos campos do corpo e os valores dos enums ficam em **português** (`protocolo`, `ABERTO`); só os `rel` e as URLs ficam em inglês.
- Os schemas OpenAPI `Link` e `PageInfo` estão registrados uma vez em `components.schemas` (arquivo `src/hateoas/openapi.ts`).
- **Os links dependem do estado e do papel do usuário.** Link que o usuário não pode usar *não aparece*.
- O frontend só mostra um botão se o link correspondente existir.

## 5. Formato de coleção

```json
{
  "_embedded": { "tickets": [ { "...": "recurso com seus _links" } ] },
  "page": { "size": 20, "number": 0, "totalElements": 134, "totalPages": 7 },
  "_links": {
    "self":  { "href": "/tickets?page=0&size=20" },
    "next":  { "href": "/tickets?page=1&size=20" },
    "last":  { "href": "/tickets?page=6&size=20" }
  }
}
```

`prev` só aparece se não for a primeira página; `next` só se não for a última.

Os filtros usados na busca (inclusive os repetidos, como `status=A&status=B`) **viajam nos links** de paginação. A coleção de chamados aceita `include=naoLidas`, que acrescenta a cada chamado `mensagensNaoLidas` (as mensagens de outras pessoas que o usuário ainda não leu), calculado numa única consulta para a página toda. A coleção também pode trazer links de ação próprios: a coleção de mensagens inclui `mark-read` (`PATCH`) só quando há mensagens que o usuário ainda não leu.

## 6. Formato de erro (RFC 7807)

`Content-Type: application/problem+json`

```json
{
  "type": "/errors/not-found",
  "title": "Chamado não encontrado",
  "status": 404,
  "instance": "/tickets/clx123"
}
```

Erros de validação (`400`) acrescentam o campo `errors`, com um item por campo inválido:

```json
{
  "type": "/errors/bad-request",
  "title": "Dados inválidos",
  "status": 400,
  "instance": "/tickets",
  "errors": [{ "field": "body.titulo", "message": "Mínimo de 3 caracteres" }]
}
```

No código, o controller só lança `ApiError(kind, titulo, detalhe?)` e o handler global responde. Os `kind` e o status de cada um: `bad-request` 400, `unauthorized` 401, `forbidden` 403, `not-found` 404, `conflict` 409, `unprocessable` 422, `internal` 500.

## 7. Mapa de rotas: atual → proposta (decidido pelo líder; ajustar só se o professor discordar)

| Hoje | Proposta |
|---|---|
| `/tickets`, `/tickets/:id` | igual |
| `/tickets/:id/mensagens` | `/tickets/:id/messages` (**implementado**) |
| — (novo) | `GET /tickets/:id/messages/:messageId`, o endereço que o `Location` do `POST` aponta |
| `/tickets/:id/mensagens/lidas` (nunca existiu) | `PATCH /tickets/:id/messages` com `{ "lida": true }` (**implementado**, D7) |
| `DELETE /tickets/:id` | **não existe mais**: ninguém apaga chamado. `PATCH /tickets/:id` com `{ "arquivado": true }` ou `false` (só `ADMINISTRADOR`) |
| `/tickets/:id/anexos` | `/tickets/:id/attachments` |
| `/anexos/:id/download` | `/attachments/:id/content` |
| `/anexos/:id/download-token` | `POST /attachments/:id/download-tokens` |
| `/usuarios`, `/usuarios/:id` | `/users`, `/users/:id` |
| `/admin/setores` | `/admin/sectors` |
| `/admin/papeis` | `/admin/roles` |
| `/admin/comunicacoes` | `/admin/communication-templates` |
| `/usuarios/:id/setores`, `/usuarios-setores/:id` | `/admin/users/:id/sectors`, `/admin/user-sectors/:id` |
| `/auditoria`, `/auditoria/usuario/:id`, `/auditoria/periodo` | `/admin/audit-logs?userId=&from=&to=` |
| `/notifications` | `/notifications` |
| `/notifications/:id/lida`, `/archive`, `/unarchive` | `PATCH /notifications/:id` com `{ "lida": true }` ou `{ "arquivada": true }` (e `false` para desfazer) |
| `/notifications/read-all` | `PATCH /notifications` com `{ "lida": true }` (marca todas as do usuário logado) |
| `/sugestoes` | `/suggestions` |
| `/catalogo` | `/catalog` |
| `/auth/login` | `POST /sessions` |
| `/auth/logout` | `DELETE /sessions/current` |
| `/auth/refresh` | `POST /tokens` com `{ refreshToken }` → devolve novo access token |
| `/auth/register` | `POST /users` |
| `/auth/me` | `GET /users/me` |
| `/auth/esqueci-senha` | `POST /password-resets` |
| `/auth/reset-senha` | `PUT /password-resets/:token` |
| `/auth/trocar-senha` | `PUT /users/me/password` |
| `/auth/primeiro-acesso` | `PUT /account-activations/:token` |
| `/tickets/stats` | `GET /ticket-stats` (**implementado**; só equipe; o alias antigo foi removido) |

## 8. Decisões tomadas e ponto em aberto

- Campos do corpo e enums: **ficam em português** (decisão do grupo).
- `refresh`: vira `POST /tokens` (cria um novo access token a partir do refresh token).
- `primeiro-acesso`: vira `PUT /account-activations/:token` (ativar a conta definindo a senha inicial).
- Notificações em lote: `PATCH /notifications` com `{ "lida": true }`.
- **Em aberto:** a `/auth` mudou bastante. Conferir com o professor se a modelagem por `sessions`, `tokens`, `password-resets` e `account-activations` é aceita. Se ele pedir outra, só muda a tabela da seção 7.

## 9. Como cada módulo deve ser entregue

1. Rotas renomeadas conforme a seção 7
2. Status codes corretos (seção 3)
3. Respostas no formato HAL com links por estado e papel (seções 4 e 5)
4. Erros no formato RFC 7807 (seção 6)
5. Schemas do Swagger atualizados
6. Testes refeitos para as novas rotas e para os links
7. Frontend do módulo adaptado para usar os links

## 10. Regras de negócio do chamado (fechadas)

Valem para `tickets` e `ticket-messages`. A fonte única no código é `src/core/tickets/ticket-rules.ts`: o builder de links e o controller usam as **mesmas funções**, então o link e a regra nunca divergem.

- `RESOLVIDO` e `ENCERRADO` **bloqueiam** mensagem e anexo (aluno e equipe) até o chamado ser reaberto. Chamado arquivado também.
- **Reabrir** = voltar para `EM_ATENDIMENTO`, a partir de `RESOLVIDO` ou `ENCERRADO`, pelo dono ou pela equipe, em até **30 dias** contados de `encerradoEm` (o 30º dia ainda conta). Ao reabrir, `encerradoEm` volta a `null`.
- Depois dos 30 dias ninguém reabre, mas ainda é possível **encerrar** um chamado `RESOLVIDO`.
- Quando o dono responde em `AGUARDANDO_USUARIO`, o chamado volta sozinho para `EM_ATENDIMENTO`.
- **Ninguém apaga.** Só o `ADMINISTRADOR` arquiva (`arquivadoEm`); arquivado é somente leitura e continua consultável. A lista `?arquivados=excluir|incluir|somente` controla a listagem (o padrão esconde os arquivados).
- Editar os dados (prioridade, nível, responsável, SLA): só a equipe, e nunca em `ENCERRADO` nem em chamado arquivado. O aluno **não** muda esses campos.
- Mudança de status segue por `PATCH /tickets/:id` com `{ "status": "..." }`; cada destino permitido aparece como um link `transition`.

### Quando bloquear com 403 e quando com 409

Se o **estado** do recurso é o que impede (encerrado, arquivado, prazo vencido, transição inválida para a equipe), a resposta é `409`. Se falta **permissão** do papel (aluno editando dados, quem não é administrador arquivando), é `403`. O aluno que não é dono recebe `404`, igual ao chamado inexistente, para a API não revelar que ele existe.

## 11. Exceções e desvios

- **WebSocket (`/ws`)** não segue o formato REST: é um canal de tempo real, sem `_links`. O evento `nova_mensagem` leva a mensagem no campo `mensagem`, como antes. Só o **servidor** emite esse evento (depois do `POST /tickets/:id/messages`): depois do `auth`, frames enviados pelo cliente são ignorados, para ninguém forjar mensagem de outra pessoa. Está comentado no código como exceção.
- **`GET /tickets/:id`** mantém `mensagens` e `historico` **no corpo**, e não em `_embedded`. As mensagens têm rota própria (`/tickets/:id/messages`) e a tela do admin lê o corpo. É um desvio consciente do passo 12 do guia de execução.
- Enquanto os módulos `anexos` e outros não forem convertidos, links como `attachments` e `upload` apontam para rotas antigas. É esperado; o teste de alcance da Fase 3 confere no final.
