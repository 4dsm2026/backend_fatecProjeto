-- AlterTable: usuarios — campos acadêmicos (sincronizados do sistema institucional)
ALTER TABLE `usuarios`
    ADD COLUMN `unidadeFatec`             VARCHAR(191) NULL,
    ADD COLUMN `curso`                   VARCHAR(191) NULL,
    ADD COLUMN `eixoTecnologico`         VARCHAR(191) NULL,
    ADD COLUMN `turno`                   VARCHAR(191) NULL,
    ADD COLUMN `turma`                   VARCHAR(191) NULL,
    ADD COLUMN `semestreAtual`           VARCHAR(191) NULL,
    ADD COLUMN `matrizCurricular`        VARCHAR(191) NULL,
    ADD COLUMN `situacaoAcademica`       VARCHAR(191) NULL,
    ADD COLUMN `anoSemestreIngresso`     VARCHAR(191) NULL,
    ADD COLUMN `coordenadorCurso`        VARCHAR(191) NULL,
    ADD COLUMN `telefoneCelular`              VARCHAR(20)  NULL,
    ADD COLUMN `whatsapp`                    VARCHAR(20)  NULL,
    ADD COLUMN `canalPreferencialContato`    VARCHAR(191) NULL,
    ADD COLUMN `melhorPeriodoContato`        VARCHAR(191) NULL,
    ADD COLUMN `necessitaAtendimentoAcessivel` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `tipoAcessibilidade`          VARCHAR(191) NULL,
    ADD COLUMN `observacoesAtendimento`      TEXT NULL;

-- AlterTable: chamados — campos do wizard do catálogo acadêmico e SLA
ALTER TABLE `chamados`
    ADD COLUMN `catalogoServicoId`     VARCHAR(191) NULL,
    ADD COLUMN `catalogoCategoriaId`   VARCHAR(191) NULL,
    ADD COLUMN `catalogoCategoriaNome` VARCHAR(191) NULL,
    ADD COLUMN `setorProvavel`         VARCHAR(191) NULL,
    ADD COLUMN `dadosAcademicos`       JSON NULL,
    ADD COLUMN `camposEspecificos`     JSON NULL,
    ADD COLUMN `origem`                VARCHAR(191) NULL,
    ADD COLUMN `precisaAcaoDoAluno`    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `observacaoInterna`     TEXT NULL,
    ADD COLUMN `slaHoras`              INTEGER NULL,
    ADD COLUMN `slaDias`               INTEGER NULL,
    ADD COLUMN `vencimentoSla`         DATETIME(3) NULL;

-- CreateIndex: tokens_reset_senha.tokenHash UNIQUE (schema drift fix — init migration omitiu o UNIQUE)
CREATE UNIQUE INDEX `tokens_reset_senha_tokenHash_key` ON `tokens_reset_senha`(`tokenHash`);

-- CreateIndex: auditoria.acao (schema drift fix — index faltando desde o init)
CREATE INDEX `auditoria_acao_idx` ON `auditoria`(`acao`);

-- CreateIndex: chamados novos campos de catálogo
CREATE INDEX `chamados_catalogoServicoId_idx` ON `chamados`(`catalogoServicoId`);
CREATE INDEX `chamados_origem_idx` ON `chamados`(`origem`);
