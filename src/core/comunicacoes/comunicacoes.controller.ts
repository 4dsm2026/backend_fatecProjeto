import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ApiError, buildLinks, fieldErrorsFromZod, link, path, toCollection, toResource } from "../../hateoas";
import type { Viewer } from "../../hateoas";
import { ComunicacaoListQuerySchema, ComunicacaoUpsertSchema, ComunicacaoTesteSchema, buildCommunicationTemplateLinks } from "./comunicacoes.types";
import { getTemplate, listTemplates, upsertTemplate, renderComAmostra } from "./comunicacoes.service";
import { getMailDriver } from "../../config/mail";

function parseOrThrow<T extends z.ZodType<unknown>>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiError("bad-request", "Dados inválidos", undefined, fieldErrorsFromZod(result.error.issues));
  }
  return result.data as z.output<T>;
}

function requestViewer(req: FastifyRequest): Viewer {
  if (!req.user?.sub) throw new ApiError("unauthorized", "Não autenticado");
  if (req.user.role !== "ADMINISTRADOR") throw new ApiError("forbidden", "Acesso negado");
  return { id: req.user.sub, role: "ADMINISTRADOR" };
}

export async function list(req: FastifyRequest, reply: FastifyReply) {
  const query = parseOrThrow(ComunicacaoListQuerySchema, req.query);
  const viewer = requestViewer(req);
  const result = await listTemplates(req.server.prisma, query);
  const items = result.items.map((template) =>
    toResource(template, buildCommunicationTemplateLinks(template, viewer)),
  );

  return reply.send(toCollection({
    rel: "communication-templates",
    basePath: "/admin/communication-templates",
    items,
    page: query.page,
    size: query.size,
    total: result.total,
    links: buildLinks({
      "communication-tests": viewer.role === "ADMINISTRADOR" &&
        link("/admin/communication-tests", "POST"),
    }),
  }));
}

export async function getOne(req: FastifyRequest, reply: FastifyReply) {
  const { chave } = parseOrThrow(ComunicacaoUpsertSchema.shape.params, req.params);
  const viewer = requestViewer(req);
  const template = await getTemplate(req.server.prisma, chave);
  if (!template) throw new ApiError("not-found", "Template de comunicação não encontrado");

  return reply.send(toResource(template, buildCommunicationTemplateLinks(template, viewer)));
}

export async function upsert(req: FastifyRequest, reply: FastifyReply) {
  const params = parseOrThrow(ComunicacaoUpsertSchema.shape.params, req.params);
  const body = parseOrThrow(ComunicacaoUpsertSchema.shape.body, req.body);
  const viewer = requestViewer(req);
  const existing = await getTemplate(req.server.prisma, params.chave);
  const saved = await upsertTemplate(req.server.prisma, params.chave, body);
  const resource = toResource(saved, buildCommunicationTemplateLinks(saved, viewer));

  if (!existing) {
    const location = path`/admin/communication-templates/${params.chave}`;
    return reply.header("Location", location).code(201).send(resource);
  }

  return reply.code(200).send(resource);
}

/* POST /admin/communication-tests */
export async function enviarTeste(req: FastifyRequest, res: FastifyReply) {
  const { to, assunto, corpo } = parseOrThrow(ComunicacaoTesteSchema.shape.body, req.body);
  try {
    await getMailDriver().send({
      to,
      subject: `[TESTE] ${renderComAmostra(assunto)}`,
      html: renderComAmostra(corpo),
    });
    return res.send(toResource(
      { message: `E-mail de teste enviado para ${to}` },
      buildLinks({
        "communication-tests": link("/admin/communication-tests", "POST"),
        collection: link("/admin/communication-templates"),
      }),
    ));
  } catch {
    throw new ApiError("internal", "Falha ao enviar o e-mail de teste");
  }
}
