import type { FastifyInstance } from "fastify";
import { create, getOne, list, patch, removeSoft } from "./users.controller";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";

/* ===================================================================
 * Fragmentos reutilizáveis de documentação (OpenAPI/Swagger).
 * Mesma convenção usada em src/core/auth/auth.routes.ts: cada arquivo
 * de rotas declara os próprios fragmentos (não há módulo compartilhado
 * no projeto), então o que está aqui é específico deste plugin
 * (/usuarios) — não confundir com os fragmentos homônimos de auth.routes.ts,
 * que documentam formatos de erro ligeiramente diferentes em alguns casos.
 * =================================================================== */

// Exemplos reutilizados em mais de um schema (evita duplicar a mesma string).
const EXAMPLE_NOME = "João Silva";
const EXAMPLE_USER_NOT_FOUND = "Usuário não encontrado";
const EXAMPLE_RAW_DB_ERROR = "Connection lost: The server closed the connection.";

/* ----------------------- Erro 400 (Zod) ----------------------- */
// Corpo devolvido por formatZodError (src/utils/zod-helpers.ts) quando
// buildRouteValidator(...).parse(req) rejeita body/query/params por falha
// de schema. Idêntico ao ValidationErrorSchema de auth.routes.ts (mesma
// função formatZodError é usada nos dois módulos).
const ValidationErrorSchema = {
  type: "object",
  title: "ErroDeValidacaoDeSchema",
  required: ["message", "issues"],
  properties: {
    message: { type: "string", example: "Validação falhou" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string", example: "perPage" },
          message: { type: "string", example: "Number must be less than or equal to 100" },
          code: { type: "string", example: "too_big" },
        },
      },
    },
  },
} as const;

/* ----------------------- Erro 401 ----------------------- */
// Corpo exato enviado por src/plugins/auth-verify.ts (`app.authenticate`)
// quando o token de acesso está ausente, malformado, inválido ou expirado.
// Ao contrário de src/core/auth/auth.routes.ts, os endpoints deste arquivo
// não têm nenhuma checagem própria adicional de autenticação (sem a
// variante "Não autenticado" de /auth/me e /auth/trocar-senha) — este é o
// único formato de 401 possível aqui.
const UnauthorizedErrorSchema = {
  type: "object",
  title: "ErroNaoAutorizado",
  properties: {
    error: { type: "string", example: "Não autorizado" },
  },
} as const;

/* ----------------------- Erro 403 ----------------------- */
// Corpo exato enviado pelo decorator `app.authorize([...])`
// (src/plugins/auth-verify.ts) quando o `role` do token não está na lista
// de papéis permitidos para a rota.
const ForbiddenErrorSchema = {
  type: "object",
  title: "ErroDeAcessoNegado",
  properties: {
    error: { type: "string", example: "Acesso negado" },
  },
} as const;

// Só existe em PATCH /usuarios/{id}: quando quem chama tem papel `USUARIO` e
// tenta alterar um dos campos privilegiados (ver lista na descrição do
// endpoint). Mensagem inclui o nome do campo rejeitado.
const ForbiddenFieldErrorSchema = {
  type: "object",
  title: "ErroDeCampoNaoPermitido",
  properties: {
    error: {
      type: "string",
      example: "Campo não permitido: papel",
      description:
        "Formato: `Campo não permitido: <nome_do_campo>`, onde `<nome_do_campo>` é " +
        "exatamente o primeiro campo privilegiado encontrado no corpo da requisição " +
        "(checagem para na primeira ocorrência).",
    },
  },
} as const;

/* ----------------------- Erro 429 (rate limit) ----------------------- */
// O @fastify/rate-limit é registrado globalmente (src/plugins/rateLimit.ts,
// `global: true`, 100 req/min por IP) e se aplica a TODAS as rotas da API,
// inclusive as deste arquivo. Corpo exato do errorResponseBuilder
// configurado no plugin (idêntico ao de auth.routes.ts).
const RateLimitErrorSchema = {
  type: "object",
  title: "ErroDeRateLimit",
  properties: {
    statusCode: { type: "integer", example: 429 },
    error: { type: "string", example: "Too Many Requests" },
    message: {
      type: "string",
      example: "Limite de requisições atingido. Tente novamente em 42s.",
    },
  },
} as const;

const RateLimitHeaders = {
  "x-ratelimit-limit": {
    type: "integer",
    description: "Quantas requisições o cliente pode fazer na janela atual (100/min por IP).",
  },
  "x-ratelimit-remaining": {
    type: "integer",
    description: "Quantas requisições ainda restam nessa janela de 1 minuto.",
  },
  "x-ratelimit-reset": {
    type: "integer",
    description: "Segundos até a janela atual de rate limit reiniciar.",
  },
} as const;

