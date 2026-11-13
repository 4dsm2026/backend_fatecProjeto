-- CreateTable
CREATE TABLE `pesquisas` (
    `id` VARCHAR(191) NOT NULL,
    `titulo` VARCHAR(160) NOT NULL,
    `descricao` TEXT NULL,
    `semestre` VARCHAR(6) NOT NULL,
    `status` ENUM('RASCUNHO', 'ABERTA', 'ENCERRADA') NOT NULL DEFAULT 'RASCUNHO',
    `cursos` JSON NULL,
    `fechaEm` DATETIME(3) NULL,
    `abertaEm` DATETIME(3) NULL,
    `encerradaEm` DATETIME(3) NULL,
    `criadoPorId` VARCHAR(191) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `atualizadoEm` DATETIME(3) NOT NULL,

    INDEX `pesquisas_semestre_idx`(`semestre`),
    INDEX `pesquisas_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pesquisas_perguntas` (
    `id` VARCHAR(191) NOT NULL,
    `pesquisaId` VARCHAR(191) NOT NULL,
    `ordem` INTEGER NOT NULL,
    `secao` VARCHAR(80) NULL,
    `texto` VARCHAR(300) NOT NULL,
    `tipo` ENUM('ESCALA', 'MULTIPLA', 'TEXTO') NOT NULL,
    `opcoes` JSON NULL,
    `obrigatoria` BOOLEAN NOT NULL DEFAULT true,

    INDEX `pesquisas_perguntas_pesquisaId_ordem_idx`(`pesquisaId`, `ordem`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pesquisas_participacoes` (
    `id` VARCHAR(191) NOT NULL,
    `pesquisaId` VARCHAR(191) NOT NULL,
    `usuarioId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `pesquisas_participacoes_pesquisaId_usuarioId_key`(`pesquisaId`, `usuarioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pesquisas_respostas` (
    `id` VARCHAR(191) NOT NULL,
    `pesquisaId` VARCHAR(191) NOT NULL,
    `curso` VARCHAR(128) NOT NULL,
    `turno` VARCHAR(40) NULL,
    `respostas` JSON NOT NULL,

    INDEX `pesquisas_respostas_pesquisaId_curso_idx`(`pesquisaId`, `curso`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `pesquisas` ADD CONSTRAINT `pesquisas_criadoPorId_fkey` FOREIGN KEY (`criadoPorId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pesquisas_perguntas` ADD CONSTRAINT `pesquisas_perguntas_pesquisaId_fkey` FOREIGN KEY (`pesquisaId`) REFERENCES `pesquisas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pesquisas_participacoes` ADD CONSTRAINT `pesquisas_participacoes_pesquisaId_fkey` FOREIGN KEY (`pesquisaId`) REFERENCES `pesquisas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pesquisas_participacoes` ADD CONSTRAINT `pesquisas_participacoes_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pesquisas_respostas` ADD CONSTRAINT `pesquisas_respostas_pesquisaId_fkey` FOREIGN KEY (`pesquisaId`) REFERENCES `pesquisas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
