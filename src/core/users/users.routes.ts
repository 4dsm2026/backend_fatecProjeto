import type { FastifyInstance } from "fastify";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";
import {
  USER_ADMIN_ROLES,
  USER_AUTHENTICATED_ROLES,
  USER_STAFF_ROLES,
} from "./users.types";
import { create, getOne, list, patch, removeSoft } from "./users.controller";

const LinkSchema = {
  type: "object",
  required: ["href"],
  properties: {
    href: { type: "string", example: "/users/user-1" },
    method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
    title: { type: "string" },
    name: { type: "string" },
  },
} as const;

const LinksSchema = {
  type: "object",
  additionalProperties: {
    oneOf: [LinkSchema, { type: "array", items: LinkSchema }],
  },
} as const;

const ProblemSchema = {
  type: "object",
  required: ["type", "title", "status", "instance"],
  properties: {
    type: { type: "string", example: "/errors/not-found" },
    title: { type: "string", example: "Usuário não encontrado" },
    status: { type: "integer", example: 404 },
    detail: { type: "string" },
    instance: { type: "string", example: "/users/user-1" },
    errors: {
      type: "array",
      items: {
        type: "object",
        required: ["field", "message"],
        properties: {
          field: { type: "string", example: "body.nome" },
          message: { type: "string", example: "Nome é obrigatório." },
        },
      },
    },
  },
} as const;

const UserPropertiesSchema = {
  id: { type: "string" },
  organizacaoId: { type: "string", nullable: true },
  nome: { type: "string" },
  emailPessoal: { type: "string", format: "email" },
  emailEducacional: { type: "string", format: "email", nullable: true },
  ra: { type: "string", nullable: true },
  cursoNome: { type: "string", nullable: true },
  cursoSigla: { type: "string", nullable: true },
  papel: { type: "string", enum: ["USUARIO", "BACKOFFICE", "TECNICO", "ADMINISTRADOR"] },
  ativo: { type: "boolean" },
  anonimizado: { type: "boolean" },
  criadoEm: { type: "string", format: "date-time" },
  atualizadoEm: { type: "string", format: "date-time" },
  deletadoEm: { type: "string", format: "date-time", nullable: true },
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
  necessitaAtendimentoAcessivel: { type: "boolean" },
  tipoAcessibilidade: { type: "string", nullable: true },
  observacoesAtendimento: { type: "string", nullable: true },
  notificacoesInApp: { type: "boolean" },
} as const;

const UserResourceSchema = {
  type: "object",
  required: ["id", "_links"],
  properties: {
    ...UserPropertiesSchema,
    _links: LinksSchema,
  },
} as const;

const UsersCollectionSchema = {
  type: "object",
  required: ["_embedded", "page", "_links"],
  properties: {
    _embedded: {
      type: "object",
      required: ["users"],
      properties: {
        users: { type: "array", items: UserResourceSchema },
      },
    },
    page: {
      type: "object",
      required: ["size", "number", "totalElements", "totalPages"],
      properties: {
        size: { type: "integer", example: 20 },
        number: { type: "integer", example: 0 },
        totalElements: { type: "integer", example: 137 },
        totalPages: { type: "integer", example: 7 },
      },
    },
    _links: LinksSchema,
  },
} as const;

const UserCreateBodySchema = {
  type: "object",
  required: ["nome"],
  properties: {
    nome: { type: "string", minLength: 2, maxLength: 160 },
    ra: { type: "string", maxLength: 32, nullable: true },
    emailPessoal: { type: "string", format: "email" },
    emailEducacional: { type: "string", format: "email", nullable: true },
    senha: { type: "string", minLength: 8 },
    papel: { type: "string", enum: ["USUARIO", "BACKOFFICE", "TECNICO", "ADMINISTRADOR"] },
    ativo: { type: "boolean" },
    organizacaoId: { type: "string", nullable: true },
    cursoNome: { type: "string", nullable: true },
    cursoSigla: { type: "string", nullable: true },
    unidadeFatec: { type: "string", nullable: true },
    turno: { type: "string", nullable: true },
    turma: { type: "string", nullable: true },
    semestreAtual: { type: "string", nullable: true },
    anoSemestreIngresso: { type: "string", nullable: true },
  },
} as const;

