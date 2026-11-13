-- CreateTable
CREATE TABLE `solicitacoes_matricula` (
    `id` VARCHAR(191) NOT NULL,
    `usuarioId` VARCHAR(191) NOT NULL,
    `tipo` ENUM('TRANCAMENTO', 'CANCELAMENTO') NOT NULL,
    `status` ENUM('SOLICITADO', 'EM_ANALISE', 'PENDENTE_ALUNO', 'DEFERIDO', 'INDEFERIDO', 'CANCELADO') NOT NULL DEFAULT 'SOLICITADO',
    `semestre` VARCHAR(6) NOT NULL,
    `motivo` VARCHAR(40) NOT NULL,
    `justificativa` TEXT NULL,
    `curso` VARCHAR(128) NOT NULL,
    `orientacaoFatec` TEXT NULL,
    `decididoEm` DATETIME(3) NULL,
    `decididoPorId` VARCHAR(191) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `atualizadoEm` DATETIME(3) NOT NULL,

    INDEX `solicitacoes_matricula_usuarioId_idx`(`usuarioId`),
    INDEX `solicitacoes_matricula_status_criadoEm_idx`(`status`, `criadoEm`),
    INDEX `solicitacoes_matricula_semestre_tipo_idx`(`semestre`, `tipo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `solicitacoes_matricula_historico` (
    `id` VARCHAR(191) NOT NULL,
    `solicitacaoId` VARCHAR(191) NOT NULL,
    `de` ENUM('SOLICITADO', 'EM_ANALISE', 'PENDENTE_ALUNO', 'DEFERIDO', 'INDEFERIDO', 'CANCELADO') NULL,
    `para` ENUM('SOLICITADO', 'EM_ANALISE', 'PENDENTE_ALUNO', 'DEFERIDO', 'INDEFERIDO', 'CANCELADO') NOT NULL,
    `comentario` TEXT NULL,
    `autorId` VARCHAR(191) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `solicitacoes_matricula_historico_solicitacaoId_criadoEm_idx`(`solicitacaoId`, `criadoEm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `solicitacoes_matricula` ADD CONSTRAINT `solicitacoes_matricula_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `solicitacoes_matricula` ADD CONSTRAINT `solicitacoes_matricula_decididoPorId_fkey` FOREIGN KEY (`decididoPorId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `solicitacoes_matricula_historico` ADD CONSTRAINT `solicitacoes_matricula_historico_solicitacaoId_fkey` FOREIGN KEY (`solicitacaoId`) REFERENCES `solicitacoes_matricula`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `solicitacoes_matricula_historico` ADD CONSTRAINT `solicitacoes_matricula_historico_autorId_fkey` FOREIGN KEY (`autorId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
