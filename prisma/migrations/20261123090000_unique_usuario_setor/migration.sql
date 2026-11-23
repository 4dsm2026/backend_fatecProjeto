-- A criação do índice falha se existirem pares duplicados. Nenhum vínculo é removido.
-- Antes de aplicar em um banco existente, revise os resultados de:
-- SELECT usuarioId, setorId, COUNT(*) AS total FROM usuarios_setores
-- GROUP BY usuarioId, setorId HAVING COUNT(*) > 1;
ALTER TABLE `usuarios_setores`
  ADD UNIQUE INDEX `usuarios_setores_usuarioId_setorId_key` (`usuarioId`, `setorId`);

-- Executado apenas após a nova restrição ter sido criada com sucesso.
ALTER TABLE `usuarios_setores`
  DROP INDEX `usuarios_setores_usuarioId_setorId_papelId_key`;