const UserUpdateBodySchema = {
  type: "object",
  properties: {
    ...UserCreateBodySchema.properties,
    anonimizado: { type: "boolean" },
    curso: { type: "string", nullable: true },
    eixoTecnologico: { type: "string", nullable: true },
    matrizCurricular: { type: "string", nullable: true },
    situacaoAcademica: { type: "string", nullable: true },
    coordenadorCurso: { type: "string", nullable: true },
    telefoneCelular: { type: "string", nullable: true },
    whatsapp: { type: "string", nullable: true },
    canalPreferencialContato: { type: "string", nullable: true },
    melhorPeriodoContato: { type: "string", nullable: true },
    necessitaAtendimentoAcessivel: { type: "boolean" },
    tipoAcessibilidade: { type: "string", nullable: true },
    observacoesAtendimento: { type: "string", nullable: true },
    notificacoesInApp: { type: "boolean" },
  },
} as const;

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", minLength: 1 } },
} as const;

const security = [{ bearerAuth: [] }];
const errorResponses = {
  400: { description: "Dados de entrada inválidos.", ...ProblemSchema },
  401: { description: "Token ausente, inválido ou expirado.", ...ProblemSchema },
  403: { description: "Papel ou proprietário sem permissão para a ação.", ...ProblemSchema },
  404: { description: "Usuário não encontrado.", ...ProblemSchema },
  409: { description: "Conflito com o estado atual do usuário.", ...ProblemSchema },
  422: { description: "Regra de negócio violada.", ...ProblemSchema },
  429: { description: "Limite de requisições excedido.", ...ProblemSchema },
  500: { description: "Erro inesperado.", ...ProblemSchema },
} as const;

export async function usersRoutes(app: FastifyInstance) {
  useDocsOnlySchemas(app);

  app.post(
    "/",
    {
      preHandler: [app.authenticate, app.authorize([...USER_ADMIN_ROLES])],
      schema: {
        tags: ["Users"],
        summary: "Criar usuário",
        security,
        body: UserCreateBodySchema,
        response: {
          201: {
            description: "Usuário criado.",
            headers: { Location: { type: "string", example: "/users/user-1" } },
            ...UserResourceSchema,
          },
          ...errorResponses,
        },
      },
    },
    create,
  );

  app.get(
    "/",
    {
      preHandler: [app.authenticate, app.authorize([...USER_STAFF_ROLES])],
      schema: {
        tags: ["Users"],
        summary: "Listar usuários",
        security,
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 0, default: 0 },
            size: { type: "integer", minimum: 1, maximum: 100, default: 20 },
            q: { type: "string", minLength: 1 },
          },
        },
        response: {
          200: { description: "Coleção paginada de usuários.", ...UsersCollectionSchema },
          400: errorResponses[400],
          401: errorResponses[401],
          403: errorResponses[403],
          429: errorResponses[429],
          500: errorResponses[500],
        },
      },
    },
    list,
  );

  app.get(
    "/:id",
    {
      preHandler: [app.authenticate, app.authorize([...USER_AUTHENTICATED_ROLES])],
      schema: {
        tags: ["Users"],
        summary: "Consultar usuário",
        description: "Equipe pode consultar qualquer usuário; USUARIO pode consultar somente a própria conta.",
        security,
        params: idParams,
        response: {
          200: { description: "Usuário com links HAL.", ...UserResourceSchema },
          400: errorResponses[400],
          401: errorResponses[401],
          403: errorResponses[403],
          404: errorResponses[404],
          429: errorResponses[429],
          500: errorResponses[500],
        },
      },
    },
    getOne,
  );

  app.patch(
    "/:id",
    {
      preHandler: [app.authenticate, app.authorize([...USER_AUTHENTICATED_ROLES])],
      schema: {
        tags: ["Users"],
        summary: "Atualizar usuário",
        security,
        params: idParams,
        body: UserUpdateBodySchema,
        response: {
          200: { description: "Usuário atualizado com links HAL.", ...UserResourceSchema },
          400: errorResponses[400],
          401: errorResponses[401],
          403: errorResponses[403],
          404: errorResponses[404],
          409: errorResponses[409],
          429: errorResponses[429],
          500: errorResponses[500],
        },
      },
    },
    patch,
  );

  app.delete(
    "/:id",
    {
      preHandler: [app.authenticate, app.authorize([...USER_ADMIN_ROLES])],
      schema: {
        tags: ["Users"],
        summary: "Remover usuário",
        security,
        params: idParams,
        response: {
          204: { description: "Usuário removido; resposta sem corpo.", type: "null" },
          400: errorResponses[400],
          401: errorResponses[401],
          403: errorResponses[403],
          404: errorResponses[404],
          409: errorResponses[409],
          429: errorResponses[429],
          500: errorResponses[500],
        },
      },
    },
    removeSoft,
  );
}
