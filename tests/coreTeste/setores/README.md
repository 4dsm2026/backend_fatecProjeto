# 🧪 Testes do Módulo de Setores

## 📌 O que foi feito
Foram desenvolvidos testes unitários utilizando a biblioteca **Vitest** para o módulo de `setores`. O objetivo principal foi validar de forma isolada tanto as regras de negócio da aplicação (camada *Service*) quanto a manipulação das requisições e respostas HTTP (camada *Controller*). 

Para que os testes fossem rápidos e independentes do banco de dados real, utilizamos **mocks** do `PrismaClient` (para simular o banco de dados) e dos objetos do **Fastify** (`request` e `reply`).

## 🎯 O que os testes cobrem
Os testes cobrem cenários essenciais de **acertos (caminhos felizes)** e **erros (exceções e validações)** dentro das operações de CRUD:
- **Criação (Create)**: Confirma a persistência dos dados corretamente e o envio do status HTTP `201 Created`.
- **Busca/Leitura (Read)**: Valida a busca de um setor pelo ID e o retorno de erro `404 Not Found` quando o setor não existe.
- **Listagem e Atualização (Update)**: Garante que os métodos de atualizar e listar os setores devolvem a estrutura de dados esperada.
- **Exclusão (Delete)**: Testa a regra de negócio fundamental do sistema: **um setor não pode ser excluído se estiver em uso** (seja por chamados ou usuários vinculados), garantindo que um erro de conflito (`409 Conflict`) seja disparado nessa situação e que a exclusão ocorra normalmente (`204 No Content`) quando o setor estiver livre.

## 📊 Quantidade de Testes
No total, a suíte conta com **9 testes automáticos**, organizados da seguinte forma:

### Service (`setores.service.test.ts`) - 6 Testes
1. ✅ Deve criar um setor com sucesso (Sucesso)
2. ✅ Deve retornar um setor por ID quando existente (Sucesso)
3. ✅ Deve retornar a lista de setores cadastrados (Sucesso)
4. ✅ Deve atualizar um setor existente (Sucesso)
5. ✅ Deve remover o setor quando não houver vínculos (Sucesso)
6. ❌ Deve lançar erro ao tentar excluir setor com chamados vinculados (Erro)

### Controller (`setores.controller.test.ts`) - 3 Testes
7. ✅ Deve responder status 201 ao criar setor (Sucesso)
8. ❌ Deve retornar status 404 caso o setor não exista (Erro)
9. ❌ Deve retornar status 409 ao tentar remover setor em uso (Erro)

## 🚀 Como executar os testes

Certifique-se de estar na raiz do projeto e execute os comandos abaixo no terminal:

**1. Executar toda a suíte de Setores de uma vez:**
```bash
pnpm vitest run tests/coreTeste/setores
```

**2. Executar os testes em modo "Watch" (ideal para desenvolvimento, re-executa ao salvar):**
```bash
pnpm vitest tests/coreTeste/setores
```

**3. Executar os arquivos isoladamente:**
```bash
# Apenas os testes do Controller
pnpm vitest run tests/coreTeste/setores/setores.controller.test.ts

# Apenas os testes do Service
pnpm vitest run tests/coreTeste/setores/setores.service.test.ts
```

**4. Gerar o relatório de cobertura de código (Coverage):**
```bash
pnpm vitest run --coverage tests/coreTeste/setores
```