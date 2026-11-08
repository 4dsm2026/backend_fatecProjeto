---
sidebar_position: 5
---

# Plano de trabalho — API REST nível 3 (HAL) no Workflow

> Leia primeiro o `CONVENCOES-API.md`. Ele diz **como** a API deve ficar. Este documento diz **quem faz o quê, em que ordem e como saber que terminou**.

## Estado em 24/10/2026

| Fase | Estado |
|---|---|
| Fase 0: convenções | ✅ concluída (`CONVENCOES-API.md`, atualizado com o que foi implementado) |
| Fase 1: infraestrutura | ✅ núcleo `src/hateoas`, handler `problem+json`, `GET /api`, `tickets` e `ticket-messages` de ponta a ponta (backend, frontend e testes) e o cliente HAL do front (`utils/hal.ts`) |
| Guia de 1 página | ✅ `GUIA-CONVERTER-MODULO.md`. **Falta o teste de aceite da fase:** outra pessoa converter um módulo seguindo só o guia |
| Fase 2: conversão dos módulos | em andamento, cada dono no seu módulo (há código publicado de `sessions`, `notifications`, `usuario-setor` e outros) |
| Fase 3: integração | ainda não começou |

## 1. O que o professor pediu (resumo)

Refazer **toda a API** do backend para ser **RESTful nível 3 (HATEOAS)**, e adaptar o **frontend** para usá-la.

- **Nível 2:** URLs com substantivos, verbos HTTP certos, status codes certos.
- **Nível 3 (HATEOAS):** toda resposta traz `_links` dizendo o que o usuário pode fazer **naquele momento**.
- Formato: **HAL**. Erros: **RFC 7807**. Paginação: `page` e `size`. Raiz: `GET /api`.
- URLs em inglês, **campos do corpo e enums em português** (como está hoje).
- Os testes unitários **serão refeitos** (o professor sabe que vão quebrar).
- O professor só avalia o resultado final atualizado.

## 2. Conceitos que todo mundo precisa entender

### 2.1 Os 3 níveis, aplicados ao nosso projeto

| Nível | Em uma frase | Exemplo nosso |
|---|---|---|
| 1 | Cada coisa tem sua URL | `/tickets`, `/users` |
| 2 | Verbo HTTP + status code certos | `POST /tickets` → `201`; `DELETE` → `204` |
| 3 | A resposta diz o que fazer a seguir | `_links` com `reply`, `update`... |

### 2.2 O que é HATEOAS, sem enrolação

A API devolve, junto com os dados, **os links das ações possíveis**. O frontend deixa de "saber" regras e passa a só obedecer:

> **Tem o link? Mostra o botão. Não tem? Esconde.**

Exemplo: um chamado já encerrado **não** traz o link de "responder". Um aluno **não** recebe o link de "atribuir". A regra mora no backend, em um lugar só.

### 2.3 Antes e depois (chamado)

**Antes:**
```json
{ "id": "clx1", "titulo": "Sem acesso ao SIGA", "status": "ABERTO" }
```

**Depois:**
```json
{
  "id": "clx1",
  "titulo": "Sem acesso ao SIGA",
  "status": "ABERTO",
  "_links": {
    "self":       { "href": "/tickets/clx1", "method": "GET" },
    "messages":   { "href": "/tickets/clx1/messages", "method": "GET" },
    "reply":      { "href": "/tickets/clx1/messages", "method": "POST" },
    "attachments":{ "href": "/tickets/clx1/attachments", "method": "GET" },
    "update":     { "href": "/tickets/clx1", "method": "PATCH" },
    "collection": { "href": "/tickets", "method": "GET" }
  }
}
```

### 2.4 Regra mental para criar os links de um recurso

Para cada recurso, responda 3 perguntas:
1. **Quais ações existem?** (ver, editar, apagar, ir para os filhos...)
2. **O estado atual permite essa ação?** (ex.: chamado encerrado não aceita resposta)
3. **O papel do usuário permite?** (ex.: aluno não apaga setor)

