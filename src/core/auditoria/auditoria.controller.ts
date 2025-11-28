import { FastifyRequest, FastifyReply } from "fastify";
import { AuditoriaService } from "./auditoria.service";
import { RegistrarAuditoriaDTO } from "./auditoria.types";

interface ListarPorUsuarioParams {
  id: string;
}

interface ListarPorPeriodoQuery {
  inicio: string;
  fim: string;
}

export class AuditoriaController {
  constructor(private readonly service: AuditoriaService = new AuditoriaService()) {}

  listar = async (req: FastifyRequest, reply: FastifyReply) => {
    const logs = await this.service.listar();
    return reply.send(logs);
  };

  listarPorUsuario = async (
    req: FastifyRequest<{ Params: ListarPorUsuarioParams }>,
    reply: FastifyReply
  ) => {
    const { id } = req.params;
    const logs = await this.service.listarPorUsuario(id);
    return reply.send(logs);
  };

  listarPorPeriodo = async (
    req: FastifyRequest<{ Querystring: ListarPorPeriodoQuery }>,
    reply: FastifyReply
  ) => {
    const { inicio, fim } = req.query;

    const logs = await this.service.listarPorPeriodo(
      new Date(inicio),
      new Date(fim)
    );

    return reply.send(logs);
  };

  registrar = async (
    req: FastifyRequest<{ Body: RegistrarAuditoriaDTO }>,
    reply: FastifyReply
  ) => {
    const log = await this.service.registrar(req.body);
    return reply.code(201).send(log);
  };
}