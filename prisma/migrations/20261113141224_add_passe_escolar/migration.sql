-- CreateTable
CREATE TABLE `passes_escolares` (
    `id` VARCHAR(191) NOT NULL,
    `usuarioId` VARCHAR(191) NOT NULL,
    `anoReferencia` INTEGER NOT NULL,
    `tipo` ENUM('NOVO', 'REVALIDACAO') NOT NULL DEFAULT 'NOVO',
    `modalidade` ENUM('PASSE_LIVRE', 'MEIA_TARIFA') NOT NULL,
    `status` ENUM('SOLICITADO', 'PENDENTE_ALUNO', 'CADASTRADO_PORTAL', 'REQUISITADO_EMTU', 'CONCLUIDO', 'INDEFERIDO', 'CANCELADO') NOT NULL DEFAULT 'SOLICITADO',
    `nomeCompleto` VARCHAR(120) NOT NULL,
    `rg` VARCHAR(20) NOT NULL,
    `cpf` VARCHAR(11) NOT NULL,
    `cep` VARCHAR(8) NOT NULL,
    `municipioResidencia` VARCHAR(80) NOT NULL,
    `curso` VARCHAR(120) NOT NULL,
    `periodo` VARCHAR(40) NOT NULL,
    `mesConclusao` INTEGER NOT NULL,
    `anoConclusao` INTEGER NOT NULL,
    `declaraBaixaRenda` BOOLEAN NOT NULL DEFAULT false,
    `observacaoAluno` TEXT NULL,
    `orientacaoFatec` TEXT NULL,
    `cadastradoPortalEm` DATETIME(3) NULL,
    `cadastradoPorId` VARCHAR(191) NULL,
    `protocoloEmtu` VARCHAR(40) NULL,
    `encerradoEm` DATETIME(3) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `atualizadoEm` DATETIME(3) NOT NULL,

    INDEX `passes_escolares_usuarioId_anoReferencia_idx`(`usuarioId`, `anoReferencia`),
    INDEX `passes_escolares_anoReferencia_status_idx`(`anoReferencia`, `status`),
    INDEX `passes_escolares_status_idx`(`status`),
    INDEX `passes_escolares_criadoEm_idx`(`criadoEm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `passes_escolares_historico` (
    `id` VARCHAR(191) NOT NULL,
    `passeId` VARCHAR(191) NOT NULL,
    `de` ENUM('SOLICITADO', 'PENDENTE_ALUNO', 'CADASTRADO_PORTAL', 'REQUISITADO_EMTU', 'CONCLUIDO', 'INDEFERIDO', 'CANCELADO') NULL,
    `para` ENUM('SOLICITADO', 'PENDENTE_ALUNO', 'CADASTRADO_PORTAL', 'REQUISITADO_EMTU', 'CONCLUIDO', 'INDEFERIDO', 'CANCELADO') NOT NULL,
    `comentario` TEXT NULL,
    `autorId` VARCHAR(191) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `passes_escolares_historico_passeId_criadoEm_idx`(`passeId`, `criadoEm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `passes_escolares` ADD CONSTRAINT `passes_escolares_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `passes_escolares` ADD CONSTRAINT `passes_escolares_cadastradoPorId_fkey` FOREIGN KEY (`cadastradoPorId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `passes_escolares_historico` ADD CONSTRAINT `passes_escolares_historico_passeId_fkey` FOREIGN KEY (`passeId`) REFERENCES `passes_escolares`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `passes_escolares_historico` ADD CONSTRAINT `passes_escolares_historico_autorId_fkey` FOREIGN KEY (`autorId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
