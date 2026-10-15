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
const HateoasLinkSchema = {
  type: "object",
  required: ["href", "method"],
  properties: {
    href: {
      type: "string",
      description: "Caminho relativo da ação relacionada ao recurso.",
      example: "/admin/user-sectors/cmj1234567890123456789012",
    },
    method: {
      type: "string",
      enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      description: "Método HTTP usado para executar a ação.",
      example: "PATCH",
    },
    title: { type: "string", description: "Título opcional do link." },
    name: { type: "string", description: "Nome opcional do link." },
  },
} as const;

// Campos de negócio devolvidos pelo serviço antes de adicionar _links.
const UsuarioSetorSchema = {
  type: "object",
  title: "UsuarioSetor",
  properties: {
    id: { type: "string", example: "cmj1234567890123456789012" },
    usuarioId: { type: "string" },
    setorId: { type: "string" },
    papelId: { type: "string", nullable: true, description: "Papel do usuário dentro desse setor, se definido." },
    criadoEm: { type: "string", format: "date-time" },
    setor: {
      type: "object",
      nullable: true,
      properties: {
        id: { type: "string" },
        organizacaoId: { type: "string", nullable: true },
        nome: { type: "string" },
        descricao: { type: "string", nullable: true },
      },
    },
    papel: {
      type: "object",
      nullable: true,
      properties: {
        id: { type: "string" },
        nome: { type: "string" },
        descricao: { type: "string", nullable: true },
      },
    },
  },
} as const;

// O controller acrescenta _links a cada vínculo retornado.
// additionalProperties permite documentar as relações HATEOAS sem alterar
// os handlers ou as rotas existentes neste arquivo.
const UsuarioSetorResourceSchema = {
  ...UsuarioSetorSchema,
  properties: {
    ...UsuarioSetorSchema.properties,
    _links: {
      type: "object",
      description:
        "Links HATEOAS disponíveis para este vínculo. As relações (`rel`) " +
        "devem usar nomes em inglês conforme a convenção do projeto.",
      additionalProperties: HateoasLinkSchema,
      example: {
        update: {
          href: "/admin/user-sectors/cmj1234567890123456789012",
          method: "PATCH",
          title: "Alterar papel do vínculo",
        },
        delete: {
          href: "/admin/user-sectors/cmj1234567890123456789012",
          method: "DELETE",
          title: "Remover vínculo",
        },
        "user-sectors": {
          href: "/admin/users/cmj1234567890123456789012/sectors",
          method: "GET",
          title: "Listar setores do usuário",
        },
        "sector-users": {
          href: "/admin/sectors/cmj1234567890123456789012/users",
          method: "GET",
          title: "Listar usuários do setor",
        },
      },
    },
  },
} as const;

// Formato efetivamente devolvido pelos serviços de listagem atuais.
const UsuarioSetorCollectionSchema = {
  type: "object",
  title: "UsuarioSetorCollection",
  required: ["data", "total", "page", "perPage"],
  properties: {
    data: {
      type: "array",
      items: UsuarioSetorResourceSchema,
    },
    total: { type: "integer", minimum: 0, example: 2 },
    page: { type: "integer", minimum: 1, example: 1 },
    perPage: { type: "integer", minimum: 1, maximum: 100, example: 20 },
  },
} as const;

const UsuarioSetorComUsuarioSchema = {
  ...UsuarioSetorResourceSchema,
  properties: {
    ...UsuarioSetorResourceSchema.properties,
    usuario: {
      type: "object",
      properties: {
        id: { type: "string" },
        nome: { type: "string" },
        emailPessoal: { type: "string", nullable: true },
        emailEducacional: { type: "string", nullable: true },
        ra: { type: "string", nullable: true },
        papel: { type: "string", nullable: true },
        ativo: { type: "boolean" },
      },
    },
  },
} as const;

const UsuariosDoSetorCollectionSchema = {
  ...UsuarioSetorCollectionSchema,
  title: "UsuariosDoSetorCollection",
  properties: {
    ...UsuarioSetorCollectionSchema.properties,
    data: {
      type: "array",
      items: UsuarioSetorComUsuarioSchema,
    },
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

  app.post('/users/:usuarioId/sectors', {
    ...handlers,
    schema: {
      tags: ['Admin - User Sectors'],
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
          description: 'Vínculo criado com sucesso. A resposta inclui os dados do vínculo e os links HATEOAS em `_links`.',
          ...UsuarioSetorResourceSchema,
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

  app.get('/users/:usuarioId/sectors', {
    ...handlers,
    schema: {
      tags: ['Admin - User Sectors'],
      summary: 'Listar os setores vinculados a um usuário',
      description:
        "Retorna a lista paginada de vínculos (setor + papel) desse usuário. Cada " +
        "vínculo inclui seus links HATEOAS em `_links`. " +
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
          description: 'Lista paginada dos setores do usuário (pode ser vazia). Cada vínculo inclui seus links HATEOAS em `_links`.',
          ...UsuarioSetorCollectionSchema,
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

  app.get('/sectors/:setorId/users', {
    ...handlers,
    schema: {
      tags: ['Admin - User Sectors'],
      summary: 'Listar usuários vinculados a um setor',
      description:
        "Retorna a lista paginada de vínculos do setor, incluindo os dados " +
        "selecionados do usuário e o papel associado, quando definido. Cada " +
        "vínculo inclui seus links HATEOAS em `_links`. A busca pode ser filtrada " +
        "pelo nome, e-mail pessoal, e-mail educacional ou RA.\n\n" +
        "**Restrito a administradores e técnicos.**",
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['setorId'],
        properties: { setorId: { type: 'string', description: 'ID do setor.' } }
      },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1, description: 'Página atual (1-indexada).' },
          perPage: { type: 'integer', minimum: 1, maximum: 100, default: 20, description: 'Itens por página (máx. 100).' },
          search: { type: 'string', description: 'Busca por nome, e-mail pessoal, e-mail educacional ou RA.' },
        }
      },
      response: {
        200: {
          description: 'Lista paginada dos usuários vinculados ao setor (pode ser vazia).',
          ...UsuariosDoSetorCollectionSchema,
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
          description: 'Erro inesperado ao listar usuários do setor.',
          type: 'object',
          properties: { error: { type: 'string' } }
        }
      }
    }
  }, ctl.listUsuariosDoSetor)

  app.patch('/user-sectors/:usuarioSetorId', {
    ...handlers,
    schema: {
      tags: ['Admin - User Sectors'],
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
          description: 'Vínculo atualizado. A resposta inclui os dados atualizados e os links HATEOAS em `_links`.',
          ...UsuarioSetorResourceSchema,
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

  app.delete('/user-sectors/:usuarioSetorId', {
    ...handlers,
    schema: {
      tags: ['Admin - User Sectors'],
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