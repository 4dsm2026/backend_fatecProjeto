import type { FastifyInstance } from "fastify";
import { create, getOne, list, patch, removeSoft, stats } from "./tickets.controller.js";
import { ticketMessagesRoutes } from "../ticket-messages/messages.routes.js";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";

// ===================== Constantes reutilizáveis =====================

const EXAMPLE_TICKET_ID = "cmj1234567890123456789012";
const EXAMPLE_USER_ID = "cmjabcdefghij0123456789ab";
const EXAMPLE_PROTOCOLO = "TCK-A1B2C3";
const EXAMPLE_RAW_DB_ERROR = "Connection lost: The server closed the connection.";

// ===================== Fragmentos reutilizáveis de schema =====================

// Corpo devolvido por formatZodError (src/utils/zod-helpers.ts) quando o
// preHandler rejeita o body/params/query por falha de schema Zod.
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
          path: { type: "string", example: "titulo" },
          message: { type: "string", example: "Mínimo de 3 caracteres" },
          code: { type: "string", example: "too_small" },
        },
      },
    },
  },
} as const;

// Corpo exato enviado por src/plugins/auth-verify.ts quando o token de acesso
// está ausente, malformado, inválido ou expirado.
const UnauthorizedErrorSchema = {
  type: "object",
  title: "ErroNaoAutorizado",
  properties: {
    error: { type: "string", example: "Não autorizado" },
  },
} as const;

// Corpo enviado por requireAuthUser nos controllers quando o token passa na
// verificação de assinatura mas não tem a claim `sub` (praticamente inatingível).
const SelfCheckUnauthenticatedSchema = {
  type: "object",
  title: "ErroNaoAutenticado",
  properties: {
    error: { type: "string", example: "Não autenticado" },
  },
} as const;

// 401 combinado — auth-verify + checagem própria do handler.
const Unauthorized401WithSelfCheck = {
  description:
    "Token ausente, malformado, inválido ou expirado — verificado pelo " +
    "preHandler `app.authenticate` (`{ error: \"Não autorizado\" }`, o caso " +
    "comum) — OU token sintaticamente válido mas sem a claim `sub` no " +
    "payload — checagem redundante feita pelo próprio handler " +
    "(`{ error: \"Não autenticado\" }`, praticamente inatingível em uso " +
    "normal, já que todo token emitido por este backend sempre inclui `sub`).",
  oneOf: [UnauthorizedErrorSchema, SelfCheckUnauthenticatedSchema],
} as const;

// Rate limit global (100 req/min por IP) — @fastify/rate-limit.
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

// 404 genérico para chamado não encontrado (ou sem acesso para USUARIO).
const NotFoundChamadoResponse = {
  description:
    "Chamado não encontrado. Retornado tanto quando o ID não existe no banco " +
    "(ou foi soft-deletado) quanto quando um aluno (papel `USUARIO`) tenta " +
    "acessar um chamado de outro usuário — a mesma resposta 404 é usada em " +
    "ambos os cenários para não vazar a existência do recurso (anti-IDOR). " +
    "Também retornado quando o Prisma lança `P2025` (registro requerido " +
    "não encontrado) em operações de update/delete.",
  type: "object",
  properties: {
    error: { type: "string", example: "Chamado não encontrado" },
  },
} as const;

// 403 para rotas restritas por authorize() — ex.: GET /tickets/stats.
const ForbiddenResponse = {
  description:
    "Acesso negado por papel insuficiente. O preHandler `app.authorize([...])` " +
    "rejeitou a requisição porque o `papel` do usuário autenticado não está " +
    "na lista de papéis permitidos para esta rota. Corpo exato definido em " +
    "src/plugins/auth-verify.ts.",
  type: "object",
  properties: {
    error: { type: "string", example: "Acesso negado" },
  },
} as const;

