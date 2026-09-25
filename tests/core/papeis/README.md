# Testes do módulo papeis

Contém testes unitários sobre o módulo papeis, em específico o Controller e Service:
'src/core/papeis/papeis.service.ts' e 'src/core/papeis/papeis.controller.ts'

## Como rodar

Executa todos os testes, incluindo testes não relacionados ao módulo papeis:

```bash
pnpm vitest
```

Executa apenas o teste do Service do módulo papeis:

```bash
pnpm vitest tests/coreTeste/papeis/papeis.service.test.ts
```

Executa apenas o teste do Controller do módulo papeis:

```bash
pnpm vitest tests/coreTeste/papeis/papeis.controller.test.ts
```

# Quais cenários os testes cobrem

Service
listPapeis → retorna lista ordenada

createPapel → cria novo papel

getPapel → busca papel por ID

updatePapel → atualiza papel existente

deletePapel → lança erro se papel estiver em uso, exclui se não estiver

Controller
list → retorna lista de papéis

create → cria papel e retorna 201

getOne → retorna 404 se papel não existir

patch → atualiza papel existente

removeHard → retorna 204 ao excluir, 409 se em uso, 404 se não encontrado