const RateLimit429Response = {
  description:
    "Limite de requisições excedido: 100 requisições por minuto, por IP " +
    "(aplicado globalmente pelo @fastify/rate-limit — ver src/plugins/rateLimit.ts, " +
    "não é um limite específico deste endpoint).",
  headers: {
    ...RateLimitHeaders,
    "retry-after": {
      type: "integer",
      description: "Segundos que o cliente deve esperar antes de tentar novamente.",
    },
  },
  ...RateLimitErrorSchema,
} as const;

/* ----------------------- Recurso "Usuário" (visão staff) ----------------------- */
// Espelha EXATAMENTE `baseSelect` em users.service.ts (32 campos — usado por
// create/getOne/list/patch/removeSoft, todos deste arquivo). `senhaHash`
// nunca é selecionado, então nunca vaza aqui.
//
// ⚠️ Atenção — este NÃO é o mesmo formato de `GET /auth/me` /
// `GET /auth/usuarios` (schema `UsuarioPublico` em auth.routes.ts, 30
// propriedades): aquele inclui `precisaTrocarSenha` e `passwordUpdatedAt`
// mas NÃO inclui `organizacaoId`, `anonimizado` nem `deletadoEm`; este
// (`UsuarioAdmin`) é o oposto — inclui os 3 últimos mas não os 2 primeiros.
// Um cliente que já consome `GET /auth/me` não pode assumir o mesmo shape
// aqui. Nulidade de cada campo conferida contra `model Usuario` em
// prisma/schema.prisma. OpenAPI gerado é 3.0.3 (default do @fastify/swagger
// quando `openapi.openapi` não é definido em swagger.ts), por isso usamos
// `nullable: true` (sintaxe 3.0.x) em vez de `type: ["string", "null"]`.
const UsuarioAdminSchema = {
  type: "object",
  title: "UsuarioAdmin",
  additionalProperties: true,
  properties: {
    id: { type: "string", example: "cmj1234567890123456789012" },
    organizacaoId: {
      type: "string",
      nullable: true,
      description: "ID da organização à qual o usuário pertence. Nulo se não vinculado a nenhuma.",
    },
    nome: { type: "string", example: EXAMPLE_NOME },
    emailPessoal: { type: "string", format: "email" },
    emailEducacional: { type: "string", format: "email", nullable: true },
    ra: {
      type: "string",
      nullable: true,
      description: "Registro Acadêmico (RA). Único quando presente, mas pode ser nulo.",
    },
    cursoNome: { type: "string", nullable: true },
    cursoSigla: { type: "string", nullable: true, example: "DSM" },
    papel: {
      type: "string",
      enum: ["USUARIO", "BACKOFFICE", "TECNICO", "ADMINISTRADOR"],
      example: "USUARIO",
    },
    ativo: { type: "boolean", description: "Conta desativada (false) não consegue logar." },
    anonimizado: {
      type: "boolean",
      description:
        "true quando a conta passou por remoção via DELETE /usuarios/{id} (soft delete com " +
        "anonimização — ver descrição desse endpoint). Não impede que o registro continue " +
        "aparecendo aqui: nenhum dos endpoints deste arquivo, exceto a listagem, filtra por " +
        "`deletadoEm`/`anonimizado`.",
    },
    criadoEm: { type: "string", format: "date-time" },
    atualizadoEm: { type: "string", format: "date-time" },
    deletadoEm: {
      type: "string",
      format: "date-time",
      nullable: true,
      description: "Data do soft delete (DELETE /usuarios/{id}). Nulo enquanto a conta não foi removida.",
    },
    unidadeFatec: { type: "string", nullable: true },
    curso: { type: "string", nullable: true },
    eixoTecnologico: { type: "string", nullable: true },
    turno: { type: "string", nullable: true },
    turma: { type: "string", nullable: true },
    semestreAtual: { type: "string", nullable: true },
    matrizCurricular: { type: "string", nullable: true },
    situacaoAcademica: { type: "string", nullable: true },
    anoSemestreIngresso: { type: "string", nullable: true },
    coordenadorCurso: { type: "string", nullable: true },
    telefoneCelular: { type: "string", nullable: true },
    whatsapp: { type: "string", nullable: true },
    canalPreferencialContato: { type: "string", nullable: true },
    melhorPeriodoContato: { type: "string", nullable: true },
    necessitaAtendimentoAcessivel: {
      type: "boolean",
      description: "Indica necessidade de atendimento acessível. Dado sensível.",
    },
    tipoAcessibilidade: {
      type: "string",
      nullable: true,
      description: "Detalhe do tipo de acessibilidade necessário. Dado sensível.",
    },
    observacoesAtendimento: {
      type: "string",
      nullable: true,
      description: "Observações livres sobre o atendimento ao usuário. Dado sensível.",
    },
    notificacoesInApp: {
      type: "boolean",
      description: "Preferência do usuário: receber notificações dentro do app.",
    },
  },
} as const;

