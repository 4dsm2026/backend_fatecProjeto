-- Altera descricao de VARCHAR(191) para TEXT nos chamados.
-- Também ajusta mensagem (conteudo) e notificacao (mensagem) que podem
-- receber textos longos e estavam sem anotação @db.Text.
ALTER TABLE `chamados` MODIFY COLUMN `descricao` TEXT NOT NULL;
ALTER TABLE `mensagens` MODIFY COLUMN `conteudo` TEXT NOT NULL;
ALTER TABLE `notificacoes` MODIFY COLUMN `mensagem` TEXT NOT NULL;
