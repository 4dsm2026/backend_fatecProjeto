import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError, parseOrThrow, toResource } from "../../hateoas";
import {
  generateRefreshToken as genRT,
  rotateSession,
  verifyAndGetSession,
} from "../../security/refresh";
import { generateAccessToken } from "../../utils/jwt";
import { RefreshSchema } from "../../validators/auth";
import { setAuthCookies } from "../auth/auth.controller";
import { buildTokenLinks } from "./sessions.links";

const invalidRefresh = () => new ApiError("unauthorized", "Refresh token inválido");

export const postToken = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  const { refreshToken } = parseOrThrow(RefreshSchema, req.body);

  const sessao = await verifyAndGetSession(refreshToken);
  if (!sessao) throw invalidRefresh();

  const user = await req.server.prisma.usuario.findUnique({
    where: { id: sessao.usuarioId },
    select: { id: true, emailPessoal: true, papel: true, ativo: true, deletadoEm: true },
  });

  if (!user?.ativo || user.deletadoEm) {
    await req.server.prisma.sessao.update({
      where: { id: sessao.id },
      data: { revogadaEm: new Date() },
    });
    throw invalidRefresh();
  }

  const accessToken = generateAccessToken({
    sub: user.id,
    email: user.emailPessoal ?? "",
    role: user.papel,
    sid: sessao.id,
  });
  const { token: novoRefresh } = genRT();
  await rotateSession(sessao.id, novoRefresh);
  setAuthCookies(res, accessToken, novoRefresh);

  await res
    .code(201)
    .header("Cache-Control", "no-store")
    .send(toResource({ accessToken, refreshToken: novoRefresh }, buildTokenLinks()));
};
