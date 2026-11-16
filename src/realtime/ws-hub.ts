import type { Role } from "../hateoas";
import { STAFF_ROLES } from "../hateoas";

/** O mínimo de um socket que o hub usa (facilita testar sem servidor). */
export interface HubSocket {
  readonly readyState: number;
  readonly OPEN: number;
  send(data: string): void;
}

type Conexao = { socket: HubSocket; role: Role };

/**
 * Conexões WebSocket autenticadas, por usuário.
 *
 * - Um usuário pode ter várias conexões (várias abas): todas recebem os eventos,
 *   e fechar uma não derruba as outras (#122).
 * - Não existe "enviar para todos": cada evento vai para usuários escolhidos ou
 *   para quem pode ver o chamado (GHSA-mgm4-3jqg-fx5j).
 */
export class WsHub {
  private readonly porUsuario = new Map<string, Set<Conexao>>();

  add(userId: string, role: Role, socket: HubSocket): void {
    let conexoes = this.porUsuario.get(userId);
    if (!conexoes) {
      conexoes = new Set();
      this.porUsuario.set(userId, conexoes);
    }
    conexoes.add({ socket, role });
  }

  remove(userId: string, socket: HubSocket): void {
    const conexoes = this.porUsuario.get(userId);
    if (!conexoes) return;
    for (const c of conexoes) if (c.socket === socket) conexoes.delete(c);
    if (conexoes.size === 0) this.porUsuario.delete(userId);
  }

  /** Quantas conexões abertas o usuário tem (para testes e logs). */
  count(userId: string): number {
    return this.porUsuario.get(userId)?.size ?? 0;
  }

  /** Envia para todas as conexões abertas dos usuários indicados. */
  sendToUsers(userIds: Iterable<string>, data: unknown): void {
    const payload = JSON.stringify(data);
    for (const userId of new Set(userIds)) {
      for (const c of this.porUsuario.get(userId) ?? []) enviar(c.socket, payload);
    }
  }

  /**
   * Envia um evento de chamado para quem pode vê-lo pela API: o aluno dono do
   * chamado e a equipe (BACKOFFICE, TECNICO, ADMINISTRADOR). Outros alunos, nunca.
   */
  sendToTicketViewers(ownerId: string | null | undefined, data: unknown): void {
    const payload = JSON.stringify(data);
    for (const [userId, conexoes] of this.porUsuario) {
      for (const c of conexoes) {
        if (userId === ownerId || STAFF_ROLES.includes(c.role)) enviar(c.socket, payload);
      }
    }
  }
}

function enviar(socket: HubSocket, payload: string): void {
  if (socket.readyState === socket.OPEN) socket.send(payload);
}
