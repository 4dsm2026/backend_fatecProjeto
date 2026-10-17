// src/core/sessions/sessions.controller.ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError, entryLinks, parseOrThrow, toResource } from "../../hateoas";
import type { Links, Viewer } from "../../hateoas";
import { hashPassword, verifyPassword } from "../../security/password";
import { TrocarSenhaSchema } from "../../validators/auth";
import { enviarAvisoSenhaAlterada } from "../auth/senha-alterada.service";
import { userPublicSelect } from "../auth/user-public";
import { buildCurrentUserLinks, buildSessionLinks } from "./sessions.links";

const INVALID_TOKEN = { "WWW-Authenticate": 'Bearer error="invalid_token"' };

/** Quem está logado, já no formato que o núcleo HAL espera. */
function viewerOf(req: FastifyRequest): Viewer {
  const user = req.user;
  if (!user?.sub) throw new ApiError("unauthorized", "Não autenticado");
  return { id: user.sub, role: user.role as Viewer["role"] };
}

/** Id da sessão que originou o access token. Tokens antigos (sem `sid`) não têm. */
function sessionIdOf(req: FastifyRequest): string {
  const sid = req.user?.sid;
  if (!sid) {
    throw new ApiError(
      "unauthorized",
      "Sessão não identificada",
      "Este token não está ligado a uma sessão. Faça login novamente.",
      undefined,
      { headers: INVALID_TOKEN },
    );
  }
  return sid;
}

/**
 * Regra de quem pode editar o próprio cadastro (PATCH /usuarios/:id): o aluno
 * edita só o próprio registro (sem campos privilegiados) e a equipe edita
 * qualquer um, então todo usuário logado pode editar o PRÓPRIO cadastro.
 * Se a regra do módulo users mudar, mude aqui.
 */
function canUpdateOwnProfile(_viewer: Viewer): boolean {
  return true;
}

/** Links de menu por papel, sem repetir os que `/users/me` já tem por conta própria. */
function menuLinks(viewer: Viewer): Links {
  const { self: _self, "current-user": _currentUser, session: _session, ...menu } = entryLinks(viewer);
  return menu;
}

/* ===================== GET /sessions/current ===================== */
export const getCurrentSession = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const viewer = viewerOf(req);
  const sid = sessionIdOf(req);

  const sessao = await req.server.prisma.sessao.findFirst({
    where: { id: sid, usuarioId: viewer.id, revogadaEm: null, expiraEm: { gt: new Date() } },
    select: { id: true, criadoEm: true, ultimoUsoEm: true, expiraEm: true, ip: true, userAgent: true },
  });
  if (!sessao) {
    throw new ApiError("unauthorized", "Sessão encerrada", "Esta sessão foi encerrada ou expirou.", undefined, {
      headers: INVALID_TOKEN,
    });
  }

  await res.send(toResource(sessao, buildSessionLinks()));
};

/* ===================== DELETE /sessions/current ===================== */
export const deleteCurrentSession = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const viewer = viewerOf(req);
  const sid = sessionIdOf(req);

  // Idempotente: sessão já revogada continua sendo 204. A condição `usuarioId`
  // garante que ninguém revoga a sessão de outro usuário.
  await req.server.prisma.sessao.updateMany({
    where: { id: sid, usuarioId: viewer.id, revogadaEm: null },
    data: { revogadaEm: new Date() },
  });

  await res.code(204).send();
};

/* ===================== GET /users/me ===================== */
export const getCurrentUser = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const viewer = viewerOf(req);

  const user = await req.server.prisma.usuario.findUnique({
    where: { id: viewer.id },
    select: userPublicSelect,
  });
  if (!user) throw new ApiError("not-found", "Usuário não encontrado");

  await res.send(
    toResource(
      user,
      buildCurrentUserLinks(viewer, { canUpdate: canUpdateOwnProfile(viewer), extra: menuLinks(viewer) }),
    ),
  );
};

/* ===================== PUT /users/me/password ===================== */
export const putCurrentUserPassword = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const { senhaAtual, novaSenha } = parseOrThrow(TrocarSenhaSchema, req.body);
  const viewer = viewerOf(req);

  const user = await req.server.prisma.usuario.findUnique({
    where: { id: viewer.id },
    select: {
      id: true,
      nome: true,
      senhaHash: true,
      emailPessoal: true,
      emailEducacional: true,
    },
  });
  if (!user) throw new ApiError("not-found", "Usuário não encontrado");
  if (!user.senhaHash) {
    throw new ApiError("conflict", "Usuário sem senha local definida");
  }

  const senhaConfere = await verifyPassword(user.senhaHash, senhaAtual);
  if (!senhaConfere) {
    throw new ApiError(
      "unprocessable",
      "Senha atual incorreta",
      "A senha atual informada não confere com a senha cadastrada.",
    );
  }

  const novaSenhaHash = await hashPassword(novaSenha);
  await req.server.prisma.$transaction(async (tx) => {
    await tx.usuario.update({
      where: { id: user.id },
      data: { senhaHash: novaSenhaHash, precisaTrocarSenha: false, passwordUpdatedAt: new Date() },
    });
    await tx.sessao.updateMany({
      where: { usuarioId: user.id, revogadaEm: null },
      data: { revogadaEm: new Date() },
    });
  });

  void enviarAvisoSenhaAlterada({
    nome: user.nome,
    emailPessoal: user.emailPessoal,
    emailEducacional: user.emailEducacional,
    motivo: "troca",
    ip: req.ip,
    userAgent: String(req.headers["user-agent"] ?? ""),
  }).catch((err) => {
    req.log.error({ err }, "💥 Falha ao enviar aviso de senha alterada");
  });

  await res.code(204).send();
};
