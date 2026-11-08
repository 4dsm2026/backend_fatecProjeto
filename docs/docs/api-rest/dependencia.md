---
sidebar_position: 6
---

# Dependências entre as partes do trabalho

Os arquivos são quase todos independentes, mas o trabalho não é. Quando montei a divisão, cada arquivo ficou com um dono só, então ninguém edita o mesmo arquivo que outra pessoa. Só que alguns precisam do que outro entrega antes.

## Quem depende de quem

| Quem precisa | Do que | De quem | Efeito |
|---|---|---|---|
| **Todos** | `package.json`, lockfile e ESLint novos (Fase 0) | Andrey | Todos precisam rebasear depois. Sem isso o lint de cada um não roda como o do Sonar. |
| **Todos** | Núcleo `src/hateoas` (links, paginação, erros) | Matheus | É a dependência principal. Todo módulo usa esses helpers. |
| **Todos** | Registro das rotas novas em `app.ts` | Matheus | Cada um pede a linha de registro ao Matheus, porque o arquivo é dele. |
| **Todos** | Handler de erros RFC 7807 integrado | Rodrigo | Os outros só apagam seus `catch → 500` depois que ele integrar. |
| **Todos (front)** | Cliente HAL (`hasLink`, `followLink`) em `utils/api.ts` | Matheus | Sem ele ninguém troca as regras fixas de papel e status por links. |
| **Guilherme** | `canInteractWithTicket` (regra de quando o chamado aceita anexo) | Matheus | O link `upload` do anexo depende dessa regra. |
| **Matheus** | Componente `AnexosPanel.tsx` | Guilherme | Ele importa o painel na página do chamado. Foi assim que dividi para os dois não editarem o mesmo arquivo. |
| **Rodrigo** | `entryLinks(viewer)` | Matheus | Usado no `GET /users/me`. |
| **Rodrigo e Andrey** | Decisão D3 (`POST /users` admin ou público) | os dois | Resolvem entre si. |
| **Otávio** | Regra de quem pode ver o chamado | Matheus | O link da notificação para o chamado só aparece se o usuário puder abrir o chamado. |

## Como reduzir o bloqueio

- **Matheus** publica primeiro só o contrato do núcleo: os tipos e as assinaturas das funções, antes da implementação completa. Assim os outros já escrevem contra ele.
- **Rodrigo** integra o handler de erros logo no começo, porque ele destrava a limpeza dos `catch` nos outros módulos.
- **Todos** podem fazer o levantamento do próprio módulo enquanto esperam, como o plano original já previa.

O Matheus é o gargalo. Ele tem o núcleo, o `tickets`, o `ticket-messages`, o `app.ts` e o cliente do front. Se ele atrasar, todo mundo atrasa.

## O que não conferi

Não listei todos os arquivos do repositório contra as listas de donos, então pode haver arquivos sem dono. Por exemplo, só atribuí `01-auth`, `03-chamado` e `06-trocar-senha` em `tests/produtos/`. Se você quiser, eu cruzo a lista completa de arquivos com as divisões e aponto o que ficou sem dono.

## Estado em 24/10/2026: o que o Matheus já entregou

| Dependência | Estado |
|---|---|
| Núcleo `src/hateoas` (links, paginação, erros, schemas OpenAPI `Link` e `PageInfo`) | ✅ publicado |
| Registro de rotas novas em `app.ts` | ✅ feito sob pedido (ex.: `ticketStatsRoutes`) |
| Cliente HAL do front (`utils/hal.ts`: `embedded`, `hasLink`, `getLinks`, `followLink`) | ✅ publicado |
| `canInteractWithTicket` (recebe o chamado inteiro; bloqueia `RESOLVIDO`, `ENCERRADO` e arquivado) | ✅ publicado, para o link `upload` do Guilherme |
| `entryLinks(viewer)` | ✅ publicado, usado pelo `GET /users/me` do Rodrigo |
| `canViewTicket` (quem pode ver o chamado) | ✅ publicado, para o link da notificação do Otávio |

**Ainda pendente:** o componente `AnexosPanel.tsx` (do Guilherme, para o Matheus importar na página do chamado) **não existe no front**. Enquanto os anexos não forem convertidos, a tela de chamado segue chamando `/tickets/:id/anexos`.

