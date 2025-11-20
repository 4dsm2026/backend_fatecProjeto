import { AuditoriaService } from "./auditoria.service";

export class AuditoriaController {
  constructor(private service: AuditoriaService = new AuditoriaService()) {}

  listar = async (req, reply) => {
    const logs = await this.service.listar();
    return reply.send(logs);
  };

  listarPorUsuario = async (req, reply) => {
    const { id } = req.params;
    const logs = await this.service.listarPorUsuario(id);
    return reply.send(logs);
  };

  listarPorPeriodo = async (req, reply) => {
    const { inicio, fim } = req.query;

    const logs = await this.service.listarPorPeriodo(
      new Date(inicio),
      new Date(fim)
    );

    return reply.send(logs);
  };

  registrar = async (req, reply) => {
    const log = await this.service.registrar(req.body);
    return reply.code(201).send(log);
  };
}
