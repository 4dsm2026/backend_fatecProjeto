/*
  Warnings:

  - You are about to drop the column `passwordUpdatedAt` on the `usuarios` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `usuarios` DROP COLUMN `passwordUpdatedAt`;

-- RenameIndex
ALTER TABLE `auditoria` RENAME INDEX `auditoria_feitoPorId_fkey` TO `auditoria_feitoPorId_idx`;
