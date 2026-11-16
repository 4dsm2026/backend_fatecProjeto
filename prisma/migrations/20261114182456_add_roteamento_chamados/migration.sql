-- AlterTable
ALTER TABLE `chamados` ADD COLUMN `escalonadoEm` DATETIME(3) NULL,
    ADD COLUMN `regraRoteamentoId` VARCHAR(191) NULL,
    ADD COLUMN `roteamentoMotivo` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `setores` ADD COLUMN `prazoEscalonamentoHoras` INTEGER NULL;

-- CreateTable
CREATE TABLE `setores_contatos` (
    `id` VARCHAR(191) NOT NULL,
    `setorId` VARCHAR(191) NOT NULL,
    `nivel` ENUM('PRIMEIRO', 'SEGUNDO', 'COPIA') NOT NULL,
    `usuarioId` VARCHAR(191) NULL,
    `email` VARCHAR(254) NULL,
    `nome` VARCHAR(120) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `setores_contatos_setorId_nivel_idx`(`setorId`, `nivel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `regras_roteamento` (
    `id` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(120) NOT NULL,
    `ordem` INTEGER NOT NULL DEFAULT 100,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `categoriaChave` VARCHAR(64) NULL,
    `servicoChave` VARCHAR(64) NULL,
    `setorId` VARCHAR(191) NOT NULL,
    `setorCopiaId` VARCHAR(191) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `atualizadoEm` DATETIME(3) NOT NULL,

    INDEX `regras_roteamento_ativo_ordem_idx`(`ativo`, `ordem`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `chamados` ADD CONSTRAINT `chamados_regraRoteamentoId_fkey` FOREIGN KEY (`regraRoteamentoId`) REFERENCES `regras_roteamento`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `setores_contatos` ADD CONSTRAINT `setores_contatos_setorId_fkey` FOREIGN KEY (`setorId`) REFERENCES `setores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `setores_contatos` ADD CONSTRAINT `setores_contatos_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `regras_roteamento` ADD CONSTRAINT `regras_roteamento_setorId_fkey` FOREIGN KEY (`setorId`) REFERENCES `setores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `regras_roteamento` ADD CONSTRAINT `regras_roteamento_setorCopiaId_fkey` FOREIGN KEY (`setorCopiaId`) REFERENCES `setores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- Dados iniciais do roteamento de manutenção (#73, #74, #75).
-- Idempotente: não duplica se já houver setor/categoria com o mesmo nome/id.
-- Os setores nascem sem pessoas: o administrador vincula na tela "Roteamento".
-- =====================================================================

INSERT INTO `setores` (`id`, `organizacaoId`, `nome`, `descricao`, `prazoEscalonamentoHoras`)
SELECT 'setor_aux_docentes', (SELECT `id` FROM `organizacoes` ORDER BY `id` LIMIT 1), 'Auxiliares Docentes',
       'Equipamentos de sala e laboratório: projetores, computadores, periféricos.', 24
WHERE NOT EXISTS (SELECT 1 FROM `setores` WHERE `nome` = 'Auxiliares Docentes');

INSERT INTO `setores` (`id`, `organizacaoId`, `nome`, `descricao`, `prazoEscalonamentoHoras`)
SELECT 'setor_coordenacao', (SELECT `id` FROM `organizacoes` ORDER BY `id` LIMIT 1), 'Coordenação',
       'Coordenação de curso.', NULL
WHERE NOT EXISTS (SELECT 1 FROM `setores` WHERE `nome` = 'Coordenação');

INSERT INTO `setores` (`id`, `organizacaoId`, `nome`, `descricao`, `prazoEscalonamentoHoras`)
SELECT 'setor_administracao', (SELECT `id` FROM `organizacoes` ORDER BY `id` LIMIT 1), 'Administração',
       'Manutenção predial: iluminação, banheiros, ar-condicionado, mobiliário.', 24
WHERE NOT EXISTS (SELECT 1 FROM `setores` WHERE `nome` = 'Administração');

INSERT INTO `categorias` (`id`, `organizacaoId`, `nome`, `descricao`)
SELECT 'manutencao', (SELECT `id` FROM `organizacoes` ORDER BY `id` LIMIT 1), 'Manutenção',
       'Equipamentos com defeito e problemas no prédio'
WHERE NOT EXISTS (SELECT 1 FROM `categorias` WHERE `id` = 'manutencao');

INSERT INTO `servicos` (`id`, `categoriaId`, `nome`, `descricao`, `ativo`)
SELECT 'manutencao-equipamento', 'manutencao', 'Equipamento com defeito',
       'Projetor, computador de laboratório, periférico, som da sala', true
WHERE NOT EXISTS (SELECT 1 FROM `servicos` WHERE `id` = 'manutencao-equipamento');

INSERT INTO `servicos` (`id`, `categoriaId`, `nome`, `descricao`, `ativo`)
SELECT 'manutencao-predial', 'manutencao', 'Manutenção predial',
       'Lâmpada, banheiro, ar-condicionado, porta, mobiliário', true
WHERE NOT EXISTS (SELECT 1 FROM `servicos` WHERE `id` = 'manutencao-predial');

INSERT INTO `regras_roteamento` (`id`, `nome`, `ordem`, `ativo`, `categoriaChave`, `servicoChave`, `setorId`, `setorCopiaId`, `atualizadoEm`)
SELECT 'regra_manut_equipamento', 'Manutenção de equipamentos', 10, true,
       'manutencao', 'manutencao-equipamento',
       (SELECT `id` FROM `setores` WHERE `nome` = 'Auxiliares Docentes' ORDER BY `id` LIMIT 1),
       (SELECT `id` FROM `setores` WHERE `nome` = 'Coordenação' ORDER BY `id` LIMIT 1),
       CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (SELECT 1 FROM `regras_roteamento` WHERE `id` = 'regra_manut_equipamento');

INSERT INTO `regras_roteamento` (`id`, `nome`, `ordem`, `ativo`, `categoriaChave`, `servicoChave`, `setorId`, `setorCopiaId`, `atualizadoEm`)
SELECT 'regra_manut_predial', 'Manutenção predial', 20, true,
       'manutencao', 'manutencao-predial',
       (SELECT `id` FROM `setores` WHERE `nome` = 'Administração' ORDER BY `id` LIMIT 1),
       NULL,
       CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (SELECT 1 FROM `regras_roteamento` WHERE `id` = 'regra_manut_predial');
