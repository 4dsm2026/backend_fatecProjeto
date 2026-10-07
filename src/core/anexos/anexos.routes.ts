import { FastifyInstance } from 'fastify';
import { list, upload, download } from './anexos.controller';
import { useDocsOnlySchemas } from '../../utils/openapi-docs-only';

// ===================== Constantes reutilizáveis =====================

const EXAMPLE_TICKET_ID = "cmj1234567890123456789012";
const EXAMPLE_ANEXO_ID = "cmjanexo12345678901234567";
const EXAMPLE_RAW_DB_ERROR = "Connection lost: The server closed the connection.";

const ALLOWED_MIME_TYPES_LIST = [
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain", "text/csv",
  "application/zip",
];

// ===================== Fragmentos reutilizáveis de schema =====================

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
          path: { type: "string", example: "id" },
          message: { type: "string", example: "Mínimo de 1 caractere" },
          code: { type: "string", example: "too_small" },
        },
      },
    },
  },
} as const;

const UnauthorizedErrorSchema = {
  type: "object",
  title: "ErroNaoAutorizado",
  properties: {
    error: { type: "string", example: "Não autorizado" },
  },
} as const;

const SelfCheckUnauthenticatedSchema = {
  type: "object",
  title: "ErroNaoAutenticado",
  properties: {
    error: { type: "string", example: "Não autenticado" },
  },
} as const;

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

const NotFoundChamadoResponse = {
  description:
    "Chamado não encontrado. Retornado tanto quando o ID do chamado não " +
    "existe no banco quanto quando um aluno (papel `USUARIO`) tenta " +
    "acessar anexos de um chamado de outro usuário — a mesma resposta " +
    "404 é usada em ambos os cenários para não vazar a existência do " +
    "recurso (anti-IDOR).",
  type: "object",
  properties: {
    error: { type: "string", example: "Chamado não encontrado" },
  },
} as const;

// Schema reutilizável de um anexo retornado pela API.
const AnexoSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    id: { type: "string", example: EXAMPLE_ANEXO_ID },
    nomeArquivo: { type: "string", example: "documento_comprovante.pdf" },
    mimeType: { type: "string", example: "application/pdf" },
    tamanhoBytes: { type: "integer", example: 1048576, description: "Tamanho do arquivo em bytes." },
    enviadoEm: { type: "string", format: "date-time" },
    enviadoPor: {
      type: "object",
      description: "Dados públicos do usuário que enviou o anexo.",
      properties: {
        id: { type: "string" },
        nome: { type: "string", example: "João Silva" },
      },
    },
  },
} as const;