Só entra em `_links` o que passa nas 3 perguntas. `self` e `collection` entram sempre.

## 3. Divisão do trabalho

### 3.1 Quem faz o quê

O tamanho dos módulos foi medido em linhas de código (boa parte é documentação Swagger, então é uma estimativa, não uma regra).

| Pessoa | Backend (módulos) | Frontend (telas) | ~Linhas |
|---|---|---|---|
| **Matheus (líder)** | **Fase 1 inteira (infraestrutura)** + `tickets` (módulo-modelo) + `ticket-messages` + `GET /api` | Telas de chamados (aluno e admin), home | ~2.200 + infra |
| **Rodrigo** | `auth` (login, sessão, token, senha, primeiro acesso, me) | Telas públicas: login, esqueci-senha, reset-senha, primeiro-acesso | ~2.300 (muita doc) |
| **Otávio** | `setores` + `usuario-setor` + `notifications` | Telas de setores e de notificações (aluno e admin) | ~1.500 |
| **Guilherme** | `anexos` + `auditoria` + `sugestoes` + `catalogo` | Telas de anexos, relatórios, sugestões e catálogo | ~1.600 |
| **Andrey** | `papeis` + `users` + `comunicacoes` | Telas de alunos, funcionários e comunicações | ~1.300 |

**O que mudou em relação à divisão anterior (testes por módulo):** Auditoria saiu do Matheus para o Guilherme; Notificações saiu do Rodrigo para o Otávio; o Rodrigo ficou com a `auth`, que é o módulo mais delicado. Se alguém achar a carga injusta, rebalanceiem entre vocês e **atualizem esta tabela**.

### 3.2 Por que essa divisão

- **A Fase 1 não paraleliza.** Se cada um criar seu próprio jeito de montar links, de paginar e de devolver erro, o resultado fica inconsistente e o professor percebe.
- **`tickets` é o modelo** porque tem a máquina de estados (`ABERTO → EM_ATENDIMENTO → AGUARDANDO_USUARIO → RESOLVIDO → ENCERRADO`), que é a melhor demonstração de HATEOAS.
- **Cada pessoa leva backend + frontend + testes do próprio módulo.** Assim ninguém depende de outra pessoa para ver sua parte funcionando de ponta a ponta.

## 4. Fases

### Fase 0 — Convenções (concluída)
Entregável: `CONVENCOES-API.md`. **Todos leem antes de começar.**

### Fase 1 — Infraestrutura (Matheus, bloqueante)

O que construir:

1. **Helper de links HAL:** função que recebe um recurso e o usuário logado e devolve o `_links`. Um builder por recurso (`buildTicketLinks`, `buildSetorLinks`...), todos usando o mesmo helper base.
2. **Helpers de resposta:** `toResource(...)` (um recurso) e `toCollection(...)` (lista com `_embedded`, `page`, `_links` de paginação).
3. **Handler global de erros RFC 7807**, com `Content-Type: application/problem+json`. Todos os erros do sistema passam por ele (acaba o `{ error: "..." }`).
4. **Paginação padrão:** `page` e `size` na query, com valor padrão e tamanho máximo.
5. **`GET /api`:** endpoint raiz com os links de entrada (`tickets`, `users`, `notifications`, `sessions`...), filtrando pelo papel do usuário.
6. **Módulo-modelo `tickets`** completo (rotas, links por estado e papel, testes), como exemplo a copiar.
7. **Cliente HAL no frontend:** ajustar o `utils/api.ts` e criar um helper (ex.: `hasLink(recurso, 'reply')`, `followLink(...)`) para as telas usarem.
8. **Guia de 1 página** "como converter um módulo", com base no que foi feito em `tickets`.

**Pronto quando:** `tickets` funciona de ponta a ponta (backend, frontend e testes), e outra pessoa consegue converter um módulo simples seguindo só o guia.

