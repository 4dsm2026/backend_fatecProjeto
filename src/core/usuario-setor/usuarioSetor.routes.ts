import { FastifyInstance } from "fastify";
import * as ctl from "./usuarioSetor.controller";
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
          path: { type: "string", example: "setorId" },
          message: { type: "string", example: "Campo obrigatório" },
          code: { type: "string", example: "too_small" },
        },
      },
    },
  },
} as const;

const ForbiddenErrorSchema = {
  type: "object",
  title: "ErroSemPermissao",
  properties: {
    error: { type: "string", example: "Acesso negado" },
  },
} as const;

// Espelha o retorno de vincularUsuarioSetor/alterarPapelUsuarioSetor
// (tabela usuarioSetor) — ver src/core/usuario-setor/usuarioSetor.service.ts.
const UsuarioSetorSchema = {
  type: "object",
  title: "UsuarioSetor",
  properties: {
    id: { type: "string", example: "cmj1234567890123456789012" },
    usuarioId: { type: "string" },
    setorId: { type: "string" },
    papelId: { type: "string", nullable: true, description: "Papel do usuário dentro desse setor, se definido." },
  },
} as const;

export async function usuarioSetorRoutes(app: FastifyInstance) {
  useDocsOnlySchemas(app);

  const handlers = {
    preHandler: [
      app.authenticate,
      app.authorize(['ADMINISTRADOR', 'TECNICO']),
    ],
  }

  app.post('/usuarios/:usuarioId/setores', {
    ...handlers,
    schema: {
      tags: ['Admin - Usuários/Setores'],
      summary: 'Vincular um usuário a um setor',
      description:
        "Cria um vínculo entre o usuário informado na URL e o setor " +
        "informado no corpo, opcionalmente já atribuindo um papel " +
        "(`papelId`) para esse usuário dentro desse setor.\n\n" +
        "**Restrito a administradores e técnicos.**",
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['usuarioId'],
        properties: { usuarioId: { type: 'string', description: 'ID do usuário a vincular.' } }
      },
      body: {
        type: 'object',
        required: ['setorId'],
        properties: {
          setorId: { type: 'string', description: 'ID do setor ao qual o usuário será vinculado.' },
          papelId: { type: 'string', nullable: true, description: 'ID do papel do usuário dentro desse setor (opcional).' },
        }
      },
      response: {
        201: {
          description: 'Vínculo criado com sucesso.',
          ...UsuarioSetorSchema,
        },
        400: {
          description: 'Corpo ou parâmetro fora do schema.',
          ...ValidationErrorSchema,
        },
        401: {
          description: 'Token de acesso ausente, malformado, inválido ou expirado.',
          type: 'object',
          properties: { error: { type: 'string', example: 'Não autorizado' } }
        },
        403: {
          description: 'Usuário autenticado, mas sem papel ADMINISTRADOR/TECNICO.',
          ...ForbiddenErrorSchema,
        },
        409: {
          description: 'O usuário já está vinculado a esse setor (conflito de unicidade).',
          type: 'object',
          properties: { error: { type: 'string' } }
        },
        500: {
          description: 'Erro inesperado ao vincular.',
          type: 'object',
          properties: { error: { type: 'string' } }
        }
      }
    }
  }, ctl.vincular)

  app.get('/usuarios/:usuarioId/setores', {
    ...handlers,
    schema: {
      tags: ['Admin - Usuários/Setores'],
      summary: 'Listar os setores vinculados a um usuário',
      description:
        "Retorna a lista paginada de vínculos (setor + papel) desse usuário. " +
        "Não há checagem se `usuarioId` corresponde a um usuário existente — " +
        "um ID inexistente simplesmente resulta numa lista vazia.\n\n" +
        "**Restrito a administradores e técnicos.**",
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['usuarioId'],
        properties: { usuarioId: { type: 'string' } }
      },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1, description: 'Página atual (1-indexada).' },
          perPage: { type: 'integer', minimum: 1, maximum: 100, default: 20, description: 'Itens por página (máx. 100).' },
        }
      },
      response: {
        200: {
          description: 'Lista paginada dos setores do usuário (pode ser vazia).',
          type: 'array',
          items: UsuarioSetorSchema,
        },
        400: {
          description: 'Parâmetro ou query fora do schema.',
          ...ValidationErrorSchema,
        },
        401: {
          description: 'Token de acesso ausente, malformado, inválido ou expirado.',
          type: 'object',
          properties: { error: { type: 'string', example: 'Não autorizado' } }
        },
        403: {
          description: 'Usuário autenticado, mas sem papel ADMINISTRADOR/TECNICO.',
          ...ForbiddenErrorSchema,
        },
        500: {
          description: 'Erro inesperado ao listar.',
          type: 'object',
          properties: { error: { type: 'string' } }
        }
      }
    }
  }, ctl.listSetoresDoUsuario)

  // GET /setores/:setorId/usuarios — fora do escopo de Matheus (módulo de
  // Setores, atribuído ao Otávio). Documentação pendente por quem o possui.
  app.get('/setores/:setorId/usuarios', handlers, ctl.listUsuariosDoSetor)

  app.patch('/usuarios-setores/:usuarioSetorId', {
    ...handlers,
    schema: {
      tags: ['Admin - Usuários/Setores'],
      summary: 'Alterar o papel de um vínculo usuário-setor',
      description:
        "Atualiza o `papelId` de um vínculo já existente, identificado pelo " +
        "seu próprio ID (`usuarioSetorId`) — não pela combinação " +
        "usuário+setor. `papelId` pode ser enviado como `null` para remover " +
        "o papel atual sem remover o vínculo.\n\n" +
        "**Restrito a administradores e técnicos.**",
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['usuarioSetorId'],
        properties: { usuarioSetorId: { type: 'string', description: 'ID do vínculo usuário-setor a alterar.' } }
      },
      body: {
        type: 'object',
        properties: { papelId: { type: 'string', nullable: true, description: 'Novo papel do usuário nesse setor, ou null para remover.' } }
      },
      response: {
        200: {
          description: 'Vínculo atualizado.',
          ...UsuarioSetorSchema,
        },
        400: {
          description: 'Corpo ou parâmetro fora do schema.',
          ...ValidationErrorSchema,
        },
        401: {
          description: 'Token de acesso ausente, malformado, inválido ou expirado.',
          type: 'object',
          properties: { error: { type: 'string', example: 'Não autorizado' } }
        },
        403: {
          description: 'Usuário autenticado, mas sem papel ADMINISTRADOR/TECNICO.',
          ...ForbiddenErrorSchema,
        },
        404: {
          description: 'Vínculo não encontrado (erro P2025 do Prisma).',
          type: 'object',
          properties: { error: { type: 'string', example: 'Vínculo não encontrado' } }
        },
        500: {
          description: 'Erro inesperado ao alterar.',
          type: 'object',
          properties: { error: { type: 'string' } }
        }
      }
    }
  }, ctl.alterarPapel)

  app.delete('/usuarios-setores/:usuarioSetorId', {
    ...handlers,
    schema: {
      tags: ['Admin - Usuários/Setores'],
      summary: 'Remover o vínculo entre um usuário e um setor',
      description:
        "Remove permanentemente o vínculo identificado por " +
        "`usuarioSetorId`. Operação sem corpo de resposta em caso de " +
        "sucesso (`204 No Content`).\n\n" +
        "**Restrito a administradores e técnicos.**",
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['usuarioSetorId'],
        properties: { usuarioSetorId: { type: 'string', description: 'ID do vínculo usuário-setor a remover.' } }
      },
      response: {
        204: { description: 'Vínculo removido com sucesso (sem corpo de resposta).', type: 'null' },
        400: {
          description: '`usuarioSetorId` ausente na URL.',
          type: 'object',
          properties: { error: { type: 'string', example: 'usuarioSetorId obrigatório' } }
        },
        401: {
          description: 'Token de acesso ausente, malformado, inválido ou expirado.',
          type: 'object',
          properties: { error: { type: 'string', example: 'Não autorizado' } }
        },
        403: {
          description: 'Usuário autenticado, mas sem papel ADMINISTRADOR/TECNICO.',
          ...ForbiddenErrorSchema,
        },
        404: {
          description: 'Vínculo não encontrado (erro P2025 do Prisma).',
          type: 'object',
          properties: { error: { type: 'string', example: 'Vínculo não encontrado' } }
        },
        500: {
          description: 'Erro inesperado ao desvincular.',
          type: 'object',
          properties: { error: { type: 'string' } }
        }
      }
    }
  }, ctl.desvincular)
}