import { AuditoriaService } from "./auditoria.service";

export class AuditoriaController {
  constructor(private service: AuditoriaService = new AuditoriaService()) {}

  listar = async (req, res) => {
    const logs = await this.service.listar();
    return res.json(logs);
  };

  listarPorUsuario = async (req, res) => {
    const { id } = req.params;
    const logs = await this.service.listarPorUsuario(id);
    return res.json(logs);
  };

  listarPorPeriodo = async (req, res) => {
    const { inicio, fim } = req.query;

    const logs = await this.service.listarPorPeriodo(
      new Date(inicio as string),
      new Date(fim as string)
    );

    return res.json(logs);
  };

  registrar = async (req, res) => {
    const log = await this.service.registrar(req.body);
    return res.status(201).json(log);
  };
}
