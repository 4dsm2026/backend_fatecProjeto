import { FastifyInstance } from "fastify";
import * as ctl from "./comunicacoes.controller";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";

// ----- Fragmentos reutilizáveis -----

// Corpo devolvido por formatZodError quando o validador rejeita a
// requisição por falha de schema (mesmo formato usado em todo o projeto).
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
          path: { type: "string", example: "nome" },
          message: { type: "string", example: "Campo obrigatório" },
          code: { type: "string", example: "too_small" },
        },
      },
    },
  },
} as const;

// Corpo enviado pelo preHandler `app.authorize(['ADMINISTRADOR'])` quando o
// usuário está autenticado, mas não tem papel de administrador.
const ForbiddenErrorSchema = {
  type: "object",
  title: "ErroSemPermissao",
  properties: {
    error: { type: "string", example: "Acesso negado" },
  },
} as const;

// Espelha exatamente o que `listTemplates`/`upsertTemplate` retornam
// (tabela comunicacaoTemplate) — ver src/core/comunicacoes/comunicacoes.service.ts.
const ComunicacaoTemplateSchema = {
  type: "object",
  title: "ComunicacaoTemplate",
  properties: {
    chave: { type: "string", description: "Identificador único do template.", example: "boas-vindas" },
    nome: { type: "string", example: "E-mail de boas-vindas" },
    descricao: { type: "string", nullable: true },
    habilitado: { type: "boolean", default: true },
    assunto: { type: "string" },
    corpo: { type: "string", description: "Corpo do e-mail. Suporta variáveis (ver campo `variaveis`)." },
    variaveis: {
      type: "array",
      items: { type: "string" },
      description: "Nomes das variáveis que podem ser interpoladas no `assunto`/`corpo` (ex.: nome do usuário).",
    },
  },
} as const;

export async function comunicacoesRoutes(app: FastifyInstance) {
  useDocsOnlySchemas(app);

  const handlers = {
    preHandler: [app.authenticate, app.authorize(['ADMINISTRADOR'])],
  };

  app.get('/comunicacoes', {
    ...handlers,
    schema: {
      tags: ['Admin - Comunicações'],
      summary: 'Listar todos os templates de comunicação cadastrados',
      description:
        "Retorna todos os templates de e-mail persistidos no banco, ordenados " +
        "por `chave` (ordem alfabética). O front mescla essa lista com um " +
        "conjunto de templates padrão (default) que não são persistidos — " +
        "esta rota devolve apenas os templates que já foram salvos ao menos " +
        "uma vez via `PUT /comunicacoes/:chave`.\n\n" +
        "**Restrito a administradores** — exige token válido " +
        "(`app.authenticate`) E papel `ADMINISTRADOR` (`app.authorize`).",
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          description: "Lista de templates persistidos.",
          type: 'object',
          properties: {
            data: { type: 'array', items: ComunicacaoTemplateSchema }
          }
        },
        401: {
          description: 'Token de acesso ausente, malformado, inválido ou expirado.',
          type: 'object',
          properties: { error: { type: 'string', example: 'Não autorizado' } }
        },
        403: {
          description: 'Usuário autenticado, mas sem papel ADMINISTRADOR.',
          ...ForbiddenErrorSchema,
        },
        500: {
          description: 'Erro inesperado ao listar os templates.',
          type: 'object',
          properties: { error: { type: 'string' } }
        }
      }
    }
  }, ctl.list);

  app.put('/comunicacoes/:chave', {
    ...handlers,
    schema: {
      tags: ['Admin - Comunicações'],
      summary: 'Criar ou atualizar um template de comunicação pela chave',
      description:
        "Operação de upsert: se já existir um template com essa `chave`, ele " +
        "é atualizado por completo (todos os campos do corpo substituem os " +
        "valores anteriores); se não existir, um novo template é criado com " +
        "essa `chave`.\n\n" +
        "**Restrito a administradores.**",
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['chave'],
        properties: {
          chave: { type: 'string', example: 'boas-vindas', description: 'Identificador único do template.' }
        }
      },
      body: {
        type: 'object',
        required: ['nome', 'assunto', 'corpo'],
        properties: {
          nome: { type: 'string', minLength: 1, maxLength: 160 },
          descricao: { type: 'string', nullable: true, maxLength: 500 },
          habilitado: { type: 'boolean', default: true },
          assunto: { type: 'string', minLength: 1, maxLength: 500 },
          corpo: { type: 'string', minLength: 1, description: 'Suporta variáveis interpoladas (ver `variaveis`).' },
          variaveis: { type: 'array', items: { type: 'string' } },
        }
      },
      response: {
        200: {
          description: 'Template salvo (criado ou atualizado).',
          ...ComunicacaoTemplateSchema,
        },
        400: {
          description: 'Corpo ou parâmetro fora do schema (campo obrigatório ausente ou mal formatado).',
          ...ValidationErrorSchema,
        },
        401: {
          description: 'Token de acesso ausente, malformado, inválido ou expirado.',
          type: 'object',
          properties: { error: { type: 'string', example: 'Não autorizado' } }
        },
        403: {
          description: 'Usuário autenticado, mas sem papel ADMINISTRADOR.',
          ...ForbiddenErrorSchema,
        },
        500: {
          description: 'Erro inesperado ao salvar o template.',
          type: 'object',
          properties: { error: { type: 'string' } }
        }
      }
    }
  }, ctl.upsert);

  app.post('/comunicacoes/teste', {
    ...handlers,
    schema: {
      tags: ['Admin - Comunicações'],
      summary: 'Enviar um e-mail de teste com assunto/corpo fornecidos',
      description:
        "Envia imediatamente um e-mail de teste para o destinatário `to`, " +
        "usando o `assunto`/`corpo` informados no corpo da requisição — não " +
        "precisa haver um template salvo previamente; o conteúdo é enviado " +
        "'na hora', renderizado com uma amostra de dados (`renderComAmostra`).\n\n" +
        "**Restrito a administradores.**",
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['to', 'assunto', 'corpo'],
        properties: {
          to: { type: 'string', format: 'email', description: 'E-mail de destino do teste.', example: 'teste@exemplo.com' },
          assunto: { type: 'string', minLength: 1, maxLength: 500 },
          corpo: { type: 'string', minLength: 1 },
        }
      },
      response: {
        200: {
          description: 'E-mail de teste enviado com sucesso.',
          type: 'object',
          properties: { message: { type: 'string', example: 'E-mail de teste enviado para teste@exemplo.com' } }
        },
        400: {
          description: 'Corpo fora do schema (campo obrigatório ausente ou e-mail inválido).',
          ...ValidationErrorSchema,
        },
        401: {
          description: 'Token de acesso ausente, malformado, inválido ou expirado.',
          type: 'object',
          properties: { error: { type: 'string', example: 'Não autorizado' } }
        },
        403: {
          description: 'Usuário autenticado, mas sem papel ADMINISTRADOR.',
          ...ForbiddenErrorSchema,
        },
        502: {
          description: 'Falha ao enviar o e-mail — erro reportado pelo provedor de e-mail configurado.',
          type: 'object',
          properties: { error: { type: 'string', description: 'Mensagem prefixada com "Falha ao enviar e-mail: ".' } }
        }
      }
    }
  }, ctl.enviarTeste);
}