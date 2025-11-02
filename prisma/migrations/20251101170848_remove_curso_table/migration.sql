/*
  Warnings:

  - You are about to drop the column `cursoId` on the `usuarios` table. All the data in the column will be lost.
  - You are about to drop the `cursos` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `usuarios` DROP FOREIGN KEY `usuarios_cursoId_fkey`;

-- DropIndex
DROP INDEX `usuarios_cursoId_idx` ON `usuarios`;

-- AlterTable
ALTER TABLE `usuarios` DROP COLUMN `cursoId`,
    ADD COLUMN `cursoNome` VARCHAR(191) NULL,
    ADD COLUMN `cursoSigla` VARCHAR(16) NULL;

-- DropTable
DROP TABLE `cursos`;

-- CreateIndex
CREATE INDEX `usuarios_cursoSigla_idx` ON `usuarios`(`cursoSigla`);