**Enquanto a Fase 1 acontece, os outros 4 não ficam parados.** Cada um faz, no seu módulo:
- Ler o `CONVENCOES-API.md` e o conceito de HATEOAS desta página.
- Listar todas as rotas atuais do módulo e escrever a rota nova correspondente (tabela da seção 7 das convenções).
- Definir, para cada recurso do módulo, **quais links existem e quando** (as 3 perguntas da seção 2.4).
- Listar as telas do frontend que chamam essas rotas.
- Listar os testes atuais do módulo que vão precisar ser refeitos.

### Fase 2 — Conversão dos módulos (em paralelo)

Cada pessoa converte o seu módulo seguindo o guia da Fase 1. **Checklist por módulo (use em todos):**

- [ ] Rotas renomeadas conforme a tabela das convenções (substantivo, plural, inglês, sem verbo)
- [ ] Verbos HTTP corretos (`GET`, `POST`, `PATCH`, `PUT`, `DELETE`)
- [ ] Status corretos: `201` + header `Location` na criação, `204` no delete, `404`/`409`/`422` em vez de `500` genérico
- [ ] Respostas de recurso e de coleção no formato HAL, com `self`
- [ ] Links condicionados ao **estado** e ao **papel**
- [ ] Listagens paginadas (`page`, `size`, links `next`/`prev`/`last`)
- [ ] Erros via handler global (RFC 7807)
- [ ] Schemas do Swagger atualizados
- [ ] Testes refeitos: rotas novas, status, formato HAL, e **links presentes/ausentes por estado e papel**
- [ ] Telas do frontend do módulo usando os links (`hasLink`) em vez de regras fixas
- [ ] Pull request revisado por **outra pessoa** (revisão cruzada)

**Regras de convivência:**
- Uma branch por módulo, saindo da branch principal do grupo, ex.: `feat/rest-setores`.
- Não mexer no helper HAL sozinho. Precisou de algo novo nele? Avise o líder, para ninguém quebrar o trabalho dos outros.
- Dúvida sobre convenção? Pergunte antes de inventar. Se for decisão nova, entra no `CONVENCOES-API.md`.

### Fase 3 — Integração e fechamento

- Juntar todas as branches e rodar a suíte completa.
- Revisão do frontend inteiro: nenhuma tela com URL antiga ou regra de permissão fixa no código.
- Conferir que **toda** rota está no nível 3 e aparece no `GET /api` (diretamente ou por links).
- Swagger completo e coerente.
- Atualizar a documentação (README e docs do projeto).

## 5. Pontos de atenção

1. **O frontend vai quebrar enquanto o backend muda.** Combinem uma branch de integração e evitem trabalhar com backend novo contra frontend antigo.
2. **`auth` é sensível.** Mexer em login e sessão pode travar todo mundo. Antes de trocar, mantenham um jeito de logar funcionando para o resto do grupo testar.
3. **Alguns detalhes da `auth` ainda dependem de confirmação do professor** (modelagem por `sessions`, `tokens`, `password-resets` e `account-activations`). O Rodrigo pode começar pelo que já está claro (`POST /sessions`, `GET /users/me`) e deixar o resto para depois da resposta.
4. **Testes:** como todos serão refeitos, aproveitem para testar o que importa: que os **links certos** aparecem para cada estado e papel.
5. **Testcontainers** continua pausado. Quando o grupo voltar a ele, os testes novos podem nascer como testes de integração com banco real.

## 6. Ordem sugerida

| Quando | Quem | O quê |
|---|---|---|
| Agora | Todos | Ler convenções e este plano; preparar o levantamento do próprio módulo |
| Fase 1 | Matheus | Infraestrutura + `tickets` + guia + cliente HAL no frontend |
| Fase 2 | Todos | Converter o próprio módulo (backend, frontend e testes) |
| Fase 3 | Todos | Integração, revisão cruzada, Swagger, documentação |