// Schema parcial reutilizável de um chamado (campos retornados pela maioria das operações).
const TicketBaseSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    id: { type: "string", example: EXAMPLE_TICKET_ID },
    protocolo: { type: "string", example: EXAMPLE_PROTOCOLO },
    titulo: { type: "string", example: "Problema com acesso ao SIGA" },
    descricao: { type: "string", example: "Não consigo acessar o sistema acadêmico desde ontem" },
    status: {
      type: "string",
      enum: ["ABERTO", "EM_ATENDIMENTO", "AGUARDANDO_USUARIO", "RESOLVIDO", "ENCERRADO"],
      example: "ABERTO",
    },
    prioridade: {
      type: "string",
      enum: ["BAIXA", "MEDIA", "ALTA", "URGENTE"],
      example: "MEDIA",
    },
    nivel: {
      type: "string",
      enum: ["N1", "N2", "N3"],
      example: "N1",
    },
    servicoId: { type: "string", nullable: true },
    setorId: { type: "string", nullable: true },
    clienteId: { type: "string", nullable: true },
    contratoId: { type: "string", nullable: true },
    responsavelId: { type: "string", nullable: true },
    organizacaoId: { type: "string", nullable: true },
    criadoPorId: { type: "string", example: EXAMPLE_USER_ID },
    catalogoServicoId: { type: "string", nullable: true },
    catalogoCategoriaId: { type: "string", nullable: true },
    catalogoCategoriaNome: { type: "string", nullable: true },
    setorProvavel: { type: "string", nullable: true },
    dadosAcademicos: { type: "object", nullable: true, additionalProperties: true },
    camposEspecificos: { type: "object", nullable: true, additionalProperties: true },
    origem: { type: "string", nullable: true },
    precisaAcaoDoAluno: { type: "boolean", example: false },
    encerradoEm: { type: "string", format: "date-time", nullable: true },
    deletadoEm: { type: "string", format: "date-time", nullable: true },
    criadoEm: { type: "string", format: "date-time" },
    atualizadoEm: { type: "string", format: "date-time" },
  },
} as const;

