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

  app.post('/usuarios/:usuarioId/setores', handlers, ctl.vincular)
  app.get('/usuarios/:usuarioId/setores', handlers, ctl.listSetoresDoUsuario)
  app.get('/setores/:setorId/usuarios', handlers, ctl.listUsuariosDoSetor)
  app.patch('/usuarios-setores/:usuarioSetorId', handlers, ctl.alterarPapel)
  app.delete('/usuarios-setores/:usuarioSetorId', handlers, ctl.desvincular)
}