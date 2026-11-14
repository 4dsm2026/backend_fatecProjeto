-- CreateTable
CREATE TABLE `mapa_sala_fonte` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'padrao',
    `url` VARCHAR(500) NULL,
    `xpath` VARCHAR(500) NULL,
    `atualizacaoAutomatica` BOOLEAN NOT NULL DEFAULT false,
    `ultimaVerificacaoEm` DATETIME(3) NULL,
    `ultimoResultado` VARCHAR(300) NULL,
    `ultimoErro` VARCHAR(500) NULL,
    `atualizadoPorId` VARCHAR(191) NULL,
    `atualizadoEm` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mapa_sala_versoes` (
    `id` VARCHAR(191) NOT NULL,
    `origem` ENUM('AUTOMATICA', 'MANUAL') NOT NULL,
    `nomeArquivo` VARCHAR(255) NOT NULL,
    `caminhoArquivo` VARCHAR(255) NOT NULL,
    `tamanhoBytes` INTEGER NOT NULL,
    `checksumSha256` VARCHAR(64) NOT NULL,
    `urlOrigem` VARCHAR(1000) NULL,
    `publicadoPorId` VARCHAR(191) NULL,
    `publicadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `mapa_sala_versoes_publicadoEm_idx`(`publicadoEm`),
    INDEX `mapa_sala_versoes_checksumSha256_idx`(`checksumSha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `mapa_sala_fonte` ADD CONSTRAINT `mapa_sala_fonte_atualizadoPorId_fkey` FOREIGN KEY (`atualizadoPorId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mapa_sala_versoes` ADD CONSTRAINT `mapa_sala_versoes_publicadoPorId_fkey` FOREIGN KEY (`publicadoPorId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