export async function anexoRoutes(app: FastifyInstance) {
    // Aplica autenticação a todas as rotas de anexo
    app.addHook('preHandler', app.authenticate as any);

    // Faz com que o `schema` das rotas abaixo sirva só para o @fastify/swagger
    // gerar a documentação — a validação real continua 100% via Zod (preHandler).
    useDocsOnlySchemas(app);

    // Listar anexos de um chamado específico
    app.get(
      '/tickets/:id/anexos',
      {
        schema: {
          tags: ["Anexos"],
          summary: "Listar anexos de um chamado",
          description:
            "Retorna todos os anexos vinculados a um chamado, ordenados por " +
            "data de envio (`enviadoEm`, ascendente). Cada anexo inclui " +
            "metadados (nome, MIME type, tamanho) e os dados do usuário que " +
            "fez o upload.\n\n" +
            "**Regra de acesso anti-IDOR:** alunos (papel `USUARIO`) só " +
            "conseguem listar anexos dos próprios chamados. Tentar acessar " +
            "anexos de chamado de outro aluno resulta em `404`.\n\n" +
            "**Verificação de existência do chamado:** antes de buscar os " +
            "anexos, o chamado é verificado via `findUniqueOrThrow`. Se não " +
            "existir, o Prisma lança `P2025` e a resposta é `404`.",
          params: {
            type: "object",
            required: ["id"],
            properties: {
              id: {
                type: "string", minLength: 1,
                description: "ID do chamado (CUID) cujos anexos serão listados.",
                example: EXAMPLE_TICKET_ID,
              },
            },
          },
          response: {
            200: {
              description: "Lista de anexos retornada com sucesso. Pode ser um array vazio se não houver anexos.",
              type: "array",
              items: AnexoSchema,
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
                "Erro inesperado ao listar anexos. `error` é a mensagem crua " +
                "da exceção (via `errMsg()`), não sanitizada.",
              type: "object",
              properties: {
                error: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
              },
            },
          },
        },
      },
      list,
    );

    // Fazer upload de um anexo para um chamado específico
    app.post(
      '/tickets/:id/anexos',
      {
        schema: {
          tags: ["Anexos"],
          summary: "Upload de anexo para um chamado",
          description:
            "Faz upload de um arquivo e o vincula a um chamado existente. O arquivo " +
            "deve ser enviado como `multipart/form-data` (campo de arquivo, consumido " +
            "via `req.file()` do `@fastify/multipart`).\n\n" +
            "**Limite de tamanho:** máximo de **10 MB** por arquivo. Arquivos maiores " +
            "recebem `413`.\n\n" +
            "**Tipos permitidos (MIME):** " + ALLOWED_MIME_TYPES_LIST.map(m => `\`${m}\``).join(", ") + ". " +
            "Qualquer outro tipo recebe `415`.\n\n" +
            "**Regra de acesso anti-IDOR:** alunos (papel `USUARIO`) só conseguem " +
            "enviar anexos nos próprios chamados. Tentar enviar em chamado de outro " +
            "aluno resulta em `404`.\n\n" +
            "**Armazenamento:** o arquivo é salvo no diretório local configurado em " +
            "`LOCAL_STORAGE_DIR` (ou `./uploads` como fallback). O nome é " +
            "sanitizado e recebe um hash único para evitar colisões.\n\n" +
            "**Efeitos colaterais:** notificações IN_APP são enviadas ao criador do " +
            "chamado e ao responsável (excluindo o próprio uploader).",
          consumes: ["multipart/form-data"],
          params: {
            type: "object",
            required: ["id"],
            properties: {
              id: {
                type: "string", minLength: 1,
                description: "ID do chamado (CUID) ao qual o anexo será vinculado.",
                example: EXAMPLE_TICKET_ID,
              },
            },
          },
          response: {
            201: {
              description:
                "Anexo criado com sucesso. Retorna os metadados do anexo com " +
                "dados do usuário que fez o upload.",
              ...AnexoSchema,
            },
            400: {
              description:
                "Requisição inválida. Possíveis causas:\n" +
                "- Parâmetro `id` ausente ou vazio.\n" +
                "- Nenhum arquivo enviado no corpo multipart (campo de arquivo ausente).",
              oneOf: [
                ValidationErrorSchema,
                {
                  type: "object",
                  title: "ErroSemArquivo",
                  properties: {
                    error: { type: "string", example: "Nenhum arquivo enviado." },
                  },
                },
              ],
            },
            401: Unauthorized401WithSelfCheck,
            404: {
              description:
                "Chamado não encontrado. Retornado quando o chamado com o ID " +
                "informado não existe no banco, OU quando um aluno tenta fazer " +
                "upload em chamado de outro usuário (anti-IDOR).",
              type: "object",
              properties: {
                error: { type: "string", example: "Chamado não encontrado" },
              },
            },
            413: {
              description:
                "Arquivo excede o limite máximo de 10 MB (`MAX_FILE_SIZE_BYTES = 10485760`). " +
                "O arquivo é lido em buffer antes da checagem — a mensagem inclui o limite.",
              type: "object",
              properties: {
                error: { type: "string", example: "Arquivo excede o limite de 10MB." },
              },
            },
            415: {
              description:
                "Tipo de arquivo não permitido. O MIME type enviado não está na " +
                "lista de tipos aceitos. A mensagem inclui o MIME type rejeitado.",
              type: "object",
              properties: {
                error: {
                  type: "string",
                  example: "Tipo de arquivo não permitido: application/x-executable",
                },
              },
            },
            429: RateLimit429Response,
            500: {
              description:
                "Erro inesperado ao fazer upload do anexo. Pode incluir falha ao " +
                "salvar no disco ou erro de banco. `error` é a mensagem crua da " +
                "exceção (via `errMsg()`), não sanitizada.",
              type: "object",
              properties: {
                error: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
              },
            },
          },
        },
      },
      upload,
    );

    // Baixar um anexo específico pelo ID do anexo
    app.get(
      '/anexos/:anexoId/download',
      {
        schema: {
          tags: ["Anexos"],
          summary: "Download de um anexo",
          description:
            "Baixa o arquivo físico de um anexo. O arquivo é retornado como stream " +
            "binário com os headers `Content-Disposition` (attachment) e " +
            "`Content-Type` corretos.\n\n" +
            "**Validação de `anexoId`:** o parâmetro é validado como CUID (via " +
            "`z.string().cuid()`). IDs em formato diferente recebem `400`.\n\n" +
            "**Regra de acesso (não é anti-IDOR simples):** o acesso é permitido se " +
            "o usuário for:\n" +
            "- O criador do chamado (`criadoPorId`), OU\n" +
            "- O responsável pelo chamado (`responsavelId`), OU\n" +
            "- Quem fez o upload do anexo (`enviadoPorId`), OU\n" +
            "- Membro do setor vinculado ao chamado (`usuarioSetor`), OU\n" +
            "- Possuir papel `ADMINISTRADOR` ou `BACKOFFICE` (acesso irrestrito).\n\n" +
            "Se nenhuma dessas condições for satisfeita, retorna `403`.\n\n" +
            "**Arquivo físico ausente:** se o registro do anexo existe no banco mas " +
            "o arquivo não está no disco (`fs.access` falha), retorna `404`.",
          params: {
            type: "object",
            required: ["anexoId"],
            properties: {
              anexoId: {
                type: "string",
                description: "ID do anexo (CUID). Validado pelo Zod como `z.string().cuid()`.",
                example: EXAMPLE_ANEXO_ID,
              },
            },
          },
          response: {
            200: {
              description:
                "Arquivo retornado com sucesso como stream binário. Os headers " +
                "`Content-Disposition` e `Content-Type` são definidos com o nome " +
                "original e MIME type do arquivo.",
              type: "string",
              format: "binary",
            },
            400: {
              description:
                "Parâmetro `anexoId` ausente, vazio ou não é um CUID válido.",
              ...ValidationErrorSchema,
            },
            401: Unauthorized401WithSelfCheck,
            403: {
              description:
                "Acesso negado a este anexo. O usuário autenticado não é o criador " +
                "do chamado, nem o responsável, nem quem fez o upload, nem membro " +
                "do setor vinculado, e também não possui papel `ADMINISTRADOR` ou " +
                "`BACKOFFICE`.",
              type: "object",
              properties: {
                error: { type: "string", example: "Acesso negado a este anexo" },
              },
            },
            404: {
              description:
                "Anexo não encontrado. Duas causas possíveis:\n" +
                "- O ID do anexo não existe no banco (`\"Anexo não encontrado\"`).\n" +
                "- O registro existe no banco mas o arquivo físico não está no " +
                "disco/storage (`\"Arquivo físico não encontrado no servidor\"`).",
              type: "object",
              properties: {
                error: {
                  type: "string",
                  enum: ["Anexo não encontrado", "Arquivo físico não encontrado no servidor"],
                },
              },
            },
            429: RateLimit429Response,
            500: {
              description:
                "Erro inesperado ao baixar o anexo. `error` é a mensagem crua " +
                "da exceção, não sanitizada.",
              type: "object",
              properties: {
                error: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
              },
            },
          },
        },
      },
      download,
    );

    // Gerar token de download temporário (curta duração)
    app.post(
      '/anexos/:anexoId/download-token',
      {
        schema: {
          tags: ["Anexos"],
          summary: "Gerar token temporário de download",
          description:
            "Gera um JWT de download temporário para um anexo específico, com " +
            "validade de **5 minutos** (`expiresIn: '5m'`). Este token pode ser " +
            "usado para baixar o arquivo sem precisar de autenticação via header " +
            "(útil para links diretos, pré-visualização em iframes, etc.).\n\n" +
            "**Mesma regra de acesso do download:** antes de gerar o token, a mesma " +
            "lógica de `getAnexoForDownload` é executada — ou seja, as mesmas " +
            "regras de acesso (criador, responsável, uploader, membro do setor, " +
            "`ADMINISTRADOR`/`BACKOFFICE`) se aplicam. Se o usuário não tiver " +
            "acesso, recebe `403` antes de o token ser gerado.\n\n" +
            "**Payload do JWT:** contém `{ sub: userId, anexoId }`. Assinado com a " +
            "mesma chave do backend (`generateDownloadToken` em utils/jwt.ts).\n\n" +
            "**Nota:** o `anexoId` no parâmetro NÃO é validado como CUID nesta " +
            "rota (diferente de `GET /anexos/:anexoId/download`) — a validação " +
            "aqui é feita apenas pela existência no banco via `getAnexoForDownload`.",
          params: {
            type: "object",
            required: ["anexoId"],
            properties: {
              anexoId: {
                type: "string",
                description: "ID do anexo para o qual gerar o token de download.",
                example: EXAMPLE_ANEXO_ID,
              },
            },
          },
          response: {
            200: {
              description:
                "Token de download gerado com sucesso. O token é um JWT com " +
                "validade de 5 minutos (300 segundos).",
              type: "object",
              properties: {
                token: {
                  type: "string",
                  description:
                    "JWT de download temporário (HS256). Payload: `{ sub, anexoId }`. " +
                    "Válido por 5 minutos.",
                },
                expiresIn: {
                  type: "integer",
                  description: "Tempo de expiração em segundos.",
                  example: 300,
                },
              },
            },
            400: {
              description: "Parâmetro `anexoId` ausente.",
              type: "object",
              properties: {
                error: { type: "string", example: "Parâmetro anexoId ausente" },
              },
            },
            401: Unauthorized401WithSelfCheck,
            403: {
              description:
                "Acesso negado a este anexo. Mesma regra de acesso de " +
                "`GET /anexos/:anexoId/download` — o usuário não tem permissão " +
                "para acessar este anexo.",
              type: "object",
              properties: {
                error: { type: "string", example: "Acesso negado a este anexo" },
              },
            },
            404: {
              description:
                "Anexo não encontrado. Duas causas possíveis (mesmas de " +
                "`GET /anexos/:anexoId/download`):\n" +
                "- O ID do anexo não existe no banco.\n" +
                "- O registro existe mas o arquivo físico não está no disco.",
              type: "object",
              properties: {
                error: {
                  type: "string",
                  enum: ["Anexo não encontrado", "Arquivo físico não encontrado no servidor"],
                },
              },
            },
            429: RateLimit429Response,
            500: {
              description:
                "Erro inesperado ao gerar o token de download. `error` é a mensagem " +
                "crua da exceção, não sanitizada.",
              type: "object",
              properties: {
                error: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
              },
            },
          },
        },
      },
      async (req, res) => {
        return (await import('./anexos.controller')).generateDownloadTokenRoute(req, res);
      },
    );
}