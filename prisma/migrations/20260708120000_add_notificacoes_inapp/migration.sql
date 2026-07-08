-- Preferência do usuário: receber notificações in-app (badge + lista).
ALTER TABLE `usuarios` ADD COLUMN `notificacoesInApp` BOOLEAN NOT NULL DEFAULT true;