export async function ticketsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate as any);

  // Faz com que o `schema` das rotas abaixo sirva só para o @fastify/swagger
  // gerar a documentação — a validação real continua 100% via Zod (preHandler).
  useDocsOnlySchemas(app);

  // GET /tickets/stats  — deve vir ANTES de /:id para não ser interceptado como param
  // Estatísticas globais são de equipe; aluno (USUARIO) não acessa.
  app.get(
    "/stats",
    {
      preHandler: (app as any).authorize(["ADMINISTRADOR", "BACKOFFICE", "TECNICO"]),
      schema: {
        tags: ["Tickets"],
        summary: "Obter estatísticas agregadas de chamados",
        description:
          "Retorna métricas e agregações globais de chamados: total por status, " +
          "por nível, por prioridade, por setor, por responsável, tempo médio de " +
          "resolução (TTR), percentual resolvido no prazo (SLA), e tendência dos " +
          "últimos 7 dias.\n\n" +
          "**Restrição de papel:** somente `ADMINISTRADOR`, `BACKOFFICE` e " +
          "`TECNICO` podem acessar. Alunos (`USUARIO`) recebem `403`.\n\n" +
          "**Filtro opcional por organização:** se `organizacaoId` for informado " +
          "como query parameter, todas as agregações são filtradas para aquela " +
          "organização. Caso contrário, considera todos os chamados não deletados.",
        querystring: {
          type: "object",
          properties: {
            organizacaoId: {
              type: "string",
              description:
                "ID da organização para filtrar as estatísticas. Se omitido, " +
                "retorna estatísticas de TODOS os chamados.",
            },
          },
        },
        response: {
          200: {
            description:
              "Estatísticas calculadas com sucesso. Todos os campos numéricos " +
              "consideram apenas chamados com `deletadoEm = null`.",
            type: "object",
            additionalProperties: true,
            properties: {
              total: {
                type: "integer",
                description: "Total de chamados não deletados (soma de todos os status).",
                example: 142,
              },
              porStatus: {
                type: "object",
                description: "Contagem de chamados por cada status possível.",
                properties: {
                  ABERTO: { type: "integer", example: 45 },
                  EM_ATENDIMENTO: { type: "integer", example: 30 },
                  AGUARDANDO_USUARIO: { type: "integer", example: 12 },
                  RESOLVIDO: { type: "integer", example: 35 },
                  ENCERRADO: { type: "integer", example: 20 },
                },
              },
              porNivel: {
                type: "object",
                description: "Contagem por nível de suporte.",
                properties: {
                  N1: { type: "integer", example: 80 },
                  N2: { type: "integer", example: 45 },
                  N3: { type: "integer", example: 17 },
                },
              },
              porPrioridade: {
                type: "object",
                description: "Contagem por prioridade.",
                properties: {
                  BAIXA: { type: "integer", example: 20 },
                  MEDIA: { type: "integer", example: 60 },
                  ALTA: { type: "integer", example: 40 },
                  URGENTE: { type: "integer", example: 22 },
                },
              },
              porSetor: {
                type: "array",
                description: "Contagem de chamados agrupados por setor, ordenados do mais para o menos.",
                items: {
                  type: "object",
                  properties: {
                    setorId: { type: "string", nullable: true },
                    setorNome: { type: "string", example: "Secretaria Acadêmica" },
                    total: { type: "integer", example: 35 },
                  },
                },
              },
              porResponsavel: {
                type: "array",
                description: "Contagem de chamados agrupados por responsável.",
                items: {
                  type: "object",
                  properties: {
                    responsavelId: { type: "string", nullable: true },
                    responsavelNome: { type: "string", example: "Maria Silva" },
                    total: { type: "integer", example: 28 },
                  },
                },
              },
              ttrMedioHoras: {
                type: "number",
                description: "Tempo médio de resolução em horas (chamados RESOLVIDO + ENCERRADO).",
                example: 48.5,
              },
              slaMedioDias: {
                type: "number",
                description: "SLA médio em dias (ttrMedioHoras / 24).",
                example: 2.02,
              },
              pctNoPrazo: {
                type: "integer",
                description:
                  "Percentual (0–100) de chamados encerrados dentro do prazo de SLA " +
                  "(apenas os que possuem `vencimentoSla`).",
                example: 85,
              },
              pctResolvidos: {
                type: "integer",
                description: "Percentual (0–100) de chamados resolvidos ou encerrados sobre o total.",
                example: 39,
              },
              tendencia7dias: {
                type: "array",
                description: "Chamados criados por dia nos últimos 7 dias.",
                items: {
                  type: "object",
                  properties: {
                    dia: { type: "string", format: "date", example: "2026-09-30" },
                    total: { type: "integer", example: 5 },
                  },
                },
              },
              atualizadoEm: {
                type: "string",
                format: "date-time",
                description: "Timestamp do momento em que as estatísticas foram calculadas.",
              },
            },
          },
          401: Unauthorized401WithSelfCheck,
          403: ForbiddenResponse,
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado ao computar estatísticas. `error` é a mensagem crua " +
              "da exceção (via `errMsg()`), não sanitizada — pode conter detalhes " +
              "internos do banco de dados.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
            },
          },
        },
      },
    },
    stats,
  );

  // GET /tickets
  app.get(
    "/",
    {
      schema: {
        tags: ["Tickets"],
        summary: "Listar chamados (paginado, com filtros)",
        description:
          "Retorna uma lista paginada de chamados. Suporta filtros por status, " +
          "nível, prioridade, setor, serviço, cliente, contrato, responsável, " +
          "organização, data de criação e busca textual (título, descrição ou protocolo).\n\n" +
          "**Regra de acesso por papel:**\n" +
          "- **Aluno (`USUARIO`):** vê apenas os próprios chamados — o filtro " +
          "`criadoPorId` é forçado para o `sub` do token, independentemente do " +
          "valor enviado na query.\n" +
          "- **Equipe (`BACKOFFICE`, `TECNICO`, `ADMINISTRADOR`):** vê todos os " +
          "chamados, podendo filtrar por `criadoPorId` livremente.\n\n" +
          "**Chamados soft-deletados:** são automaticamente excluídos da listagem " +
          "(`deletadoEm = null` é sempre adicionado ao WHERE).\n\n" +
          "**Inclusão de relações:** use o parâmetro `include` para incluir dados " +
          "relacionados (cliente, contrato, servico, setor, responsavel, criadoPor, " +
          "historico). Pode ser um array ou string separada por vírgula.",
        querystring: {
          type: "object",
          properties: {
            page: {
              type: "integer", minimum: 1, default: 1,
              description: "Número da página (1-indexed).",
            },
            pageSize: {
              type: "integer", minimum: 1, maximum: 100, default: 20,
              description: "Itens por página. Máximo: 100.",
            },
            search: {
              type: "string",
              description: "Busca textual por título, descrição ou protocolo (contains).",
            },
            status: {
              oneOf: [
                { type: "string", enum: ["ABERTO", "EM_ATENDIMENTO", "AGUARDANDO_USUARIO", "RESOLVIDO", "ENCERRADO"] },
                { type: "array", items: { type: "string", enum: ["ABERTO", "EM_ATENDIMENTO", "AGUARDANDO_USUARIO", "RESOLVIDO", "ENCERRADO"] } },
              ],
              description: "Filtrar por status (único ou array para IN).",
            },
            nivel: {
              oneOf: [
                { type: "string", enum: ["N1", "N2", "N3"] },
                { type: "array", items: { type: "string", enum: ["N1", "N2", "N3"] } },
              ],
              description: "Filtrar por nível (único ou array para IN).",
            },
            prioridade: {
              oneOf: [
                { type: "string", enum: ["BAIXA", "MEDIA", "ALTA", "URGENTE"] },
                { type: "array", items: { type: "string", enum: ["BAIXA", "MEDIA", "ALTA", "URGENTE"] } },
              ],
              description: "Filtrar por prioridade (único ou array para IN).",
            },
            clienteId: { type: "string", description: "Filtrar por ID do cliente." },
            contratoId: { type: "string", description: "Filtrar por ID do contrato." },
            setorId: { type: "string", description: "Filtrar por ID do setor." },
            servicoId: { type: "string", description: "Filtrar por ID do serviço." },
            responsavelId: { type: "string", description: "Filtrar por ID do responsável." },
            organizacaoId: { type: "string", description: "Filtrar por ID da organização." },
            criadoPorId: {
              type: "string",
              description:
                "Filtrar por ID do criador. **Para alunos (USUARIO), este campo é " +
                "forçado para o ID do próprio usuário, ignorando o valor enviado.**",
            },
            criadoDe: {
              type: "string", format: "date-time",
              description: "Data mínima de criação (inclusive).",
            },
            criadoAte: {
              type: "string", format: "date-time",
              description: "Data máxima de criação (inclusive).",
            },
            orderBy: {
              type: "string",
              enum: ["criadoEm", "atualizadoEm"],
              default: "criadoEm",
              description: "Campo de ordenação.",
            },
            orderDir: {
              type: "string",
              enum: ["asc", "desc"],
              default: "desc",
              description: "Direção da ordenação.",
            },
            include: {
              type: "string",
              description:
                "Relações a incluir. Valores aceitos: `cliente`, `contrato`, `servico`, " +
                "`setor`, `responsavel`, `criadoPor`, `historico`. Separar por vírgula ou " +
                "enviar múltiplos parâmetros `include=X&include=Y`.",
              example: "setor,criadoPor",
            },
          },
        },
        response: {
          200: {
            description: "Lista paginada de chamados retornada com sucesso.",
            type: "object",
            additionalProperties: true,
            properties: {
              total: { type: "integer", description: "Total de chamados que correspondem aos filtros.", example: 87 },
              page: { type: "integer", description: "Página atual.", example: 1 },
              pageSize: { type: "integer", description: "Itens por página.", example: 20 },
              items: {
                type: "array",
                description: "Chamados da página atual.",
                items: TicketBaseSchema,
              },
            },
          },
          400: {
            description:
              "Query string inválida — ex.: `page` negativo, `pageSize` > 100, " +
              "`status` com valor não reconhecido, `nivel` inválido, etc.",
            ...ValidationErrorSchema,
          },
          401: Unauthorized401WithSelfCheck,
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado ao listar tickets. Diferente dos demais 500 de " +
              "tickets: aqui a mensagem é FIXA (`\"Erro interno ao listar tickets\"`), " +
              "não a mensagem crua da exceção.",
            type: "object",
            properties: {
              error: { type: "string", example: "Erro interno ao listar tickets" },
            },
          },
        },
      },
    },
    list,
  );

  // POST /tickets
  app.post(
    "/",
    {
      schema: {
        tags: ["Tickets"],
        summary: "Criar um novo chamado (ticket)",
        description:
          "Cria um novo chamado no sistema. Um protocolo único no formato `TCK-XXXXXX` " +
          "(6 hex) é gerado automaticamente.\n\n" +
          "**Resolução automática de relações:**\n" +
          "- Se `servicoId` contiver um hífen (slug de catálogo, ex.: " +
          "`secretaria-declaracao-matricula`), ele é armazenado como " +
          "`catalogoServicoId` e o `servicoId` do banco fica `null`.\n" +
          "- Se nenhum `setorId` válido (CUID) for informado mas " +
          "`setorProvavel` existir, o sistema tenta resolver o setor por " +
          "nome (busca parcial na tabela `setor`).\n\n" +
          "**Campos específicos por serviço:** para determinados `servicoId`/" +
          "`catalogoServicoId` do catálogo acadêmico, campos obrigatórios " +
          "adicionais são exigidos dentro de `camposEspecificos` (ver " +
          "`CAMPOS_OBRIGATORIOS_POR_SERVICO` em validators/tickets.ts). " +
          "Se ausentes, retorna `400` com issues indicando cada campo faltante.\n\n" +
          "**Efeitos colaterais:** ao criar, um registro em `historicoStatusChamado` " +
          "é inserido (de `null` para `ABERTO`) e notificações são enviadas " +
          "ao criador, responsável (se houver) e membros do setor.",
        body: {
          type: "object",
          required: ["titulo", "descricao"],
          properties: {
            titulo: {
              type: "string", minLength: 3,
              description: "Título do chamado (mínimo 3 caracteres).",
              example: "Problema com acesso ao SIGA",
            },
            descricao: {
              type: "string", minLength: 3,
              description: "Descrição detalhada do chamado (mínimo 3 caracteres).",
              example: "Não consigo acessar o sistema acadêmico desde ontem às 14h.",
            },
            prioridade: {
              type: "string",
              enum: ["BAIXA", "MEDIA", "ALTA", "URGENTE"],
              default: "MEDIA",
              description: "Prioridade do chamado. Se omitido, assume `MEDIA`.",
            },
            nivel: {
              type: "string",
              enum: ["N1", "N2", "N3"],
              default: "N1",
              description: "Nível de suporte. Se omitido, assume `N1`.",
            },
            servicoId: { type: "string", nullable: true, description: "ID do serviço (CUID do banco) ou slug do catálogo." },
            setorId: { type: "string", nullable: true, description: "ID do setor (CUID). Se slug, é ignorado." },
            clienteId: { type: "string", nullable: true, description: "ID do cliente." },
            contratoId: { type: "string", nullable: true, description: "ID do contrato." },
            responsavelId: { type: "string", nullable: true, description: "ID do responsável." },
            organizacaoId: { type: "string", nullable: true, description: "ID da organização." },
            catalogoServicoId: { type: "string", nullable: true, description: "Slug do serviço do catálogo acadêmico." },
            catalogoCategoriaId: { type: "string", nullable: true, description: "Slug da categoria do catálogo." },
            catalogoCategoriaNome: { type: "string", nullable: true, description: "Nome da categoria do catálogo." },
            categoriaId: { type: "string", nullable: true, description: "Alias de catalogoCategoriaId (enviado pelo wizard do frontend)." },
            categoriaNome: { type: "string", nullable: true, description: "Alias de catalogoCategoriaNome." },
            setorProvavel: {
              type: "string", maxLength: 256, nullable: true,
              description: "Texto livre que o sistema usa para tentar resolver o setor automaticamente.",
            },
            dadosAcademicos: { type: "object", nullable: true, additionalProperties: true, description: "Dados acadêmicos do aluno preenchidos pelo wizard." },
            camposEspecificos: {
              type: "object", nullable: true, additionalProperties: true,
              description:
                "Campos específicos do serviço selecionado. Para certos servicoId, " +
                "campos obrigatórios são exigidos aqui (validados via superRefine).",
            },
            origem: { type: "string", maxLength: 64, nullable: true, description: "Origem do chamado (ex.: 'catalogo', 'manual')." },
            precisaAcaoDoAluno: { type: "boolean", description: "Indica se o chamado precisa de ação do aluno." },
            anexos: {
              type: "array", nullable: true,
              description: "Metadados de anexos (não é o upload em si — ver POST /tickets/:id/anexos).",
              items: {
                type: "object",
                properties: {
                  nome: { type: "string", example: "documento.pdf" },
                  tamanho: { type: "number", example: 1048576 },
                  tipo: { type: "string", example: "application/pdf" },
                },
              },
            },
          },
        },
        response: {
          201: {
            description:
              "Chamado criado com sucesso. Retorna o chamado completo com relações " +
              "`servico` e `criadoPor` incluídas. O protocolo (ex.: `TCK-A1B2C3`) é " +
              "gerado automaticamente e é único no sistema.",
            ...TicketBaseSchema,
          },
          400: {
            description:
              "Corpo inválido. Possíveis causas:\n" +
              "- `titulo` ausente ou com menos de 3 caracteres.\n" +
              "- `descricao` ausente ou com menos de 3 caracteres.\n" +
              "- Campo obrigatório em `camposEspecificos` ausente para o " +
              "`catalogoServicoId`/`servicoId` informado (validação por `superRefine`).\n" +
              "- Tipo de dado inválido em qualquer campo.",
            ...ValidationErrorSchema,
          },
          401: Unauthorized401WithSelfCheck,
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado ao criar o chamado. Pode incluir falha na geração " +
              "do protocolo único (após 5 tentativas) ou erro de banco. `error` é " +
              "a mensagem crua da exceção (via `errMsg()`), não sanitizada.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
            },
          },
        },
      },
    },
    create,
  );

  // GET /tickets/:id
  app.get(
    "/:id",
    {
      schema: {
        tags: ["Tickets"],
        summary: "Obter detalhes de um chamado por ID",
        description:
          "Retorna um chamado específico com todas as relações incluídas: " +
          "`cliente`, `contrato`, `servico`, `setor`, `responsavel`, `criadoPor`, " +
          "`historico` (com dados do usuário que fez a ação) e `mensagens` " +
          "(com dados do autor).\n\n" +
          "**Regra de acesso anti-IDOR:** alunos (papel `USUARIO`) só conseguem " +
          "acessar os próprios chamados. Se tentar acessar um chamado de outro " +
          "aluno, recebe `404` (não `403`) — para não vazar a existência do recurso.\n\n" +
          "**Chamados soft-deletados** (`deletadoEm` não nulo) também retornam `404`.",
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: {
              type: "string", minLength: 1,
              description: "ID do chamado (CUID gerado pelo Prisma).",
              example: EXAMPLE_TICKET_ID,
            },
          },
        },
        response: {
          200: {
            description:
              "Chamado encontrado e retornado com sucesso, incluindo relações, " +
              "histórico de status e mensagens.",
            type: "object",
            additionalProperties: true,
            properties: {
              ...TicketBaseSchema.properties,
              setor: {
                type: "object", nullable: true, additionalProperties: true,
                description: "Dados do setor vinculado ao chamado.",
                properties: {
                  id: { type: "string" },
                  nome: { type: "string", example: "Secretaria Acadêmica" },
                },
              },
              criadoPor: {
                type: "object", nullable: true, additionalProperties: true,
                description: "Dados do usuário que criou o chamado.",
                properties: {
                  id: { type: "string" },
                  nome: { type: "string", example: "João Silva" },
                  emailPessoal: { type: "string", format: "email" },
                },
              },
              responsavel: {
                type: "object", nullable: true, additionalProperties: true,
                description: "Dados do responsável pelo chamado.",
                properties: {
                  id: { type: "string" },
                  nome: { type: "string", example: "Maria Atendente" },
                },
              },
              mensagens: {
                type: "array",
                description: "Mensagens do chamado, ordenadas por data de criação (asc).",
                items: {
                  type: "object",
                  additionalProperties: true,
                  properties: {
                    id: { type: "string" },
                    conteudo: { type: "string" },
                    criadoEm: { type: "string", format: "date-time" },
                    autor: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        nome: { type: "string" },
                        emailPessoal: { type: "string", format: "email" },
                      },
                    },
                  },
                },
              },
              historico: {
                type: "array",
                description: "Histórico de alterações de status, ordenado por data (desc).",
                items: {
                  type: "object",
                  additionalProperties: true,
                  properties: {
                    id: { type: "string" },
                    de: { type: "string", nullable: true, example: "ABERTO" },
                    para: { type: "string", example: "EM_ATENDIMENTO" },
                    observacao: { type: "string", nullable: true },
                    criadoEm: { type: "string", format: "date-time" },
                    porUsuario: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        nome: { type: "string" },
                        emailPessoal: { type: "string", format: "email" },
                      },
                    },
                  },
                },
              },
            },
          },
          400: {
            description: "Parâmetro `id` ausente ou vazio.",
            ...ValidationErrorSchema,
          },
          401: Unauthorized401WithSelfCheck,
          404: NotFoundChamadoResponse,
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado ao buscar o chamado. `error` é a mensagem crua " +
              "da exceção (via `errMsg()`), não sanitizada.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
            },
          },
        },
      },
    },
    getOne,
  );

  // PATCH /tickets/:id
  app.patch(
    "/:id",
    {
      schema: {
        tags: ["Tickets"],
        summary: "Atualizar parcialmente um chamado",
        description:
          "Atualiza um ou mais campos de um chamado existente (partial update). " +
          "Pelo menos um campo deve ser informado no body — enviar body vazio " +
          "retorna `400`.\n\n" +
          "**Regra de acesso anti-IDOR:** igual a `GET /tickets/:id` — alunos " +
          "só podem atualizar os próprios chamados; tentar atualizar de outro " +
          "aluno resulta em `404`.\n\n" +
          "**Mudança de status:** se o campo `status` for alterado:\n" +
          "- Um registro em `historicoStatusChamado` é criado automaticamente.\n" +
          "- Notificações são enviadas aos envolvidos (criador, responsável, " +
          "membros do setor).\n" +
          "- Se o novo status for `RESOLVIDO` ou `ENCERRADO`, `encerradoEm` é " +
          "preenchido automaticamente com a data/hora atual.\n\n" +
          "**Atribuição de responsável:** se `responsavelId` mudar, uma notificação " +
          "de `CHAMADO_ATRIBUIDO` é enviada ao novo responsável.\n\n" +
          "**Campos de SLA:** `slaHoras`, `slaDias` e `vencimentoSla` podem ser " +
          "informados para configurar prazos de atendimento.",
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: {
              type: "string", minLength: 1,
              description: "ID do chamado a ser atualizado.",
              example: EXAMPLE_TICKET_ID,
            },
          },
        },
        body: {
          type: "object",
          description:
            "Pelo menos um campo deve ser informado. Todos os campos são opcionais " +
            "individualmente, mas o body não pode ser vazio.",
          properties: {
            titulo: { type: "string", minLength: 3, description: "Novo título (mín. 3 caracteres)." },
            descricao: { type: "string", minLength: 3, description: "Nova descrição (mín. 3 caracteres)." },
            prioridade: {
              type: "string",
              enum: ["BAIXA", "MEDIA", "ALTA", "URGENTE"],
              description: "Nova prioridade.",
            },
            nivel: {
              type: "string",
              enum: ["N1", "N2", "N3"],
              description: "Novo nível de suporte.",
            },
            status: {
              type: "string",
              enum: ["ABERTO", "EM_ATENDIMENTO", "AGUARDANDO_USUARIO", "RESOLVIDO", "ENCERRADO"],
              description:
                "Novo status. Mudar o status gera histórico e notificações automáticas.",
            },
            servicoId: { type: "string", nullable: true, description: "Novo ID do serviço." },
            setorId: { type: "string", nullable: true, description: "Novo ID do setor." },
            clienteId: { type: "string", nullable: true, description: "Novo ID do cliente." },
            contratoId: { type: "string", nullable: true, description: "Novo ID do contrato." },
            responsavelId: { type: "string", nullable: true, description: "Novo ID do responsável." },
            organizacaoId: { type: "string", nullable: true, description: "Novo ID da organização." },
            precisaAcaoDoAluno: { type: "boolean", description: "Atualizar flag de ação pendente do aluno." },
            observacaoInterna: { type: "string", maxLength: 4000, nullable: true, description: "Observação interna (visível apenas para equipe)." },
            slaHoras: { type: "integer", minimum: 1, nullable: true, description: "SLA em horas." },
            slaDias: { type: "integer", minimum: 1, nullable: true, description: "SLA em dias." },
            vencimentoSla: { type: "string", format: "date-time", nullable: true, description: "Data/hora de vencimento do SLA." },
          },
        },
        response: {
          200: {
            description: "Chamado atualizado com sucesso. Retorna o registro completo atualizado.",
            ...TicketBaseSchema,
          },
          400: {
            description:
              "Body inválido. Possíveis causas:\n" +
              "- Nenhum campo informado no body (body vazio ou todos `undefined`).\n" +
              "- `titulo` ou `descricao` com menos de 3 caracteres.\n" +
              "- `status`, `prioridade` ou `nivel` com valor fora do enum.\n" +
              "- `slaHoras` ou `slaDias` não inteiro ou negativo.\n" +
              "- `observacaoInterna` com mais de 4000 caracteres.\n" +
              "- Parâmetro `id` ausente ou vazio.",
            ...ValidationErrorSchema,
          },
          401: Unauthorized401WithSelfCheck,
          404: NotFoundChamadoResponse,
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado ao atualizar o chamado. `error` é a mensagem crua " +
              "da exceção (via `errMsg()`), não sanitizada.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
            },
          },
        },
      },
    },
    patch,
  );

  // DELETE /tickets/:id
  app.delete(
    "/:id",
    {
      schema: {
        tags: ["Tickets"],
        summary: "Remover um chamado (soft delete)",
        description:
          "Realiza soft delete no chamado — preenche `deletadoEm` com a data/hora " +
          "atual, sem excluir o registro do banco. O chamado deixa de aparecer em " +
          "listagens e buscas (filtrados por `deletadoEm = null`).\n\n" +
          "**Regra de acesso anti-IDOR:** mesma regra de `GET /tickets/:id` — " +
          "alunos só podem deletar os próprios chamados.\n\n" +
          "**Auditoria:** um registro de auditoria (`DELETE_SOFT_CHAMADO`) é " +
          "criado como efeito colateral assíncrono (fire-and-forget). Se falhar, " +
          "o delete ainda é concluído normalmente.\n\n" +
          "**Sem reversão via API:** não existe endpoint para reverter um soft " +
          "delete — o campo `deletadoEm` só pode ser limpo diretamente no banco.",
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: {
              type: "string", minLength: 1,
              description: "ID do chamado a ser soft-deletado.",
              example: EXAMPLE_TICKET_ID,
            },
          },
        },
        response: {
          200: {
            description:
              "Chamado soft-deletado com sucesso. Retorna o registro atualizado com " +
              "`deletadoEm` preenchido.",
            ...TicketBaseSchema,
          },
          400: {
            description: "Parâmetro `id` ausente ou vazio.",
            ...ValidationErrorSchema,
          },
          401: Unauthorized401WithSelfCheck,
          404: NotFoundChamadoResponse,
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado ao remover (soft) o chamado. `error` é a mensagem crua " +
              "da exceção (via `errMsg()`), não sanitizada.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
            },
          },
        },
      },
    },
    removeSoft,
  );

  app.register(ticketMessagesRoutes, { prefix: "" });
}