export async function usersRoutes(app: FastifyInstance) {
  // Faz com que o `schema` das rotas abaixo sirva só para o @fastify/swagger
  // gerar a documentação — a validação real continua 100% via Zod (buildRouteValidator,
  // chamado no início de cada controller), exatamente como já era antes desta
  // alteração. Ver o porquê detalhado em src/utils/openapi-docs-only.ts.
  useDocsOnlySchemas(app);

  app.post(
    '/',
    {
      preHandler: [app.authenticate, app.authorize(['ADMINISTRADOR'])],
      schema: {
        tags: ["Usuarios"],
        summary: "Criar um usuário",
        description:
          "Cria um usuário. **Só `ADMINISTRADOR`** pode chamar este endpoint — note que " +
          "isso é mais restrito que `GET /usuarios/` e `GET /usuarios/{id}` (que também " +
          "aceitam `BACKOFFICE`/`TECNICO`); `BACKOFFICE`/`TECNICO` conseguem listar e " +
          "consultar usuários, mas não criar.\n\n" +
          "**O schema Zod tem dois \"perfis\" conforme a presença de `ra`** " +
          "(`isAluno = !!data.ra`), aplicados via `superRefine` — o JSON Schema abaixo " +
          "não expressa essa condicional (o OpenAPI gerado mostra todos os campos como " +
          "não obrigatórios), então a regra real é:\n" +
          "- **Aluno** (`ra` presente): precisa de `emailEducacional` **ou** " +
          "`emailPessoal` (pelo menos um dos dois). `senha` é opcional — se omitida, " +
          "usa `DEFAULT_TEMP_PASSWORD` (variável de ambiente obrigatória na subida do " +
          "servidor, então sempre disponível em produção). A conta é criada com " +
          "`precisaTrocarSenha: true` internamente, mas **esse campo não aparece na " +
          "resposta** deste endpoint (não faz parte do `baseSelect`/`UsuarioAdmin`) — só " +
          "é visível via `GET /auth/me`.\n" +
          "- **Funcionário** (sem `ra`): `emailPessoal` e `senha` são **obrigatórios** " +
          "(400 se faltar qualquer um dos dois).\n\n" +
          "**⚠️ `nome` é o único campo realmente obrigatório que o Zod NÃO valida.** O " +
          "schema marca `nome` como opcional, mas `createUser` " +
          "(`src/core/users/users.service.ts`) lança `throw new Error('Nome é " +
          "obrigatório.')` se ele faltar — como isso acontece **depois** da validação " +
          "Zod (que já passou), o `catch` genérico do controller devolve **`500`**, não " +
          "`400`. Ou seja: enviar a requisição sem `nome` não dá erro de validação " +
          "normal, dá um erro de servidor com a mensagem `\"Nome é obrigatório.\"` no " +
          "campo `error`.\n\n" +
          "**Efeito colateral no e-mail de aluno sem `emailPessoal`:** como a coluna " +
          "`emailPessoal` é `@unique` e obrigatória no banco (não pode ficar nula), o " +
          "service faz `emailPessoal: data.emailPessoal ?? data.emailEducacional` — um " +
          "aluno cadastrado só com `emailEducacional` acaba com o **mesmo valor** salvo " +
          "em `emailPessoal` e em `emailEducacional`. Consequência prática: dois alunos " +
          "tentando usar o mesmo `emailEducacional` (sem `emailPessoal`) colidem no " +
          "`unique` de `emailPessoal`, não no de `emailEducacional`, e recebem `409` " +
          "com a mensagem genérica \"Email já está em uso\".\n\n" +
          "**Mapeamento do erro 409:** o Prisma retorna `P2002` (violação de `unique`) " +
          "para `emailPessoal` **e** para `ra`. O controller decide a mensagem só " +
          "verificando se `e.message` (em minúsculas) contém a substring `\"ra\"` — se " +
          "sim, responde \"RA já está em uso\"; senão, \"Email já está em uso\". É uma " +
          "checagem por substring, não por nome de campo/constraint.",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          description:
            "Nenhum campo é `required` no JSON Schema (reflete o Zod real), mas ver as " +
            "regras condicionais e o alerta sobre `nome` na descrição do endpoint.",
          properties: {
            nome: {
              type: "string",
              minLength: 2,
              maxLength: 160,
              description:
                "Marcado como opcional aqui, mas de fato obrigatório (ver alerta acima — " +
                "ausência causa 500, não 400).",
              example: EXAMPLE_NOME,
            },
            ra: {
              type: "string",
              maxLength: 32,
              nullable: true,
              description: "Registro Acadêmico. Presença deste campo define o perfil \"aluno\".",
            },
            emailPessoal: {
              type: "string",
              format: "email",
              description: "Obrigatório para funcionário. Para aluno, ver nota sobre auto-preenchimento.",
            },
            emailEducacional: { type: "string", format: "email", nullable: true },
            senha: {
              type: "string",
              minLength: 8,
              description:
                "Obrigatória para funcionário. Para aluno, opcional (usa " +
                "`DEFAULT_TEMP_PASSWORD` se omitida). Nunca é devolvida na resposta.",
            },
            papel: {
              type: "string",
              enum: ["USUARIO", "BACKOFFICE", "TECNICO", "ADMINISTRADOR"],
              default: "USUARIO",
            },
            ativo: { type: "boolean", default: true },
            organizacaoId: { type: "string", minLength: 1, nullable: true },
            cursoNome: { type: "string", maxLength: 128, nullable: true },
            cursoSigla: { type: "string", maxLength: 16, nullable: true, example: "DSM" },
            unidadeFatec: { type: "string", maxLength: 128, nullable: true },
            turno: { type: "string", maxLength: 64, nullable: true },
            turma: { type: "string", maxLength: 64, nullable: true },
            semestreAtual: { type: "string", maxLength: 32, nullable: true },
            anoSemestreIngresso: { type: "string", maxLength: 32, nullable: true },
          },
        },
        response: {
          201: {
            description: "Usuário criado.",
            ...UsuarioAdminSchema,
          },
          400: {
            description:
              "Falha de schema Zod — ex.: `emailPessoal`/`emailEducacional` com formato " +
              "inválido, `senha` com menos de 8 caracteres, `papel` fora do enum, ou as " +
              "regras condicionais do `superRefine` (funcionário sem `emailPessoal` ou " +
              "sem `senha`; aluno sem `emailEducacional` nem `emailPessoal`). **Não** " +
              "cobre `nome` ausente — ver alerta acima.",
            ...ValidationErrorSchema,
          },
          401: {
            description: "Token de acesso ausente, malformado, inválido ou expirado.",
            ...UnauthorizedErrorSchema,
          },
          403: {
            description: "Autenticado, mas papel diferente de `ADMINISTRADOR`.",
            ...ForbiddenErrorSchema,
          },
          409: {
            description: "`emailPessoal` ou `ra` já cadastrado em outro usuário.",
            type: "object",
            properties: {
              error: {
                type: "string",
                enum: ["Email já está em uso", "RA já está em uso"],
              },
            },
          },
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado **ou** uma das validações de negócio do " +
              "`createUser` que o Zod não cobre — principalmente `nome` ausente " +
              "(`\"Nome é obrigatório.\"`). `error` é a mensagem crua da exceção.",
            type: "object",
            properties: {
              error: { type: "string", example: "Nome é obrigatório." },
            },
          },
        },
      },
    },
    create,
  )
  app.get(
    '/',
    {
      preHandler: [
        app.authenticate,
        app.authorize(['ADMINISTRADOR', 'BACKOFFICE', 'TECNICO']),
      ],
      schema: {
        tags: ["Usuarios"],
        summary: "Listar usuários (com filtros e paginação)",
        description:
          "Lista os usuários cadastrados, com filtros opcionais e paginação. " +
          "**Requer papel de equipe** (`ADMINISTRADOR`, `BACKOFFICE` ou `TECNICO`) — " +
          "diferente de `GET /auth/usuarios`, que exige apenas um token válido de " +
          "qualquer papel (inclusive `USUARIO`/aluno) e não pagina. São dois endpoints " +
          "de listagem de usuários distintos e com controle de acesso diferente " +
          "coexistindo no mesmo backend.\n\n" +
          "**Filtro implícito, sempre aplicado:** só retorna usuários com " +
          "`deletadoEm = null` (não removidos) — ao contrário de `GET /usuarios/{id}`, " +
          "que não tem esse filtro e consegue devolver até usuários já removidos " +
          "(soft delete). Todos os demais filtros abaixo são opcionais e combináveis " +
          "(AND entre eles).\n\n" +
          "**Busca por texto (`q`):** compara com `nome`, `emailPessoal`, " +
          "`emailEducacional` e `ra`, em OR, usando `LIKE '%valor%'` (substring, não " +
          "prefixo). Como o banco é MySQL, essa busca normalmente já é case-insensitive " +
          "por padrão (depende da collation configurada no servidor).\n\n" +
          "**`ativo` é uma string literal, não um booleano JSON:** o valor precisa ser " +
          "exatamente a string `\"true\"` ou `\"false\"` na querystring (ex.: `?ativo=true`) " +
          "— qualquer outro valor (incluindo `1`, `0`, vazio) falha a validação com 400.\n\n" +
          "**Paginação:** `page` (padrão 1, mínimo 1) e `perPage` (padrão 20, entre 1 e " +
          "100) são coeridos de string para número — um valor não numérico (ex.: " +
          "`?page=abc`) resulta em 400. `pages` na resposta é `Math.ceil(total / perPage)`.\n\n" +
          "**Nunca retorna 404:** diferente de `GET /auth/usuarios`, zero resultados " +
          "ainda respondem `200`, com `items: []`, `total: 0` e `pages: 0` — não há um " +
          "caso de \"nenhum usuário encontrado\" tratado como erro aqui.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            page: {
              type: "integer",
              minimum: 1,
              default: 1,
              description: "Página desejada (1-indexado). Valor não numérico gera 400.",
            },
            perPage: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 20,
              description: "Itens por página (1 a 100).",
            },
            q: {
              type: "string",
              minLength: 1,
              description:
                "Busca parcial (substring) em `nome`, `emailPessoal`, `emailEducacional` e " +
                "`ra` (comparados em OR). Se enviado vazio (`?q=`), é tratado como ausente " +
                "pela validação de string não vazia? Na prática o Zod recebe string vazia " +
                "e falha `min(1)` — resulta em 400, não em 'sem filtro'.",
              example: "Silva",
            },
            papel: {
              type: "string",
              enum: ["USUARIO", "BACKOFFICE", "TECNICO", "ADMINISTRADOR"],
              description: "Filtra pelo papel exato do usuário.",
            },
            organizacaoId: {
              type: "string",
              minLength: 1,
              description: "Filtra pelo ID exato da organização.",
            },
            ativo: {
              type: "string",
              enum: ["true", "false"],
              description:
                "Filtra por conta ativa/inativa. Deve ser exatamente a string `\"true\"` ou " +
                "`\"false\"` — ver nota de validação acima.",
            },
          },
        },
        response: {
          200: {
            description:
              "Página de resultados. Sempre `200`, mesmo quando nenhum usuário casa com " +
              "os filtros (ver nota acima) — não confundir com `GET /auth/usuarios`, que " +
              "usa `404` para esse mesmo caso.",
            type: "object",
            required: ["items", "page", "perPage", "total", "pages"],
            properties: {
              items: { type: "array", items: UsuarioAdminSchema },
              page: { type: "integer", example: 1 },
              perPage: { type: "integer", example: 20 },
              total: {
                type: "integer",
                description: "Total de usuários que casam com os filtros, antes da paginação.",
                example: 137,
              },
              pages: {
                type: "integer",
                description: "Math.ceil(total / perPage). Pode ser 0 quando total=0.",
                example: 7,
              },
            },
          },
          400: {
            description:
              "Querystring fora do schema — ex.: `page`/`perPage` não numéricos, `perPage` " +
              "fora de 1–100, `q` vazio, `papel` fora do enum, ou `ativo` diferente de " +
              "`\"true\"`/`\"false\"`.",
            ...ValidationErrorSchema,
          },
          401: {
            description: "Token de acesso ausente, malformado, inválido ou expirado.",
            ...UnauthorizedErrorSchema,
          },
          403: {
            description:
              "Autenticado, mas com papel fora de `ADMINISTRADOR`/`BACKOFFICE`/`TECNICO` " +
              "(ex.: um `USUARIO`/aluno tentando listar usuários por aqui).",
            ...ForbiddenErrorSchema,
          },
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado ao consultar usuários. `error` é a mensagem crua da exceção " +
              "capturada (via `errMsg()`), não sanitizada — mesma observação já registrada " +
              "em vários endpoints de `auth.routes.ts`.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
            },
          },
        },
      },
    },
    list,
  )
  app.get(
    '/:id',
    {
      preHandler: [
        app.authenticate,
        app.authorize(['ADMINISTRADOR', 'BACKOFFICE', 'TECNICO']),
      ],
      schema: {
        tags: ["Usuarios"],
        summary: "Buscar um usuário pelo ID",
        description:
          "Retorna o registro completo (schema `UsuarioAdmin`, 32 campos — ver nota em " +
          "`GET /usuarios/`) de um único usuário, pelo `id` exato. **Requer papel de " +
          "equipe** (`ADMINISTRADOR`, `BACKOFFICE` ou `TECNICO`) — um `USUARIO`/aluno não " +
          "acessa este endpoint (nem para consultar o próprio registro: para isso existe " +
          "`GET /auth/me`, que usa outro shape de resposta).\n\n" +
          "**⚠️ Sem filtro por `deletadoEm`/`anonimizado`.** Ao contrário de " +
          "`GET /usuarios/` (que só lista contas com `deletadoEm = null`), este endpoint " +
          "faz um `findUnique` puro por `id` — devolve normalmente `200` mesmo para uma " +
          "conta já removida via `DELETE /usuarios/{id}` (soft delete). Nesse caso o " +
          "corpo vem com os dados já anonimizados (`nome: \"Usuário Anônimo\"`, e-mails " +
          "trocados por `anonp_<id>@...`/`anone_<id>@...`, `anonimizado: true`, " +
          "`deletadoEm` preenchido) — não há um jeito de saber pela resposta que a busca " +
          "foi por um ID inexistente vs. um ID de conta removida, exceto olhando se " +
          "`deletadoEm` está preenchido.\n\n" +
          "**Sem checagem de formato do `id`:** qualquer string não vazia é aceita pela " +
          "validação (`z.string().min(1)`, sem `cuid`/regex); um `id` que não exista " +
          "simplesmente resulta em `404` — mesmo padrão já visto no filtro `id` da " +
          "querystring de `GET /auth/usuarios`. Na prática, como a rota é `/usuarios/:id`, " +
          "o Fastify já não roteia para cá com o segmento vazio (`/usuarios/`), então o " +
          "caso de `id` vazio do `400` abaixo é apenas teórico — inatingível por essa " +
          "rota nas condições normais de roteamento.",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: {
              type: "string",
              minLength: 1,
              description: "ID (`cuid`) do usuário.",
              example: "cmj1234567890123456789012",
            },
          },
        },
        response: {
          200: {
            description: "Usuário encontrado (ativo, inativo ou já removido/anonimizado).",
            ...UsuarioAdminSchema,
          },
          400: {
            description:
              "`id` fora do schema (string vazia). Ver nota acima: na prática inatingível " +
              "via esta rota, porque o Fastify não casa `/usuarios/:id` com o segmento " +
              "vazio.",
            ...ValidationErrorSchema,
          },
          401: {
            description: "Token de acesso ausente, malformado, inválido ou expirado.",
            ...UnauthorizedErrorSchema,
          },
          403: {
            description:
              "Autenticado, mas com papel fora de `ADMINISTRADOR`/`BACKOFFICE`/`TECNICO` " +
              "(ex.: um `USUARIO`/aluno, mesmo tentando consultar o próprio `id`).",
            ...ForbiddenErrorSchema,
          },
          404: {
            description: "Nenhum usuário com esse `id`.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_USER_NOT_FOUND },
            },
          },
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado ao buscar o usuário. `error` é a mensagem crua da exceção " +
              "capturada (via `errMsg()`), não sanitizada.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
            },
          },
        },
      },
    },
    getOne,
  )
  app.patch(
    '/:id',
    {
      preHandler: [app.authenticate, app.authorize(['ADMINISTRADOR', 'BACKOFFICE', 'TECNICO','USUARIO'])],
      schema: {
        tags: ["Usuarios"],
        summary: "Atualizar um usuário (parcial)",
        description:
          "Atualiza parcialmente um usuário. **Todo papel autenticado pode chamar este " +
          "endpoint**, inclusive `USUARIO`/aluno — é o único dos 5 endpoints de " +
          "`/usuarios` acessível por um aluno. O controle de acesso é feito dentro do " +
          "controller (`src/core/users/users.controller.ts`), não só pelo " +
          "`app.authorize([...])`:\n\n" +
          "**Se `role === 'USUARIO'`:**\n" +
          "1. Só pode editar o **próprio** registro — `id` do path precisa ser igual ao " +
          "`sub` do token. Qualquer outro `id` → `403` (`Acesso negado`), mesmo que o " +
          "usuário exista.\n" +
          "2. O corpo **não pode conter** nenhum destes 5 campos: `papel`, `ativo`, " +
          "`anonimizado`, `organizacaoId`, `senha` — a presença de qualquer um (mesmo " +
          "com valor igual ao atual) devolve `403` com " +
          "`Campo não permitido: <campo>` (para no primeiro encontrado, não lista " +
          "todos). Troca de senha própria é só por `POST /auth/trocar-senha` " +
          "(exige senha atual); reset de senha via PATCH continua liberado para " +
          "`ADMINISTRADOR`/`BACKOFFICE`/`TECNICO`.\n\n" +
          "**⚠️ A lista de bloqueio tem só 5 campos — tudo o mais fica liberado para " +
          "o próprio aluno editar**, incluindo `ra`, `emailPessoal`, `emailEducacional`, " +
          "`nome`, `cursoNome`/`cursoSigla` e **todos** os campos acadêmicos " +
          "(`unidadeFatec`, `curso`, `turno`, `turma`, `semestreAtual`, " +
          "`matrizCurricular`, `situacaoAcademica`, `anoSemestreIngresso`, " +
          "`coordenadorCurso`). Os campos de \"Contato e acessibilidade\" " +
          "(`telefoneCelular`, `whatsapp`, etc.) são comentados no validator como " +
          "intencionalmente editáveis pelo aluno; `ra` e os campos acadêmicos não têm " +
          "esse comentário — não ficou claro, pela leitura do código, se ficarem de fora " +
          "do bloqueio foi intencional. Vale confirmar com quem desenhou essa regra.\n\n" +
          "**Para `ADMINISTRADOR`/`BACKOFFICE`/`TECNICO`: nenhuma restrição de campo ou " +
          "de alvo.** Qualquer um desses 3 papéis pode alterar **qualquer campo** " +
          "(inclusive `papel`) de **qualquer usuário**, inclusive promover outro " +
          "usuário a `ADMINISTRADOR` — mesmo sendo `TECNICO`/`BACKOFFICE`, que não " +
          "conseguem `POST /usuarios/` (só `ADMINISTRADOR` cria). Vale ficar ciente: a " +
          "criação de usuário é restrita a `ADMINISTRADOR`, mas a promoção via PATCH " +
          "não é.\n\n" +
          "**Corpo vazio (`{}`) é uma requisição válida:** não há checagem de \"pelo " +
          "menos um campo deve ser enviado\" — resulta numa atualização que só altera " +
          "`atualizadoEm` (o Prisma executa o `UPDATE` de qualquer forma).\n\n" +
          "**409 aqui é menos específico que no `POST /usuarios/`:** sempre " +
          "`\"Duplicidade (email/RA)\"`, sem indicar qual dos dois colidiu (o `create` " +
          "diferencia \"Email já está em uso\" de \"RA já está em uso\"; o `update` não).",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", minLength: 1, example: "cmj1234567890123456789012" },
          },
        },
        body: {
          type: "object",
          description:
            "Todos os campos são opcionais e independentes entre si (sem `superRefine` " +
            "cruzando campos, ao contrário do `POST`). Os 5 marcados abaixo com 🔒 são " +
            "bloqueados quando quem chama tem papel `USUARIO` — ver descrição do endpoint.",
          properties: {
            nome: { type: "string", minLength: 2, maxLength: 160, example: EXAMPLE_NOME },
            emailPessoal: { type: "string", format: "email" },
            emailEducacional: { type: "string", format: "email", nullable: true },
            ra: { type: "string", maxLength: 32, nullable: true },
            senha: {
              type: "string",
              minLength: 8,
              description: "🔒 Bloqueado para `USUARIO`. Reset de senha por equipe.",
            },
            papel: {
              type: "string",
              enum: ["USUARIO", "BACKOFFICE", "TECNICO", "ADMINISTRADOR"],
              description: "🔒 Bloqueado para `USUARIO`.",
            },
            ativo: { type: "boolean", description: "🔒 Bloqueado para `USUARIO`." },
            anonimizado: { type: "boolean", description: "🔒 Bloqueado para `USUARIO`." },
            organizacaoId: {
              type: "string",
              minLength: 1,
              nullable: true,
              description: "🔒 Bloqueado para `USUARIO`.",
            },
            cursoNome: { type: "string", maxLength: 128, nullable: true },
            cursoSigla: { type: "string", maxLength: 16, nullable: true, example: "DSM" },
            unidadeFatec: { type: "string", maxLength: 128, nullable: true },
            curso: { type: "string", maxLength: 128, nullable: true },
            eixoTecnologico: { type: "string", maxLength: 128, nullable: true },
            turno: { type: "string", maxLength: 64, nullable: true },
            turma: { type: "string", maxLength: 64, nullable: true },
            semestreAtual: { type: "string", maxLength: 32, nullable: true },
            matrizCurricular: { type: "string", maxLength: 128, nullable: true },
            situacaoAcademica: { type: "string", maxLength: 128, nullable: true },
            anoSemestreIngresso: { type: "string", maxLength: 32, nullable: true },
            coordenadorCurso: { type: "string", maxLength: 128, nullable: true },
            telefoneCelular: { type: "string", maxLength: 20, nullable: true },
            whatsapp: { type: "string", maxLength: 20, nullable: true },
            canalPreferencialContato: { type: "string", maxLength: 64, nullable: true },
            melhorPeriodoContato: { type: "string", maxLength: 64, nullable: true },
            necessitaAtendimentoAcessivel: { type: "boolean" },
            tipoAcessibilidade: { type: "string", maxLength: 256, nullable: true },
            observacoesAtendimento: { type: "string", maxLength: 2000, nullable: true },
            notificacoesInApp: { type: "boolean" },
          },
        },
        response: {
          200: {
            description: "Usuário atualizado — estado completo após a alteração.",
            ...UsuarioAdminSchema,
          },
          400: {
            description:
              "Campo enviado fora do schema (tipo errado, string maior que o limite, " +
              "`email` inválido, `papel` fora do enum etc.). Roda **antes** das " +
              "checagens de papel/campo privilegiado — então um `papel` com valor " +
              "inválido dá `400`, não `403`.",
            ...ValidationErrorSchema,
          },
          401: {
            description: "Token de acesso ausente, malformado, inválido ou expirado.",
            ...UnauthorizedErrorSchema,
          },
          403: {
            description:
              "Duas causas possíveis, só para quem chama com papel `USUARIO`: tentar " +
              "editar outro `id` (`Acesso negado`), ou incluir um campo bloqueado no " +
              "corpo (`Campo não permitido: <campo>`).",
            oneOf: [ForbiddenErrorSchema, ForbiddenFieldErrorSchema],
          },
          404: {
            description: "Nenhum usuário com esse `id`.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_USER_NOT_FOUND },
            },
          },
          409: {
            description: "`emailPessoal` ou `ra` já usado por outro usuário.",
            type: "object",
            properties: {
              error: { type: "string", example: "Duplicidade (email/RA)" },
            },
          },
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado ao atualizar. `error` é a mensagem crua da exceção " +
              "(via `errMsg()`), não sanitizada.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
            },
          },
        },
      },
    },
    patch,
  )
  app.delete(
    '/:id',
    {
      preHandler: [app.authenticate, app.authorize(['ADMINISTRADOR'])],
      schema: {
        tags: ["Usuarios"],
        summary: "Remover um usuário (soft delete + anonimização parcial)",
        description:
          "**Só `ADMINISTRADOR`** (mesma restrição do `POST /usuarios/`). Não é um " +
          "`DELETE` de verdade: a linha continua no banco. O que acontece " +
          "(`softDeleteUser` em `users.service.ts`) é: `deletadoEm` recebe a data " +
          "atual, `ativo` vira `false`, `anonimizado` vira `true`, e **alguns** campos " +
          "são sobrescritos:\n" +
          "- `nome` → sempre o literal fixo `\"Usuário Anônimo\"` (igual para todo " +
          "mundo que passa por aqui — não é único por usuário).\n" +
          "- `emailPessoal` → sempre `anonp_<id>@<ANON_EMAIL_DOMAIN>` (com o `id` real " +
          "do usuário, então é único mesmo sem checar o banco).\n" +
          "- `ra` e `emailEducacional` → só são substituídos (`anon_<id>` / " +
          "`anone_<id>@<ANON_EDU_DOMAIN>`) se já tinham algum valor antes; senão " +
          "continuam `null`.\n" +
          "- `telefoneCelular`, `whatsapp`, `observacoesAtendimento` → sempre `null`.\n" +
          "`ANON_EMAIL_DOMAIN`/`ANON_EDU_DOMAIN` são variáveis de ambiente opcionais " +
          "(`anon.local`/`anon.edu.local` por padrão) — ao contrário de " +
          "`DEFAULT_TEMP_PASSWORD`, elas **não** são validadas na subida do servidor " +
          "(não estão em `src/env.ts`), então um valor vazio (`ANON_EMAIL_DOMAIN=\"\"`) " +
          "seria aceito e geraria um e-mail mal formado (`anonp_<id>@`).\n\n" +
          "**⚠️ \"Anonimização\" é parcial — vale saber exatamente o que fica de fora " +
          "antes de tratar isso como LGPD-compliant:**\n" +
          "1. **Nenhum outro campo é limpo.** `cursoNome`, `cursoSigla`, todos os campos " +
          "acadêmicos (`unidadeFatec`, `curso`, `turno`, `turma`, `semestreAtual`, " +
          "`matrizCurricular`, `situacaoAcademica`, `anoSemestreIngresso`, " +
          "`coordenadorCurso`), `canalPreferencialContato`, `melhorPeriodoContato`, " +
          "`organizacaoId`, `papel`, `notificacoesInApp` e, principalmente, " +
          "`necessitaAtendimentoAcessivel`/`tipoAcessibilidade` (dados de saúde/" +
          "acessibilidade) **permanecem exatamente como estavam**, mesmo com " +
          "`anonimizado: true` na resposta.\n" +
          "2. **Os dados originais (não anonimizados) são gravados na tabela de " +
          "auditoria.** `logAuditoria('USUARIO_REMOVIDO_SOFT', ...)` salva `before` " +
          "(o registro completo, com nome/e-mail/telefone reais) dentro de `meta` — " +
          "então a informação que este endpoint tira da tabela `usuarios` continua " +
          "recuperável via a tabela de auditoria.\n\n" +
          "**Idempotente:** chamar de novo num usuário já removido não dá erro — só " +
          "roda a mesma lógica outra vez (reescreve os mesmos valores e atualiza " +
          "`deletadoEm` para o instante atual).\n\n" +
          "**Depois de remover:** o registro some de `GET /usuarios/` (que filtra " +
          "`deletadoEm: null`), mas continua aparecendo normalmente em " +
          "`GET /usuarios/{id}` (que não filtra por `deletadoEm`) — ver observação " +
          "nesse outro endpoint.\n\n" +
          "**Resposta é `200`, não `204`** — o corpo vem com o registro já anonimizado " +
          "(mesmo schema `UsuarioAdmin` dos outros endpoints), não um corpo vazio.",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", minLength: 1, example: "cmj1234567890123456789012" },
          },
        },
        response: {
          200: {
            description:
              "Usuário anonimizado. Note `anonimizado: true`, `ativo: false`, " +
              "`deletadoEm` preenchido, `nome: \"Usuário Anônimo\"` e `emailPessoal` no " +
              "padrão `anonp_<id>@...` — mas os demais campos (ver descrição acima) " +
              "não mudam.",
            ...UsuarioAdminSchema,
          },
          400: {
            description:
              "`id` fora do schema (string vazia) — na prática inatingível por esta " +
              "rota, mesma observação do `GET /usuarios/{id}`.",
            ...ValidationErrorSchema,
          },
          401: {
            description: "Token de acesso ausente, malformado, inválido ou expirado.",
            ...UnauthorizedErrorSchema,
          },
          403: {
            description: "Autenticado, mas papel diferente de `ADMINISTRADOR`.",
            ...ForbiddenErrorSchema,
          },
          404: {
            description: "Nenhum usuário com esse `id`.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_USER_NOT_FOUND },
            },
          },
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado ao remover. `error` é a mensagem crua da exceção (via " +
              "`errMsg()`), não sanitizada. Não há `409` possível aqui: o e-mail " +
              "anonimizado usa o `id` do próprio usuário, então nunca colide com outro " +
              "registro.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
            },
          },
        },
      },
    },
    removeSoft,
  )
}
