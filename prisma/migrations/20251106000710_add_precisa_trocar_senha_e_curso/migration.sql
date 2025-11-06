-- AlterTable
ALTER TABLE `usuarios` ADD COLUMN `passwordUpdatedAt` DATETIME(3) NULL,
    ADD COLUMN `precisaTrocarSenha` BOOLEAN NOT NULL DEFAULT false;
