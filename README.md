# 🚀 Backend - Workflow FATEC

Guia prático para instalar, configurar e rodar a API localmente.

---

## 📋 Pré-requisitos

* **Node.js** (≥ 20)
* **Docker Desktop** (para execução isolada do banco MySQL e Adminer)

---

## 🛠️ Instalação e Execução

### 1. Preparar Variáveis de Ambiente
Navegue até a pasta do backend e crie o arquivo `.env` a partir do modelo `.env.example`:

```bash
cd backend_fatecProjeto
cp .env.example .env
```

#### ⚙️ Configurações de Ambiente (`.env`):
Abra o arquivo `.env` recém-criado e configure as variáveis principais:

* **`CORS_ORIGIN` e `APP_WEB_URL`**:
  Devem conter a URL exata do servidor onde o seu frontend está sendo executado (exemplo: `http://localhost:3000`).
  > 💡 **Dica:** Caso utilize portas ou origens adicionais (como `http://localhost:5173`), você pode especificar múltiplos endereços separando-os por vírgula (`http://localhost:3000,http://localhost:5173`).

* **`DATABASE_URL`**:
  String de conexão com o banco de dados MySQL seguindo o padrão:
  `DATABASE_URL="mysql://<USUARIO>:<SENHA>@localhost:<PORTA>/<NOME_DO_BANCO>"`
  
  > 📌 **Porta Externa Mapeada:** Por padrão no arquivo `docker-compose.yml`, o serviço expõe o MySQL na porta **`3307`** (para evitar conflito caso você já possua um MySQL rodando localmente na porta 3306).  
  > **Exemplo padrão:** `DATABASE_URL="mysql://root:root@localhost:3307/workflow_fatec"`

---

### 2. Subir o Banco de Dados (MySQL + Adminer via Docker)

Abra o aplicativo **Docker Desktop** na sua máquina e execute o comando abaixo para iniciar os contêineres do banco de dados e da ferramenta de administração:

```bash
docker compose up -d
```

> ⚠️ **Aviso de Portas (Ambiente Acadêmico / Redes Restritas):**
> - **MySQL:** Roda na porta host `3307` (mapeada para `3306` dentro do contêiner).
> - **Adminer (Interface web do banco):** Fica acessível por padrão em `http://localhost:8080` (Server: `db`, User: `root`, Pass: `root`, DB: `workflow_fatec`).
> - Se a porta `8080` estiver em uso em computadores de laboratório, altere o mapeamento no `docker-compose.yml` (por exemplo, de `"8080:8080"` para `"8081:8080"`).

---

### 3. Instalar Dependências e Executar Migrações do Banco

Com o contêiner do banco ativo, execute a instalação dos pacotes e a preparação do schema com o Prisma:

```bash
# Instalação das dependências
npm install

# Geração do client Prisma e criação das tabelas no MySQL
npm run prisma:generate
npm run prisma:push

# Inicialização de dados padrão no banco (categorias, setores, papéis e usuários)
npm run seed
```

#### 🔑 Credenciais Padrão do Seed (`npm run seed`):
Ao executar o seed, o banco é populado com contas iniciais para testes de desenvolvimento:

- **Administrador (Painel / Aba Funcionário):**
  - **E-mail:** `admin@example.com`
  - **Senha:** `wf-fatec2026`
- **Usuários de Teste (Alunos / Secretaria):**
  - **Exemplos de E-mail:** `joao.silva@aluno.fatec.sp.gov.br`, `ana.costa@fatec.sp.gov.br`
  - **Senha inicial:** `Fatec@2026` *(exige redefinição no 1º acesso)*

*(Nota: As credenciais de teste são definidas em `prisma/seed.js` e podem ser alteradas no script conforme a necessidade do projeto).*

---

### 4. Iniciar a API Backend

```bash
npm run dev
```

A API estará rodando em `http://localhost:3333`.
* **Documentação Interativa (Swagger):** `http://localhost:3333/docs`
* **Status do Servidor (Health check):** `http://localhost:3333/health`

---

## ⚠️ Troubleshooting (Problemas Comuns)

#### 1. Erro `P1001: Can't reach database server`
* **Causa:** O contêiner MySQL do Docker não está rodando ou a porta no `.env` não é a mesma exposta pelo Docker (`3307`).
* **Solução:** Verifique no Docker Desktop se os contêineres estão ativos e confirme se a `DATABASE_URL` no `.env` aponta para a porta configurada no `docker-compose.yml`.

#### 2. Erro de Bloqueio de CORS ao fazer requisições
* **Causa:** A origem da requisição do frontend (ex: `http://localhost:3000`) não está listada no `CORS_ORIGIN` do arquivo `.env` do backend.
* **Solução:** Adicione a URL do frontend na variável `CORS_ORIGIN` no `.env` e reinicie o backend (`npm run dev`).
