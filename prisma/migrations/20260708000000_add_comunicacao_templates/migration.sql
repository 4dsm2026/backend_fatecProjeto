-- Templates de e-mail editáveis pelo admin (tela de Comunicações).
CREATE TABLE `comunicacao_templates` (
  `id` VARCHAR(191) NOT NULL,
  `chave` VARCHAR(191) NOT NULL,
  `nome` VARCHAR(191) NOT NULL,
  `descricao` TEXT NULL,
  `habilitado` BOOLEAN NOT NULL DEFAULT true,
  `assunto` TEXT NOT NULL,
  `corpo` TEXT NOT NULL,
  `variaveis` JSON NULL,
  `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizadoEm` DATETIME(3) NOT NULL,

  UNIQUE INDEX `comunicacao_templates_chave_key`(`chave`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
