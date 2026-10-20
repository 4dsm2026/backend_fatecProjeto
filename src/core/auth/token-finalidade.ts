import type { FinalidadeToken } from "@prisma/client";

/**
 * Finalidade dos tokens da tabela `tokens_reset_senha`.
 *
 * Um token só vale no fluxo para o qual foi emitido: o de reset não ativa conta
 * (que pode trocar o e-mail) e o de primeiro acesso não faz reset (validade e
 * revogação de sessões diferentes). Quem cria informa a finalidade; quem consome
 * filtra por ela.
 *
 * `satisfies` mantém o literal e ainda obriga a casar com o enum do Prisma. Só
 * tipos vêm de `@prisma/client`: em tempo de execução são strings.
 */
export const FINALIDADE_RESET_SENHA = "RESET_SENHA" satisfies FinalidadeToken;
export const FINALIDADE_PRIMEIRO_ACESSO = "PRIMEIRO_ACESSO" satisfies FinalidadeToken;
