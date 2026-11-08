/*
  S19: o token de reset de senha e o de primeiro acesso usavam a mesma tabela sem
  distincao e eram intercambiaveis. Cada token passa a carregar a sua finalidade.

  Warnings:

  - Os tokens ainda nao usados e nao expirados no momento desta migracao sao
    EXPIRADOS: nao ha como saber para qual fluxo foram emitidos. Quem tinha um
    link pendente (validade maxima de 24h) precisa pedir outro.

*/
-- AlterTable (default temporario so para preencher as linhas existentes)
ALTER TABLE `tokens_reset_senha` ADD COLUMN `finalidade` ENUM('RESET_SENHA', 'PRIMEIRO_ACESSO') NOT NULL DEFAULT 'RESET_SENHA';

-- Expira os tokens pendentes, que nao tem finalidade conhecida
UPDATE `tokens_reset_senha`
SET `expiraEm` = CURRENT_TIMESTAMP(3)
WHERE `usadoEm` IS NULL AND `expiraEm` > CURRENT_TIMESTAMP(3);

-- AlterTable (a finalidade passa a ser obrigatoria em toda criacao: sem default)
ALTER TABLE `tokens_reset_senha` ALTER COLUMN `finalidade` DROP DEFAULT;
