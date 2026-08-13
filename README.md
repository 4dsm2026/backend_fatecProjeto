<a href="https://github.com/seu-usuario" target="_blank">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:B71C1C,100:FF1744&height=200&section=header&text=WorkFlow&fontSize=80&fontAlignY=35&animation=fadeIn&fontColor=white" width="100%"/>
</a>

![Status](https://img.shields.io/badge/status-ativo-brightgreen)

## 🚀 Do Zero ao Deploy Local

**Guia definitivo para rodar backend e frontend localmente — na ordem certa, sem surpresas.**

Siga cada etapa rigorosamente. Pular passos é o caminho mais curto para dores de cabeça com **CORS**, **tokens inconsistentes** e **variáveis de ambiente mal configuradas**. Nós já passamos por isso para que você não precise.

**Equipe Docs/DevOps** 

---
## 🧰 Pré-requisitos

![Node.js](https://img.shields.io/badge/-Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white&labelColor=2D2D2D)
![pnpm](https://img.shields.io/badge/-pnpm-F69220?style=for-the-badge&logo=pnpm&logoColor=white&labelColor=2D2D2D)
![Docker](https://img.shields.io/badge/-Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white&labelColor=2D2D2D)

# ⚠️ ATENÇÃO! ⚠️
<!-- Badge -->
<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%9A%A8-USE%20SEMPRE%20pnpm-FF0000?style=for-the-badge&logo=pnpm&logoColor=white&labelColor=1E1E1E" 
       alt="Use sempre pnpm" />
</p>

<!-- Aviso -->
<blockquote>
  <p align="center">
    <strong>⚠️ IMPORTANTE:</strong> Use sempre <code>pnpm</code>, <strong>nunca</strong> <code>npm</code>.
  </p>
  <p align="center">
    Ambos os repositórios possuem <code>pnpm-lock.yaml</code>. Instalar ou rodar com <code>npm</code> gera 
    <strong>inconsistência de versões</strong> e pode até <strong>não funcionar</strong> 
    (<code>npm run dev</code> falha porque as dependências não batem com o que o projeto espera).
  </p>
</blockquote>

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%90%B3-Docker%20Desktop%20instalado%20%26%20ABERTO-2496ED?style=for-the-badge&logo=docker&logoColor=white&labelColor=1E1E1E" 
       alt="Docker Desktop instalado e aberto" />
</p>

## 1. Backend
```bash
git clone https://github.com/maysanazario/backend_fatecProjeto.git
cd backend_fatecProjeto
pnpm install
```
Se aparecer `ERR_PNPM_IGNORED_BUILDS`, rode:
```bash
pnpm approve-builds
# marca todos pressionando a tecla 'a' (prisma, @prisma/client, argon2, esbuild, etc.) e confirma pressionando 'enter'
pnpm install
```
## Banco de dados (Docker)

```bash
docker compose up -d
```

Sobe MySQL 8 e o Adminer (`http://localhost:8080`).

<blockquote>
  <p align="center">
    <strong>⚠️ IMPORTANTE:</strong> A porta exposta é <code>3307</code>, <strong>não</strong> <code>3306</code>.
  </p>
  <p align="center">
    O <code>docker-compose.yml</code> mapeia essa porta de propósito, para <strong>não conflitar</strong> 
    com um MySQL local que a pessoa já tenha. O <code>.env.example</code> mostra <code>3306</code> — 
    <strong>precisa trocar</strong>.
  </p>
</blockquote>

<blockquote>
  <p align="center">
    <strong>⚠️ AVISO DE PORTAS (Ambiente Acadêmico / Redes Restritas)</strong>
  </p>
  
  <p align="left">
    <strong>1️⃣ MySQL:</strong>
    <br />
    &nbsp;&nbsp;• Porta no host: <code>3307</code>
    <br />
    &nbsp;&nbsp;• Porta no container: <code>3306</code>
    <br />
    &nbsp;&nbsp;• <em>(Mapeamento feito propositalmente para não conflitar com MySQL local)</em>
  </p>
  
  <p align="left">
    <strong>2️⃣ Adminer (Interface Web):</strong>
    <br />
    &nbsp;&nbsp;• Acesse: <code>http://localhost:8080</code>
    <br />
    &nbsp;&nbsp;• Server: <code>db</code> | User: <code>root</code> | Pass: <code>root</code> | DB: <code>workflow_fatec</code>
  </p>
  
  <p align="left">
    <strong>3️⃣ Se a porta 8080 estiver em uso:</strong>
    <br />
    &nbsp;&nbsp;• Edite o <code>docker-compose.yml</code>
    <br />
    &nbsp;&nbsp;• Altere <code>"8080:8080"</code> para <code>"8081:8080"</code> (ou porta disponível)
    <br />
    &nbsp;&nbsp;• Exemplo: <code>ports: - "8081:8080"</code>
  </p>
</blockquote>

## Variáveis de ambiente

```bash
cp .env.example .env
```

No `.env`, ajuste:

```dotenv
DATABASE_URL="mysql://root:root@localhost:3307/workflow_fatec"
CORS_ORIGIN=http://localhost:3000,http://192.168.152.1:3000
APP_WEB_URL=http://localhost:3000
```

- `CORS_ORIGIN` por padrão vem `http://localhost:5173` (porta de outro framework) — se não trocar pra `3000`, o login falha com "Failed to fetch" (é CORS bloqueado, mas o navegador não deixa claro).
- `APP_WEB_URL` é usado pra montar os links de e-mail (reset de senha, primeiro acesso).
- **Anote os valores de `JWT_ACCESS_SECRET`, `JWT_ISSUER` e `JWT_AUDIENCE`** — o frontend precisa dos mesmos valores exatos (ver seção do frontend).

## Banco: gerar client e aplicar schema

```bash
pnpm prisma:generate
pnpm prisma:migrate
```

### Popular com usuários de teste

```bash
pnpm prisma:seed
```

Cria:

| Papel | Login | Senha | Observação |
|---|---|---|---|
| Administrador | `admin@example.com` | `wf-fatec2026` | Entra direto |
| Secretaria (Backoffice) | `ana.costa@fatec.sp.gov.br` | `Fatec@2026` | Pede troca de senha no 1º acesso |
| Aluno | RA `123456789` | `Fatec@2026` | Pede troca de senha no 1º acesso |
| Aluno | RA `987654321` | `Fatec@2026` | Pede troca de senha no 1º acesso |
| Aluno | RA `998877665` | `Fatec@2026` | Pede troca de senha no 1º acesso |

### Rodar

```bash
pnpm dev
```

Sobe em `http://localhost:3333`.

---
## 2. Frontend

```bash
git clone https://github.com/maysanazario/frontend_fatecProjeto.git
cd frontend_fatecProjeto
pnpm install
```

Se aparecer `ERR_PNPM_IGNORED_BUILDS`, mesmo procedimento do backend (`pnpm approve-builds` + `pnpm install` de novo).

### Variáveis de ambiente

```bash
cp .env.example .env.local
```

⚠️ **Tem que ser `.env.local`, não `.env`** — é a convenção do Next.js, e sem isso `NEXT_PUBLIC_API_BASE_URL` fica vazia (o fetch do login cai em `localhost:3000/auth/login`, que não existe, e dá 404 disfarçado de erro genérico).

No `.env.local`:

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://localhost:3333
JWT_ACCESS_SECRET=<mesmo valor do .env do backend>
JWT_ISSUER=<mesmo valor do .env do backend>
JWT_AUDIENCE=<mesmo valor do .env do backend>
```

⚠️ **Ponto que mais confunde:** o `middleware.ts` do frontend valida o JWT de novo no servidor (pra proteger as rotas `/admin` e `/aluno`). Se `JWT_ACCESS_SECRET` (e issuer/audience) não forem **idênticos** aos do backend, a verificação falha silenciosamente — o login parece funcionar (token é gerado, toast de sucesso aparece), mas a pessoa é redirecionada de volta pro `/login` sem nenhuma mensagem de erro.

### Rodar

```bash
pnpm dev
```

Sobe em `http://localhost:3000`.

---

## Ordem recomendada pra testar do zero

1. Backend rodando (`pnpm dev` no terminal 1)
2. Frontend rodando (`pnpm dev` no terminal 2)
3. Acessar `http://localhost:3000/login`
4. Testar aba "Funcionário" com `admin@example.com` / `wf-fatec2026` → deve cair em `/admin/home`
5. Testar aba "Aluno (RA)" com RA `123456789` / `Fatec@2026` → espera-se erro 428 (obrigatoriedade de trocar senha), fluxo de "Primeiro acesso"

## Bug conhecido (ainda não corrigido em produção)

Na tela de login, os campos das abas "Funcionário" e "Aluno (RA)" compartilhavam o mesmo estado (`identifier`), e havia uma troca automática de aba enquanto a pessoa digitava um e-mail (detectava padrão de RA no meio da digitação). Corrigido localmente em `app/(public)/login/LoginContent.tsx`:
- Removida a troca automática de aba em `handleIdentifierChange`.
- Criada `handleModeChange`, que limpa o campo (`identifier`) ao trocar de aba manualmente.

# Guia de Commits e Colaboração

## 🎯 Convenção de Commits

Seguimos o padrão **Conventional Commits** para manter o histórico organizado e facilitar a geração automática de changelogs.

### Formato Padrão:

```
<tipo>[escopo opcional]: <descrição>

[corpo opcional]

[rodapé opcional]
```

### Regras Importantes:

* ✅ Use **presente do indicativo** ("adiciona" não "adicionado")
* ✅ Primeira letra **minúscula** na descrição
* ✅ **Sem ponto final** na descrição
* ✅ Máximo **50 caracteres** no título
* ✅ Linha em branco entre título e corpo
* ✅ Corpo com máximo **72 caracteres** por linha

---

## 📝 Estrutura das Mensagens

### Título (Obrigatório)

```
feat(auth): #tarefa adiciona sistema de login JWT
```

### Com Corpo (Opcional)

```
feat(auth): adiciona sistema de login JWT

Implementa autenticação usando JSON Web Tokens com:
- Middleware de validação
- Refresh token automático
- Logout seguro
```

### Com Breaking Change

```
feat(api)!: #tarefa altera estrutura de resposta da API

BREAKING CHANGE: campo 'data' agora é obrigatório em todas as respostas
```

---

## 🏷️ Tipos de Commit

| Tipo       | Descrição               | Exemplo                                     |
| ---------- | ----------------------- | ------------------------------------------- |
| `feat`     | Nova funcionalidade     | `feat(upload): adiciona drag and drop`      |
| `fix`      | Correção de bug         | `fix(auth): corrige validação de token`     |
| `docs`     | Documentação            | `docs(readme): atualiza guia de instalação` |
| `style`    | Formatação, espaços     | `style(css): ajusta indentação`             |
| `refactor` | Refatoração de código   | `refactor(api): simplifica validação`       |
| `test`     | Testes                  | `test(auth): adiciona testes unitários`     |
| `chore`    | Tarefas de build, deps  | `chore(deps): atualiza react para v18`      |
| `perf`     | Melhoria de performance | `perf(db): otimiza query de projetos`       |
| `ci`       | Integração contínua     | `ci(github): adiciona workflow de testes`   |
| `build`    | Sistema de build        | `build(webpack): configura hot reload`      |
| `revert`   | Reverter commit         | `revert: desfaz commit abc123`              |

---

## 💡 Exemplos Práticos

### ✅ Commits Bons

```bash
# Funcionalidade nova
feat(dashboard): #tarefa adiciona gráfico de produtividade

# Correção específica
fix(upload): #tarefa resolve erro de timeout em arquivos grandes

# Documentação
docs(api): #tarefa documenta endpoints de aprovação

# Refatoração
refactor(components): #tarefa  extrai lógica de validação

# Teste
test(upload): #tarefa  adiciona testes de integração

# Configuração
chore(eslint): #tarefa adiciona regras de TypeScript
```

### ❌ Commits Ruins

```bash
# Muito vago
fix: corrige bug

# Muito longo
feat: adiciona sistema completo de upload de arquivos com validação, preview, progress bar e notificações

# Tempo verbal errado
feat: adicionado login

# Sem contexto
update files

# Mistura múltiplas mudanças
feat: adiciona login e corrige bug do upload
```

---

## 🌊 Workflow do Git

### 1. Antes de Começar

```bash
# Sempre puxe as últimas mudanças
git pull origin main

# Crie uma branch para sua feature
git checkout -b feat/nome-da-feature
```

### 2. Durante o Desenvolvimento

```bash
# Adicione arquivos específicos
git add src/components/Login.tsx

# Ou adicione tudo (cuidado!)
git add .

# Commit com mensagem clara
git commit -m "feat(auth): adiciona componente de login"
```

### 3. Antes de Enviar

```bash
# Verifique o que será commitado
git status
git diff --staged

# Push da branch
git push origin feat/nome-da-feature
```

---

## 🌳 Estratégia de Branches

### Branches Principais

* `main` - Código de produção (sempre estável)
* `develop` - Integração de features (para desenvolvimento)

### Branches de Feature

```bash
# Nomenclatura
feat/nome-da-funcionalidade
fix/nome-do-bug
docs/nome-da-documentacao
refactor/nome-da-refatoracao

# Exemplos
feat/upload-artes
feat/dashboard-designer
fix/login-validation
docs/api-documentation
```

### Fluxo de Trabalho

```bash
# 1. Criar branch a partir da main
git checkout main
git pull origin main
git checkout -b feat/nova-funcionalidade

# 2. Desenvolver e commitar
git add .
git commit -m "feat(upload): adiciona validação de arquivos"

# 3. Push e Pull Request
git push origin feat/nova-funcionalidade
# Criar PR no GitHub
```

---

## 🔄 Pull Requests

### Template de PR

```markdown
## 📝 Descrição
Breve descrição das mudanças implementadas.

## 🎯 Tipo de Mudança
- [ ] Bug fix
- [ ] Nova feature
- [ ] Breaking change
- [ ] Documentação

## ✅ Checklist
- [ ] Código testado localmente
- [ ] Testes passando
- [ ] Documentação atualizada
- [ ] Sem conflitos com main

## 📸 Screenshots (se aplicável)
[Adicionar prints das mudanças visuais]

## 🧪 Como Testar
1. Faça checkout da branch
2. Execute `pnpm install`
3. Execute `pnpm dev`
4. Teste a funcionalidade X
```

### Boas Práticas de PR

* ✅ **Título claro** e descritivo
* ✅ **Descrição detalhada** das mudanças
* ✅ **Screenshots** para mudanças visuais
* ✅ **Testes** incluídos quando necessário
* ✅ **Revisão** de pelo menos 1 colega
* ✅ **Conflitos resolvidos** antes do merge

---

## 🛠️ Comandos Úteis

### Verificação e Status

```bash
# Ver status dos arquivos
git status

# Ver diferenças
git diff
git diff --staged

# Ver histórico
git log --oneline
git log --graph --oneline --all
```

### Correções Rápidas

```bash
# Alterar última mensagem de commit
git commit --amend -m "nova mensagem"

# Adicionar arquivos ao último commit
git add arquivo.txt
git commit --amend --no-edit

# Desfazer último commit (mantém mudanças)
git reset --soft HEAD~1

# Desfazer mudanças não commitadas
git checkout -- arquivo.txt
git reset --hard HEAD
```

### Sincronização

```bash
# Atualizar branch local com remota
git pull origin main

# Rebase interativo (limpar histórico)
git rebase -i HEAD~3

# Sincronizar fork (se aplicável)
git remote add upstream URL_ORIGINAL
git fetch upstream
git merge upstream/main
```

---

## 🔧 Ferramentas Recomendadas

### Extensions do VS Code

* **GitLens** - Histórico e blame inline
* **Git Graph** - Visualização gráfica do histórico
* **Conventional Commits** - Autocomplete para commits

### Configuração do Git

```bash
# Configurar nome e email
git config --global user.name "Seu Nome"
git config --global user.email "seu.email@exemplo.com"

# Configurar editor padrão
git config --global core.editor "code --wait"

# Configurar merge tool
git config --global merge.tool vscode
```

### Aliases Úteis

```bash
# Adicionar ao ~/.gitconfig
[alias]
    st = status
    co = checkout
    br = branch
    ci = commit
    ca = commit -a
    ps = push
    pl = pull
    lg = log --oneline --graph --all
    unstage = reset HEAD --
```

---

## 📚 Recursos Adicionais

### Links Úteis

* [Conventional Commits](https://www.conventionalcommits.org/)
* [Git Flow](https://nvie.com/posts/a-successful-git-branching-model/)
* [GitHub Flow](https://guides.github.com/introduction/flow/)
* [Semantic Versioning](https://semver.org/)

### Comandos de Emergência

```bash
# Recuperar commit deletado
git reflog
git checkout <hash-do-commit>

# Limpar mudanças locais
git clean -fd
git reset --hard HEAD

# Voltar arquivo específico
git checkout HEAD -- arquivo.txt
```

---

## 🤝 Colaboração em Equipe

### Comunicação

* 💬 **Comente** nos PRs de forma construtiva
* 🔍 **Revise** o código dos colegas
* 📢 **Comunique** mudanças importantes no grupo
* ❓ **Tire dúvidas** antes de fazer mudanças grandes

### Responsabilidades

* 👤 **Cada um** é responsável por sua branch
* 🔄 **Todos** devem revisar PRs
* 📝 **Mantenha** commits organizados
* 🧪 **Teste** antes de fazer push

### Resolução de Conflitos

```bash
# Quando houver conflito no merge
git status  # Ver arquivos em conflito
# Editar arquivos manualmente
git add arquivo-resolvido.txt
git commit -m "resolve: conflito em arquivo-resolvido"
```

---

## 🎯 Resumo das Regras de Ouro

1. **Commits pequenos e frequentes** são melhores que commits grandes
2. **Uma mudança = um commit** (não misture funcionalidades)
3. **Teste antes de commitar** (evite quebrar o código dos colegas)
4. **Mensagens claras** ajudam todos a entender o histórico
5. **Pull antes de push** para evitar conflitos
6. **Use branches** para cada feature/correção
7. **Revise PRs** dos colegas com atenção
8. **Comunique mudanças** importantes para a equipe

---

*Criado para o Projeto Workflow - FATEC Cotia*

---


# 🚀 Como subir o backend

> Guia prático para rodar a API localmente com e sem Docker, incluindo variáveis de ambiente, Prisma e diagnóstico.

## ✅ Pré‑requisitos

* **Node.js** (>= 20)
* **pnpm** (>= 9)
* **Docker Desktop** (opção A) **ou** **MySQL 8** instalado local (opção B)

## 📄 `.env` mínimo (exemplo)

Crie a partir do `.env.example` e ajuste:

```env
NODE_ENV=development
PORT=3333
CORS_ORIGIN=http://localhost:5173
DATABASE_URL="mysql://root:root@127.0.0.1:3306/workflow_fatec"
JWT_ACCESS_SECRET=change-me
JWT_REFRESH_SECRET=change-me-too
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d
```

> Dica: use **127.0.0.1** em vez de `localhost` para evitar problemas de socket no macOS.

---

## 🅰️ Opção A — Com Docker (MySQL + Adminer)

### `docker-compose.yml`

> Coloque na raiz do projeto (ao lado do `package.json`).

```yaml
version: "3.9"
services:
  db:
    image: mysql:8
    container_name: wf_mysql
    command: ["--default-authentication-plugin=mysql_native_password"]
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: workflow_fatec
    ports:
      - "3306:3306"
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-proot"]
      interval: 10s
      timeout: 5s
      retries: 10
    volumes:
      - db_data:/var/lib/mysql

  adminer:
    image: adminer:4
    container_name: wf_adminer
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "8080:8080"
    environment:
      ADMINER_DEFAULT_DB_DRIVER: mysql
      ADMINER_DEFAULT_SERVER: db
      ADMINER_DEFAULT_DB_NAME: workflow_fatec

volumes:
  db_data:
```

### Subir e rodar

```bash
# 1) Variáveis
cp .env.example .env

# 2) Banco via Docker
docker compose up -d

# 3) Dependências e Prisma
npm i
npm run prisma:generate
npm run prisma:push

# 4) API
npm run dev
# Teste
curl -s http://127.0.0.1:3333/health
```

> Adminer: [http://localhost:8080](http://localhost:8080) (Server: `db`, User: `root`, Pass: `root`, DB: `workflow_fatec`).

---

## 🅱️ Opção B — Sem Docker (MySQL local / macOS Homebrew)

```bash
# Instalar e iniciar MySQL 8
brew install mysql@8.0
brew services start mysql@8.0
export PATH="/opt/homebrew/opt/mysql@8.0/bin:$PATH"

# Configurar usuário e banco
mysql -u root -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'root';"
mysql -u root -proot -e "CREATE DATABASE IF NOT EXISTS workflow_fatec;"

# Verificar servidor
mysqladmin -uroot -proot ping
mysql -uroot -proot -h 127.0.0.1 -P 3306 -e "SELECT VERSION();"

# Prisma e API
pnpm prisma:generate
pnpm prisma:push
pnpm dev
curl -s http://127.0.0.1:3333/health
```

> Windows: usar **Docker Desktop** ou **WSL2** com MySQL dentro do WSL.

---

## 🧪 Rotas de teste rápidas

```bash
# Health
curl -s http://127.0.0.1:3333/health

# (Opcional, se habilitadas)
# Criar admin de debug
curl -s -X POST http://127.0.0.1:3333/debug/seed-admin | jq
# Listar usuários
curl -s http://127.0.0.1:3333/debug/users | jq
```

---

## 🧰 Scripts úteis (package.json)

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "typecheck": "tsc -p . --noEmit",
    "prisma:generate": "prisma generate",
    "prisma:push": "prisma db push"
  }
}
```

---

## 🛟 Solução de problemas comuns

* **P1001: Can't reach database server**

  * Garanta MySQL ligado (Docker ou serviço local)
  * Use `127.0.0.1:3306` no `.env`
  * `mysqladmin -uroot -proot ping` deve responder `mysqld is alive`

* **`Module '@prisma/client' has no exported member 'PrismaClient'`**

  * Rode `pnpm prisma:generate`
  * Importe como `import { PrismaClient } from "@prisma/client";`

* **`EADDRINUSE: 3333`**

  * Descobrir processo: `lsof -i :3333`
  * Matar: `kill -9 <PID>`

* **`bcrypt`/`esbuild` ignorados no pnpm**

  * `pnpm approve-builds && pnpm i`


