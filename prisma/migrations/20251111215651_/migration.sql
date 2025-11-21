/*
  Warnings:

  - You are about to drop the column `passwordUpdatedAt` on the `usuarios` table. All the data in the column will be lost.
  - You are about to drop the column `precisaTrocarSenha` on the `usuarios` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `usuarios` DROP COLUMN `passwordUpdatedAt`,
    DROP COLUMN `precisaTrocarSenha`;
