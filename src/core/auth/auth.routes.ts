import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  login,
  refresh,
  logout,
  me,
  register,
  getUser,
  firstAccess,
  forgotPassword,
  resetPassword,
  trocarSenha,
} from "./auth.controller";
import {
  buildRouteValidator,
  zEmail,
  zStringTrim,
} from "../../utils/zod-helpers";
import { z } from "zod";
import {
  LoginSchema,
  RefreshSchema,
  RegisterSchema,
  FirstAccessSchema,
  EsqueciSenhaSchema,
  ResetSenhaSchema,
} from "../../validators/auth";
import { useDocsOnlySchemas } from "../../utils/openapi-docs-only";

// Exemplos reutilizados em mais de um schema (evita sonarjs/no-duplicate-string).
const EXAMPLE_NOME = "João Silva";
const EXAMPLE_RAW_DB_ERROR = "Connection lost: The server closed the connection.";
const ACCESS_TOKEN_DESCRIPTION =
  "JWT de acesso (HS256). Expira conforme JWT_ACCESS_EXPIRES (padrão 15 minutos).";
const REFRESH_TOKEN_DESCRIPTION =
  "Token opaco de sessão (NÃO é um JWT). Validade fixa de 7 dias.";
const EXAMPLE_USER_NOT_FOUND = "Usuário não encontrado";

/* ===================== Fragmentos reutilizáveis do erro 400 ===================== */
// Corpo devolvido por formatZodError (src/utils/zod-helpers.ts) quando o
// preHandler rejeita o body por falha de schema.
const ValidationErrorSchema = {
  type: "object",
  title: "ErroDeValidacaoDeSchema",
  required: ["message", "issues"],
  properties: {
    message: { type: "string", example: "Validação falhou" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string", example: "newPassword" },
          message: { type: "string", example: "Mínimo de 8 caracteres" },
          code: { type: "string", example: "too_small" },
        },
      },
    },
  },
} as const;

/* ===================== Fragmentos reutilizáveis do 429 (rate limit) ===================== */
// O @fastify/rate-limit é registrado globalmente (src/plugins/rateLimit.ts,
// `global: true`, 100 req/min por IP) e se aplica a TODAS as rotas da API,
// inclusive esta. Por isso o 429 é documentado em todos os endpoints, não só
// nos de auth. Corpo exato do errorResponseBuilder configurado no plugin.
const RateLimitErrorSchema = {
  type: "object",
  title: "ErroDeRateLimit",
  properties: {
    statusCode: { type: "integer", example: 429 },
    error: { type: "string", example: "Too Many Requests" },
    message: {
      type: "string",
      example: "Limite de requisições atingido. Tente novamente em 42s.",
    },
  },
} as const;

// Headers que o @fastify/rate-limit adiciona por padrão em toda resposta
// (addHeadersOnExceeding), enquanto o limite ainda não foi atingido.
const RateLimitHeaders = {
  "x-ratelimit-limit": {
    type: "integer",
    description: "Quantas requisições o cliente pode fazer na janela atual (100/min por IP).",
  },
  "x-ratelimit-remaining": {
    type: "integer",
    description: "Quantas requisições ainda restam nessa janela de 1 minuto.",
  },
  "x-ratelimit-reset": {
    type: "integer",
    description: "Segundos até a janela atual de rate limit reiniciar.",
  },
} as const;

// Fragmento COMPLETO da resposta 429 (description + headers + corpo), pronto
// para ser usado como `429: RateLimit429Response` em qualquer endpoint —
// evita duplicar a mesma string de descrição em cada rota (sonarjs/no-duplicate-string).
const RateLimit429Response = {
  description:
    "Limite de requisições excedido: 100 requisições por minuto, por IP " +
    "(aplicado globalmente pelo @fastify/rate-limit — ver src/plugins/rateLimit.ts, " +
    "não é um limite específico deste endpoint).",
  headers: {
    ...RateLimitHeaders,
    "retry-after": {
      type: "integer",
      description: "Segundos que o cliente deve esperar antes de tentar novamente.",
    },
  },
  ...RateLimitErrorSchema,
} as const;

const GetUserQuerySchema = z.object({
  ra: zStringTrim.optional(),
  email: zEmail.optional(),
  id: zStringTrim.optional(),
  name: zStringTrim.optional(),
  educationalEmail: zEmail.optional(),
});

/* ===================== Fragmento reutilizável do 401 ===================== */
// Corpo exato enviado por src/plugins/auth-verify.ts quando o token de acesso
// está ausente, malformado, inválido ou expirado (auth-verify.ts não
// distingue a causa: qualquer falha vira este mesmo 401 genérico).
const UnauthorizedErrorSchema = {
  type: "object",
  title: "ErroNaoAutorizado",
  properties: {
    error: { type: "string", example: "Não autorizado" },
  },
} as const;

// Corpo do 401 alternativo: NÃO vem de auth-verify.ts, é uma checagem própria
// dentro dos handlers de /me e /trocar-senha (`if (!authUser?.sub)`), que só
// dispararia se um token passasse na verificação de assinatura/expiração mas
// não tivesse a claim `sub` no payload — praticamente inatingível em uso
// normal, já que todo token emitido por este backend sempre inclui `sub`
// (ver generateAccessToken em src/utils/jwt.ts). Documentado porque o código
// existe e tem uma mensagem diferente do 401 "oficial".
const SelfCheckUnauthenticatedSchema = {
  type: "object",
  title: "ErroNaoAutenticado",
  properties: {
    error: { type: "string", example: "Não autenticado" },
  },
} as const;

// Resposta 401 combinada, usada em endpoints que têm as DUAS checagens
// (auth-verify.ts + checagem própria do handler): /auth/me e /auth/trocar-senha.
const Unauthorized401WithSelfCheck = {
  description:
    "Token ausente, malformado, inválido ou expirado — verificado pelo " +
    "preHandler `app.authenticate` (`{ error: \"Não autorizado\" }`, o caso " +
    "comum) — OU token sintaticamente válido mas sem a claim `sub` no " +
    "payload — checagem redundante feita pelo próprio handler " +
    "(`{ error: \"Não autenticado\" }`, praticamente inatingível em uso " +
    "normal, já que todo token emitido por este backend sempre inclui `sub`).",
  oneOf: [UnauthorizedErrorSchema, SelfCheckUnauthenticatedSchema],
} as const;

/* ===================== Fragmento reutilizável do usuário público ===================== */
// Espelha EXATAMENTE `userPublicSelect` em auth.controller.ts (28 campos).
// Reaproveitado aqui (GET /auth/usuarios) e em GET /auth/me, que usam o
// mesmo select. Nulidade de cada campo conferida contra `model Usuario` em
// prisma/schema.prisma. OpenAPI gerado é 3.0.3 (default do @fastify/swagger
// quando `openapi.openapi` não é definido em swagger.ts — confirmado no
// código-fonte instalado do pacote), por isso usamos `nullable: true`
// (sintaxe 3.0.x) em vez de `type: ["string", "null"]` (sintaxe 3.1+).
const UsuarioPublicoSchema = {
  type: "object",
  title: "UsuarioPublico",
  additionalProperties: true,
  properties: {
    id: { type: "string", example: "cmj1234567890123456789012" },
    nome: { type: "string", example: EXAMPLE_NOME },
    emailPessoal: { type: "string", format: "email" },
    emailEducacional: { type: "string", format: "email", nullable: true },
    ra: {
      type: "string",
      nullable: true,
      description: "Registro Acadêmico (RA). Único quando presente, mas pode ser nulo.",
    },
    cursoNome: { type: "string", nullable: true },
    cursoSigla: { type: "string", nullable: true },
    papel: {
      type: "string",
      enum: ["USUARIO", "BACKOFFICE", "TECNICO", "ADMINISTRADOR"],
      example: "USUARIO",
    },
    ativo: { type: "boolean", description: "Conta desativada (false) não consegue logar." },
    precisaTrocarSenha: { type: "boolean" },
    passwordUpdatedAt: { type: "string", format: "date-time", nullable: true },
    criadoEm: { type: "string", format: "date-time" },
    atualizadoEm: { type: "string", format: "date-time" },
    unidadeFatec: { type: "string", nullable: true },
    curso: { type: "string", nullable: true },
    eixoTecnologico: { type: "string", nullable: true },
    turno: { type: "string", nullable: true },
    turma: { type: "string", nullable: true },
    semestreAtual: { type: "string", nullable: true },
    matrizCurricular: { type: "string", nullable: true },
    situacaoAcademica: { type: "string", nullable: true },
    anoSemestreIngresso: { type: "string", nullable: true },
    coordenadorCurso: { type: "string", nullable: true },
    telefoneCelular: { type: "string", nullable: true },
    whatsapp: { type: "string", nullable: true },
    canalPreferencialContato: { type: "string", nullable: true },
    melhorPeriodoContato: { type: "string", nullable: true },
    necessitaAtendimentoAcessivel: {
      type: "boolean",
      description: "Indica necessidade de atendimento acessível. Dado sensível.",
    },
    tipoAcessibilidade: {
      type: "string",
      nullable: true,
      description: "Detalhe do tipo de acessibilidade necessário. Dado sensível.",
    },
    observacoesAtendimento: {
      type: "string",
      nullable: true,
      description: "Observações livres sobre o atendimento ao usuário. Dado sensível.",
    },
    notificacoesInApp: {
      type: "boolean",
      description: "Preferência do usuário: receber notificações dentro do app.",
    },
  },
} as const;

const preBody =
  (schema: z.ZodTypeAny) =>
  async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const v = buildRouteValidator({ body: schema }).parse(req);
    if ("error" in v) {
      await reply.code(400).send(v.error);
    }
  };

const preQuery =
  (schema: z.ZodTypeAny) =>
  async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const v = buildRouteValidator({ query: schema }).parse(req);
    if ("error" in v) {
      await reply.code(400).send(v.error);
    }
  };

export default async function authRoutes(app: FastifyInstance) {
  // Faz com que o `schema` das rotas abaixo sirva só para o @fastify/swagger
  // gerar a documentação — a validação real continua 100% via Zod (preHandler),
  // exatamente como já era antes desta alteração. Ver o porquê detalhado em
  // src/utils/openapi-docs-only.ts.
  useDocsOnlySchemas(app);

  app.post(
    "/login",
    {
      preHandler: [preBody(LoginSchema)],
      schema: {
        tags: ["Auth"],
        summary: "Autenticar (login) por e-mail ou RA",
        description:
          "Endpoint público (não exige `Authorization`). Autentica com **exatamente " +
          "um** dos identificadores — `email` (funcionário/staff) OU `ra` (aluno) " +
          "— nunca os dois, nunca nenhum (imposto por um `.refine()` do Zod) — " +
          "mais `password`.\n\n" +
          "**Bloqueio de conta:** após 5 tentativas de senha incorreta seguidas " +
          "(`MAX_LOGIN_ATTEMPTS`), a conta é bloqueada por 15 minutos " +
          "(`LOCKOUT_DURATION_MS`). **Detalhe importante:** a tentativa que " +
          "CAUSA o bloqueio (a 5ª) ainda responde `401` (com uma mensagem " +
          "avisando do bloqueio) — só a partir da tentativa SEGUINTE, com a " +
          "conta já marcada como bloqueada no banco, é que a API responde " +
          "`423`. O bloqueio se desfaz sozinho (checagem preguiçosa, sem job " +
          "agendado): na primeira tentativa de login após o horário de " +
          "expiração do bloqueio, os contadores são resetados automaticamente.\n\n" +
          "**Primeiro acesso pendente:** se a conta tiver `precisaTrocarSenha=true`, " +
          "mesmo com a senha certa a API não loga — responde `428` e gera um " +
          "novo token de primeiro acesso (mesmo mecanismo de " +
          "`POST /auth/primeiro-acesso`: hash SHA-256 armazenado, validade de " +
          "24h, uso único). **Atenção:** gerar um novo token aqui NÃO invalida " +
          "tokens anteriores ainda não usados da mesma conta — é possível " +
          "existirem vários tokens simultaneamente válidos para o mesmo usuário " +
          "se o login for tentado mais de uma vez nesse estado.\n\n" +
          "**⚠️ Nota de segurança — enumeração de usuário via formato da " +
          "resposta:** tanto 'usuário não encontrado' quanto 'senha incorreta' " +
          "devolvem `401` com a mesma mensagem inicial (`\"Credenciais " +
          "inválidas\"`), o que é uma boa prática. Só que os dois casos têm " +
          "**formatos de corpo diferentes**: 'usuário não encontrado' nunca " +
          "inclui o campo `attemptsLeft`; 'senha incorreta' SEMPRE inclui " +
          "`attemptsLeft`, mesmo na primeira tentativa errada. Isso permite " +
          "distinguir programaticamente se um e-mail/RA existe no sistema só " +
          "pela presença desse campo — uma forma sutil de user enumeration " +
          "que sobrevive à mensagem de erro idêntica.\n\n" +
          "Todo login (sucesso ou falha, por qualquer motivo) é registrado em " +
          "auditoria (`registrarAuditoria` + tabela `loginTentativa`) como " +
          "efeito colateral — não afeta o corpo da resposta.",
        security: [],
        body: {
          description:
            "Exatamente um entre `email` e `ra` deve ser informado — nunca os " +
            "dois, nunca nenhum. `password` é sempre obrigatório.",
          oneOf: [
            {
              type: "object",
              title: "LoginPorEmail",
              required: ["email", "password"],
              not: { required: ["ra"] },
              properties: {
                email: {
                  type: "string",
                  format: "email",
                  description: "E-mail pessoal cadastrado (`emailPessoal`).",
                  example: "funcionario@example.com",
                },
                password: {
                  type: "string",
                  minLength: 8,
                  description: "Senha da conta. Só o comprimento mínimo é validado aqui.",
                  example: "Test@1234",
                },
              },
            },
            {
              type: "object",
              title: "LoginPorRA",
              required: ["ra", "password"],
              not: { required: ["email"] },
              properties: {
                ra: {
                  type: "string",
                  description: "Registro Acadêmico do aluno.",
                  example: "20231234",
                },
                password: {
                  type: "string",
                  minLength: 8,
                  description: "Senha da conta. Só o comprimento mínimo é validado aqui.",
                  example: "Test@1234",
                },
              },
            },
          ],
        },
        response: {
          200: {
            description:
              "Login bem-sucedido. Sessão criada, cookies " +
              "`accessToken`/`refreshToken` (não HttpOnly) definidos na " +
              "resposta. Aqui `precisaTrocarSenha` está sempre `false` — caso " +
              "contrário a resposta teria sido `428`, não `200`.",
            type: "object",
            additionalProperties: true,
            properties: {
              user: {
                type: "object",
                additionalProperties: true,
                description:
                  "Mais um subconjunto de campos DIFERENTE dos demais " +
                  "endpoints já documentados (nem os 4 de `/primeiro-acesso`, " +
                  "nem os 28 de `UsuarioPublico`, nem os 10 de `/register`).",
                properties: {
                  id: { type: "string", example: "cmj1234567890123456789012" },
                  nome: { type: "string", example: EXAMPLE_NOME },
                  ra: { type: "string", nullable: true, example: "20231234" },
                  papel: {
                    type: "string",
                    enum: ["USUARIO", "BACKOFFICE", "TECNICO", "ADMINISTRADOR"],
                    example: "USUARIO",
                  },
                  emailPessoal: { type: "string", format: "email" },
                  ativo: { type: "boolean", example: true },
                  precisaTrocarSenha: { type: "boolean", example: false },
                },
              },
              accessToken: {
                type: "string",
                description: ACCESS_TOKEN_DESCRIPTION,
              },
              refreshToken: {
                type: "string",
                description: REFRESH_TOKEN_DESCRIPTION,
              },
            },
          },
          400: {
            description:
              "Corpo fora do schema — nenhum identificador informado, os " +
              "dois informados ao mesmo tempo, ou `password` com menos de " +
              "8 caracteres.",
            ...ValidationErrorSchema,
          },
          401: {
            description:
              "Credenciais inválidas. Duas causas, **formatos de corpo " +
              "diferentes** (ver alerta de enumeração de usuário acima): " +
              "(1) usuário não encontrado, OU conta sem senha definida " +
              "(`senhaHash` nulo) — `{ error }`, sem `attemptsLeft`; " +
              "(2) senha incorreta — `{ error, attemptsLeft }`, sempre com " +
              "`attemptsLeft`. A mensagem de `error` no caso (2) muda " +
              "conforme as tentativas restantes: genérica se sobrarem 3+; " +
              "avisa a contagem regressiva se sobrarem 1–2; avisa que a " +
              "conta acabou de ser bloqueada se sobrarem 0 (mas o status " +
              "ainda é 401 nessa resposta específica — só a próxima tentativa " +
              "vira 423).",
            oneOf: [
              {
                type: "object",
                title: "CredenciaisInvalidasSemContagem",
                required: ["error"],
                properties: {
                  error: { type: "string", example: "Credenciais inválidas" },
                },
              },
              {
                type: "object",
                title: "CredenciaisInvalidasComContagem",
                required: ["error", "attemptsLeft"],
                properties: {
                  error: {
                    type: "string",
                    example: "Credenciais inválidas. 2 tentativa(s) restante(s) antes do bloqueio.",
                  },
                  attemptsLeft: {
                    type: "integer",
                    description: "Tentativas restantes antes do bloqueio de 15 minutos.",
                    example: 2,
                  },
                },
              },
            ],
          },
          403: {
            description: "A conta existe e a senha nem chega a ser conferida: `ativo=false`.",
            type: "object",
            properties: {
              error: { type: "string", example: "Usuário inativo" },
            },
          },
          423: {
            description:
              "Conta bloqueada por excesso de tentativas de senha incorreta " +
              "(ver explicação do mecanismo de bloqueio acima). `remainingTime` " +
              "é sempre em segundos, arredondado para cima.",
            type: "object",
            properties: {
              error: { type: "string", example: "Conta bloqueada" },
              message: {
                type: "string",
                example: "Muitas tentativas de login. Tente novamente em 15 minutos.",
              },
              remainingTime: {
                type: "integer",
                description: "Segundos restantes até o desbloqueio.",
                example: 900,
              },
            },
          },
          428: {
            description:
              "A senha está correta, mas a conta precisa trocar a senha antes " +
              "de poder logar (`precisaTrocarSenha=true`). Um novo token de " +
              "primeiro acesso é gerado e devolvido em `token` — use-o em " +
              "`POST /auth/primeiro-acesso`.",
            type: "object",
            properties: {
              code: { type: "string", example: "PASSWORD_CHANGE_REQUIRED" },
              message: {
                type: "string",
                example: "É necessário trocar a senha no primeiro acesso.",
              },
              token: {
                type: "string",
                description:
                  "Token bruto de primeiro acesso (uso único, válido por 24h). " +
                  "Usar em `POST /auth/primeiro-acesso`.",
              },
              user: {
                type: "object",
                additionalProperties: true,
                description:
                  "Mais um subconjunto de campos diferente — aqui vem `ra`, " +
                  "não `emailPessoal` (ao contrário do `user` devolvido por " +
                  "`POST /auth/primeiro-acesso`).",
                properties: {
                  id: { type: "string", example: "cmj1234567890123456789012" },
                  nome: { type: "string", example: EXAMPLE_NOME },
                  ra: { type: "string", nullable: true, example: "20231234" },
                  papel: {
                    type: "string",
                    enum: ["USUARIO", "BACKOFFICE", "TECNICO", "ADMINISTRADOR"],
                    example: "USUARIO",
                  },
                },
              },
            },
          },
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado no login. **Formato próprio, diferente dos " +
              "outros 5 endpoints já documentados:** `error` é a mensagem " +
              "crua da exceção (via `errMsg()`) E existe também um campo " +
              "`debug` com `e?.message` (ou `\"unknown_error\"` se ausente) — " +
              "na prática, quase sempre idêntico a `error`.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
              debug: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
            },
          },
        },
      },
    },
    login,
  );
  app.post("/refresh", { preHandler: [preBody(RefreshSchema)] }, refresh);
  app.post(
    "/logout",
    {
      preHandler: [preBody(RefreshSchema)],
      schema: {
        tags: ["Auth"],
        summary: "Encerrar sessão (logout)",
        description:
          "Endpoint público (não exige `Authorization`) — usa o `refreshToken` do " +
          "corpo como credencial, em vez de um access token no header `Authorization`.\n\n" +
          "Revoga (marca `revogadaEm`) a sessão associada ao `refreshToken`, " +
          "impedindo que ele seja usado depois em `POST /auth/refresh`.\n\n" +
          "**Idempotente e nunca falha por token inválido:** se o `refreshToken` já " +
          "estiver expirado, já revogado, ou não corresponder a nenhuma sessão " +
          "existente, o endpoint AINDA responde `200 { message: \"Logout OK\" }` — " +
          "não há 401/404 para essa situação; a existência ou não da sessão nunca " +
          "é revelada ao cliente por este endpoint.\n\n" +
          "**Atenção — o `accessToken` (JWT) atual continua válido após o " +
          "logout.** Este projeto não mantém lista de revogação de JWTs: o " +
          "logout revoga apenas a sessão de refresh no banco. Um `accessToken` já " +
          "emitido continua sendo aceito por qualquer endpoint autenticado até " +
          "expirar sozinho (até 15 minutos, conforme `JWT_ACCESS_EXPIRES`). Além " +
          "disso, este endpoint **não limpa** os cookies `accessToken`/" +
          "`refreshToken` (não existe nenhuma chamada a `reply.clearCookie` em " +
          "todo o projeto) — cabe ao cliente descartá-los manualmente.",
        security: [],
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: {
            refreshToken: {
              type: "string",
              minLength: 20,
              description:
                "Refresh token opaco (o mesmo devolvido no login/primeiro acesso/" +
                "refresh anterior). Só o comprimento mínimo (20) é validado — não " +
                "há checagem de formato além disso.",
            },
          },
        },
        response: {
          200: {
            description:
              "Logout processado — sempre este resultado em caso de sucesso, " +
              "mesmo que o refreshToken já fosse inválido, expirado ou revogado.",
            type: "object",
            properties: {
              message: { type: "string", example: "Logout OK" },
            },
          },
          400: {
            description:
              "Corpo inválido: `refreshToken` ausente ou com menos de 20 caracteres.",
            ...ValidationErrorSchema,
          },
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado ao revogar a sessão (ex.: condição de corrida — a " +
              "sessão foi removida entre a leitura e a atualização). Mesma " +
              "observação do GET /auth/usuarios: `error` é a mensagem crua da " +
              "exceção (via `errMsg()`), não uma mensagem fixa nem sanitizada.",
            type: "object",
            properties: {
              error: { type: "string", example: "An operation failed because it depends on one or more records that were required but not found." },
            },
          },
        },
      },
    },
    logout,
  );
  app.post(
    "/register",
    {
      preHandler: [preBody(RegisterSchema)],
      schema: {
        tags: ["Auth"],
        summary: "Autorregistro de conta",
        description:
          "Endpoint público (não exige `Authorization`) de autorregistro. Cria a " +
          "conta, uma sessão e devolve os tokens de autenticação já no mesmo " +
          "corpo — não requer confirmação de e-mail nem aprovação: a conta " +
          "nasce com `ativo=true` imediatamente.\n\n" +
          "**⚠️ ALERTA DE SEGURANÇA — escalonamento de privilégio sem " +
          "autenticação.** O campo `role` do corpo é aceito livremente e " +
          "gravado como o papel (`papel`) da nova conta, **incluindo " +
          "`ADMINISTRADOR`**, sem qualquer verificação de quem está fazendo a " +
          "chamada (o endpoint é público). Ou seja: hoje, qualquer pessoa sem " +
          "nenhuma credencial consegue criar uma conta de administrador só " +
          "enviando `{\"role\": \"ADMINISTRADOR\"}` no corpo. Confirmado lendo " +
          "`register` em auth.controller.ts (`papel: role` é passado direto " +
          "para `tx.usuario.create`, sem nenhum `app.authorize([...])` " +
          "protegendo a rota) e `zPapelOptional` em zod-helpers.ts (aceita os " +
          "4 valores do enum `Papel`, sem distinção de privilégio). Documentado " +
          "aqui por completude — **isto é uma vulnerabilidade real do estado " +
          "atual do código, não uma limitação da documentação.**\n\n" +
          "**Política de senha mais fraca que o resto da API:** diferente de " +
          "`/auth/primeiro-acesso`, `/auth/trocar-senha` e `/auth/reset-senha` " +
          "(que exigem maiúscula, minúscula, número e símbolo), aqui `password` " +
          "só precisa ter no mínimo 8 caracteres — sem nenhuma outra exigência " +
          "de complexidade.\n\n" +
          "Se `ra` for informado, a conta já nasce com `precisaTrocarSenha=true` " +
          "(fluxo pensado para pré-cadastro de aluno que troca a senha depois).",
        security: [],
        body: {
          type: "object",
          required: ["email", "password", "name"],
          properties: {
            email: {
              type: "string",
              format: "email",
              description: "E-mail pessoal — vira o `emailPessoal` da conta (único no sistema).",
            },
            password: {
              type: "string",
              minLength: 8,
              description:
                "Senha da conta. Só o comprimento mínimo (8) é validado — " +
                "nenhuma exigência de maiúscula/minúscula/número/símbolo, " +
                "diferente de outros fluxos de senha desta API.",
              example: "minhasenha123",
            },
            name: {
              type: "string",
              minLength: 2,
              description: "Nome completo do usuário.",
              example: EXAMPLE_NOME,
            },
            role: {
              type: "string",
              enum: ["USUARIO", "BACKOFFICE", "TECNICO", "ADMINISTRADOR"],
              default: "USUARIO",
              description:
                "Papel da nova conta. **Aceito sem qualquer verificação de " +
                "quem chama o endpoint — ver alerta de segurança acima.** Um " +
                "valor que não seja um dos 4 listados é silenciosamente " +
                "substituído por `USUARIO` (não gera erro 400).",
            },
            educationalEmail: {
              type: "string",
              format: "email",
              description:
                "E-mail educacional (opcional). Sem restrição de unicidade no banco.",
            },
            ra: {
              type: "string",
              minLength: 3,
              maxLength: 32,
              pattern: "^[A-Za-z0-9._-]+$",
              description:
                "Registro Acadêmico (opcional, único no sistema). Só letras, " +
                "números, ponto, underline ou hífen. Se informado, a conta " +
                "nasce com `precisaTrocarSenha=true`.",
              example: "20231234",
            },
          },
        },
        response: {
          200: {
            description:
              "Conta criada com sucesso. Sessão criada e cookies " +
              "`accessToken`/`refreshToken` (não HttpOnly) definidos na resposta.",
            type: "object",
            additionalProperties: true,
            properties: {
              user: {
                type: "object",
                additionalProperties: true,
                description:
                  "Atenção: este subconjunto de campos é DIFERENTE tanto do " +
                  "de `/auth/primeiro-acesso` (4 campos) quanto do de " +
                  "`/auth/me` e `/auth/usuarios` (28 campos, `UsuarioPublico`).",
                properties: {
                  id: { type: "string", example: "cmj1234567890123456789012" },
                  nome: { type: "string", example: EXAMPLE_NOME },
                  emailPessoal: { type: "string", format: "email" },
                  emailEducacional: { type: "string", format: "email", nullable: true },
                  ra: { type: "string", nullable: true },
                  papel: {
                    type: "string",
                    enum: ["USUARIO", "BACKOFFICE", "TECNICO", "ADMINISTRADOR"],
                    example: "USUARIO",
                  },
                  ativo: { type: "boolean", example: true },
                  precisaTrocarSenha: { type: "boolean" },
                  criadoEm: { type: "string", format: "date-time" },
                  atualizadoEm: { type: "string", format: "date-time" },
                },
              },
              accessToken: {
                type: "string",
                description: ACCESS_TOKEN_DESCRIPTION,
              },
              refreshToken: {
                type: "string",
                description: REFRESH_TOKEN_DESCRIPTION,
              },
            },
          },
          400: {
            description: "Corpo fora do schema (campo obrigatório ausente ou mal formatado).",
            ...ValidationErrorSchema,
          },
          409: {
            description:
              "Conflito de unicidade. Duas causas possíveis: (1) `email` já " +
              "pertence a outra conta; (2) `ra` já pertence a outra conta. Em " +
              "condição de corrida (duas requisições simultâneas para o mesmo " +
              "e-mail/RA), a causa é inferida verificando se a string 'ra' " +
              "aparece na mensagem de erro do Prisma — uma checagem frágil, " +
              "mas é o que o código faz hoje.",
            type: "object",
            properties: {
              error: {
                type: "string",
                enum: ["Email já está em uso", "RA já está em uso"],
              },
            },
          },
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado ao criar a conta. **Formato diferente dos " +
              "outros endpoints já documentados:** aqui `error` é uma " +
              "mensagem FIXA, e a mensagem crua da exceção vem num campo " +
              "extra `details` (via `errMsg()`) — não em `error` como nos " +
              "demais 500 deste arquivo.",
            type: "object",
            properties: {
              error: { type: "string", example: "Erro ao criar o usuário" },
              details: {
                type: "string",
                example: EXAMPLE_RAW_DB_ERROR,
              },
            },
          },
        },
      },
    },
    register,
  );
  app.post(
    "/primeiro-acesso",
    {
      preHandler: [preBody(FirstAccessSchema)],
      schema: {
        tags: ["Auth"],
        summary: "Concluir o primeiro acesso (definir senha inicial)",
        description:
          "Endpoint público (não exige `Authorization`) usado para o usuário definir " +
          "a própria senha na primeira vez que acessa o sistema.\n\n" +
          "**Como o token chega ao usuário:** por e-mail, quando a conta é criada/" +
          "convidada (ver `enviarLinkPrimeiroAcesso`); OU devolvido no campo `token` " +
          "da resposta `428` de `POST /auth/login`, quando o usuário já existe mas " +
          "está com `precisaTrocarSenha=true`.\n\n" +
          "O token é de uso único e expira em 24 horas (é marcado como usado em " +
          "`usadoEm` assim que consumido com sucesso). Ao concluir com sucesso, a " +
          "API também cria uma sessão e define os cookies `accessToken` e " +
          "`refreshToken` (não HttpOnly) na resposta, além de devolvê-los no corpo.\n\n" +
          "**Nota de arquitetura:** este token usa a mesma tabela " +
          "(`tokens_reset_senha`) e o mesmo mecanismo de geração dos tokens de " +
          "`POST /auth/esqueci-senha` — a tabela não distingue \"tipo\" de " +
          "token, só o prazo de validade definido na criação (24h aqui, 1h em " +
          "`/esqueci-senha`). Na prática, um token de `/esqueci-senha` " +
          "(dentro da 1h de validade dele) também é aceito aqui, e vice-versa.",
        security: [],
        body: {
          type: "object",
          required: ["token", "newPassword"],
          properties: {
            token: {
              type: "string",
              minLength: 10,
              description:
                "Token bruto recebido por e-mail ou devolvido pelo campo `token` " +
                "da resposta 428 de POST /auth/login.",
              example: "3f1c9e2a7b8d4f0a91c6e5b2d8a7f4c1e0b9a8d7c6f5e4b3a2c1d0e9f8b7a6c5",
            },
            newPassword: {
              type: "string",
              minLength: 8,
              // Replica em uma única regra as 4 exigências do Zod: min. 8
              // caracteres, 1 minúscula, 1 maiúscula, 1 dígito e 1 símbolo.
              pattern: "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{8,}$",
              description:
                "Nova senha. Mínimo de 8 caracteres, com ao menos 1 letra " +
                "maiúscula, 1 minúscula, 1 número e 1 símbolo.",
              example: "NovaSenha1#",
            },
            personalEmail: {
              type: "string",
              format: "email",
              description:
                "E-mail pessoal a ser definido/atualizado no primeiro acesso " +
                "(opcional). Se já pertencer a outra conta, a API retorna 409.",
              example: "aluno@gmail.com",
            },
          },
        },
        response: {
          200: {
            description:
              "Primeiro acesso concluído: senha definida, sessão criada e " +
              "tokens de autenticação devolvidos.",
            type: "object",
            additionalProperties: true,
            headers: RateLimitHeaders,
            properties: {
              user: {
                type: "object",
                additionalProperties: true,
                properties: {
                  id: { type: "string", example: "cmj1234567890123456789012" },
                  nome: { type: "string", example: EXAMPLE_NOME },
                  papel: {
                    type: "string",
                    enum: ["USUARIO", "BACKOFFICE", "TECNICO", "ADMINISTRADOR"],
                    example: "USUARIO",
                  },
                  emailPessoal: {
                    type: "string",
                    format: "email",
                    example: "aluno@gmail.com",
                  },
                },
              },
              accessToken: {
                type: "string",
                description:
                  "JWT de acesso (HS256). Expira conforme JWT_ACCESS_EXPIRES " +
                  "(padrão 15 minutos). Usar no header `Authorization: Bearer <token>`.",
              },
              refreshToken: {
                type: "string",
                description:
                  "Token opaco de sessão (NÃO é um JWT) — string aleatória, " +
                  "armazenada com hash SHA-256 no banco. Validade fixa de 7 dias. " +
                  "Usado em POST /auth/refresh e POST /auth/logout.",
              },
            },
          },
          400: {
            description:
              "Falha de validação. Três causas possíveis: " +
              "(1) corpo fora do schema (`token`/`newPassword` ausentes ou mal " +
              "formatados) — formato `{ message, issues[] }`; " +
              "(2) `newPassword` não atende à política mínima de senha; " +
              "(3) `token` inválido, já utilizado ou expirado. As causas (2) e " +
              "(3) usam o formato `{ error }`.",
            oneOf: [
              ValidationErrorSchema,
              {
                type: "object",
                title: "ErroDeRegraDeNegocio",
                required: ["error"],
                properties: {
                  error: {
                    type: "string",
                    enum: [
                      "Senha não atende aos critérios mínimos.",
                      "Token inválido ou expirado.",
                    ],
                  },
                },
              },
            ],
          },
          403: {
            description:
              "O usuário vinculado ao token está inativo (`ativo=false`) e não " +
              "pode concluir o primeiro acesso.",
            type: "object",
            properties: {
              error: { type: "string", example: "Usuário inativo" },
            },
          },
          409: {
            description: "O `personalEmail` informado já está em uso por outra conta.",
            type: "object",
            properties: {
              error: {
                type: "string",
                example: "Este e-mail pessoal já está em uso",
              },
            },
          },
          429: RateLimit429Response,
          500: {
            description: "Erro inesperado ao concluir o primeiro acesso.",
            type: "object",
            properties: {
              error: {
                type: "string",
                example: "Erro ao concluir o primeiro acesso",
              },
            },
          },
        },
      },
    },
    firstAccess,
  );
  app.post(
    "/esqueci-senha",
    {
      preHandler: [preBody(EsqueciSenhaSchema)],
      schema: {
        tags: ["Auth"],
        summary: "Solicitar redefinição de senha (esqueci minha senha)",
        description:
          "Endpoint público (não exige `Authorization`). Recebe um e-mail e, se " +
          "corresponder a uma conta existente, ativa (`ativo=true`) e não " +
          "excluída (`deletadoEm=null`), envia por e-mail um link com um token " +
          "de redefinição de senha.\n\n" +
          "**`email` casa com `emailPessoal` OU `emailEducacional`** — o campo " +
          "do corpo não diferencia qual dos dois está sendo informado, a busca " +
          "é feita nos dois ao mesmo tempo (`OR`).\n\n" +
          "**✅ Proteção contra enumeração de usuário implementada " +
          "corretamente aqui** (ao contrário de `POST /auth/login` — ver nota " +
          "de segurança lá): a resposta é **sempre** a mesma mensagem " +
          "genérica de 200, **independente** de o e-mail existir, pertencer a " +
          "uma conta inativa, ou pertencer a uma conta excluída — nenhuma " +
          "dessas situações é diferenciável de fora.\n\n" +
          "**Token de validade DIFERENTE do usado em `POST /auth/primeiro-acesso`:** " +
          "aqui o token dura **1 hora** (`enviarLinkEsqueciSenha`), não 24h — " +
          "apesar de usar exatamente a mesma tabela (`tokens_reset_senha`) e o " +
          "mesmo mecanismo de geração (`gerarToken()`: 32 bytes aleatórios em " +
          "hex, hash SHA-256 armazenado). O comentário no código-fonte " +
          "(`reset-senha.service.ts`) confirma que é intencional: " +
          "\"Usa o TokenResetSenha (mesma tabela do reset normal)\". **Na " +
          "prática, como a tabela não tem nenhum campo de tipo/propósito, um " +
          "token gerado aqui também é aceito por `POST /auth/primeiro-acesso`, " +
          "e vice-versa** — a única diferença real entre os dois fluxos é o " +
          "prazo de validade definido no momento da criação. Use " +
          "`POST /auth/reset-senha` para efetivamente trocar a senha com o " +
          "token recebido.\n\n" +
          "**Sem cobertura de testes automatizados no momento** — não há " +
          "nenhum teste para este endpoint em todo o projeto (`forgotPassword`/" +
          "`enviarLinkEsqueciSenha` não aparecem em nenhum arquivo de teste).",
        security: [],
        body: {
          type: "object",
          required: ["email"],
          properties: {
            email: {
              type: "string",
              format: "email",
              description:
                "E-mail da conta — comparado tanto com `emailPessoal` quanto " +
                "com `emailEducacional`.",
              example: "aluno@example.com",
            },
          },
        },
        response: {
          200: {
            description:
              "Sempre esta resposta em caso de corpo válido — " +
              "independentemente de existir uma conta correspondente, ativa " +
              "e não excluída. Não é possível diferenciar de fora se um " +
              "e-mail de fato disparou o envio.",
            type: "object",
            properties: {
              message: {
                type: "string",
                example:
                  "Se existir uma conta com esse e-mail, enviaremos um link para redefinir a senha.",
              },
            },
          },
          400: {
            description: "Corpo inválido: `email` ausente ou não é um e-mail válido.",
            ...ValidationErrorSchema,
          },
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado ao processar a solicitação. Diferente da " +
              "maioria dos outros endpoints já documentados, aqui a mensagem " +
              "é **fixa** — não vaza a exceção crua (mesmo padrão, mais " +
              "seguro, de `POST /auth/primeiro-acesso`).",
            type: "object",
            properties: {
              error: {
                type: "string",
                example: "Erro ao processar a solicitação de redefinição de senha",
              },
            },
          },
        },
      },
    },
    forgotPassword,
  );
  app.post("/reset-senha", { preHandler: [preBody(ResetSenhaSchema)] }, resetPassword);
  app.get(
    "/me",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Auth"],
        summary: "Obter o perfil do usuário autenticado",
        description:
          "Retorna o perfil completo (os mesmos 28 campos de `userPublicSelect` " +
          "usados em `GET /auth/usuarios`) do usuário dono do token de acesso " +
          "informado — o `sub` (ID) é extraído diretamente do JWT, não há " +
          "parâmetro na URL nem na querystring.\n\n" +
          "**Não verifica se a conta está ativa.** Diferente de outros endpoints " +
          "(ex.: `POST /auth/primeiro-acesso`), este NÃO checa `ativo` — um " +
          "usuário desativado, enquanto seu access token ainda não expirou " +
          "(até 15 min), continua conseguindo consultar o próprio perfil " +
          "normalmente com `200`.\n\n" +
          "**Por que um token válido pode gerar 404:** a verificação do token " +
          "(`app.authenticate`) checa apenas assinatura e expiração — não " +
          "consulta o banco. Se a conta correspondente ao `sub` do token for " +
          "excluída depois que o token foi emitido, o token continua " +
          "'tecnicamente válido' até expirar sozinho, mas este endpoint " +
          "responde `404`, pois o usuário não é mais encontrado.",
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: "Perfil do usuário autenticado.",
            ...UsuarioPublicoSchema,
          },
          401: Unauthorized401WithSelfCheck,
          404: {
            description:
              "O usuário identificado pelo `sub` do token não existe mais no " +
              "banco (conta excluída após o token ter sido emitido — ver nota " +
              "acima). Confirmado por teste próprio do projeto " +
              "('404 — usuário do token foi deletado').",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_USER_NOT_FOUND },
            },
          },
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado ao consultar o perfil. Mesma observação do " +
              "GET /auth/usuarios: `error` é a mensagem crua da exceção " +
              "(via `errMsg()`), não sanitizada.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
            },
          },
        },
      },
    },
    me,
  );
  app.post(
    "/trocar-senha",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Auth"],
        summary: "Trocar a própria senha (autenticado)",
        description:
          "Requer token de acesso válido. Troca a senha do usuário dono do " +
          "token, **exigindo a senha atual como reautenticação** — uma boa " +
          "prática de segurança: só possuir um `accessToken` válido (que dura " +
          "até 15 min e pode ter sido obtido momentos antes por alguém que " +
          "roubou o token) não basta para trocar a senha sozinho.\n\n" +
          "**Efeito colateral importante — revoga TODAS as sessões (inclusive " +
          "a atual):** ao trocar a senha com sucesso, a API revoga " +
          "(`revogadaEm`) todas as sessões de refresh ativas do usuário, sem " +
          "exceção — inclusive a sessão de refresh do próprio dispositivo que " +
          "fez a chamada (não há como a API saber qual sessão de refresh " +
          "\"pertence\" a esta chamada, já que a autenticação aqui é feita " +
          "pelo `accessToken`/JWT, não pelo `refreshToken`). Na prática, " +
          "depois de trocar a senha, TODOS os dispositivos (inclusive o " +
          "atual) vão precisar fazer login de novo na próxima vez que " +
          "precisarem de `POST /auth/refresh`. **Mas, como em " +
          "`POST /auth/logout`, o `accessToken` (JWT) já emitido continua " +
          "válido até expirar sozinho** — a revogação atinge só as sessões " +
          "de refresh, não o JWT em uso no momento.\n\n" +
          "Toda tentativa (sucesso ou falha por senha atual incorreta) é " +
          "registrada em auditoria (`registrarAuditoria`) como efeito " +
          "colateral — não afeta o corpo da resposta.",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["senhaAtual", "novaSenha"],
          properties: {
            senhaAtual: {
              type: "string",
              minLength: 1,
              description: "Senha atual da conta, para reautenticação.",
            },
            novaSenha: {
              type: "string",
              minLength: 8,
              pattern: "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{8,}$",
              description:
                "Nova senha. Mínimo de 8 caracteres, com ao menos 1 letra " +
                "maiúscula, 1 minúscula, 1 número e 1 símbolo — mesma regra " +
                "de `POST /auth/primeiro-acesso` (mais rígida que a de " +
                "`POST /auth/register`, `POST /auth/login` e, adiantando, " +
                "`POST /auth/reset-senha`).",
              example: "NovaSenha1#",
            },
          },
        },
        response: {
          200: {
            description:
              "Senha alterada. Todas as sessões de refresh do usuário " +
              "(inclusive a atual) são revogadas — ver nota acima.",
            type: "object",
            properties: {
              message: { type: "string", example: "Senha alterada com sucesso" },
            },
          },
          400: {
            description:
              "Três causas possíveis: (1) corpo fora do schema — formato " +
              "`{ message, issues[] }`; (2) `senhaAtual` não confere com a " +
              "senha cadastrada — `{ error: \"Senha atual incorreta\" }`; " +
              "(3) `novaSenha` não atende à política mínima — " +
              "`{ error: \"A nova senha não atende aos critérios mínimos.\" }` " +
              "(na prática inatingível: o Zod já rejeita a mesma condição " +
              "antes, com o formato (1), mesmo padrão de `/primeiro-acesso`).",
            oneOf: [
              ValidationErrorSchema,
              {
                type: "object",
                title: "ErroDeRegraDeNegocio",
                required: ["error"],
                properties: {
                  error: {
                    type: "string",
                    enum: [
                      "Senha atual incorreta",
                      "A nova senha não atende aos critérios mínimos.",
                    ],
                  },
                },
              },
            ],
          },
          401: Unauthorized401WithSelfCheck,
          404: {
            description:
              "O usuário do token não tem senha cadastrada (`senhaHash` " +
              "nulo/ausente) — pode ser porque a conta foi excluída depois do " +
              "token ser emitido (mesmo cenário de `GET /auth/me`), ou porque " +
              "o hash foi limpo por outro caminho enquanto o token ainda não " +
              "havia expirado.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_USER_NOT_FOUND },
            },
          },
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado ao trocar a senha. Mesma observação de " +
              "`GET /auth/usuarios`: `error` é a mensagem crua da exceção " +
              "(via `errMsg()`), não sanitizada.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
            },
          },
        },
      },
    },
    trocarSenha,
  );
  app.get(
    "/usuarios",
    {
      preHandler: [app.authenticate, preQuery(GetUserQuerySchema)],
      schema: {
        tags: ["Auth", "Usuarios"],
        summary: "Buscar usuários por RA, e-mail, ID ou nome",
        description:
          "Retorna uma lista de usuários que casam com os filtros informados na " +
          "querystring. **Todos os filtros são opcionais e combináveis (AND)** — " +
          "`id`, `ra`, `email` e `educationalEmail` são comparações exatas; `name` " +
          "é busca parcial (`LIKE '%valor%'`). Como o banco é MySQL, essa busca por " +
          "nome normalmente já é case-insensitive por padrão (depende da collation " +
          "configurada no servidor), diferente do Postgres.\n\n" +
          "**Se nenhum filtro for informado, retorna TODOS os usuários cadastrados " +
          "no sistema.**\n\n" +
          "**Atenção — controle de acesso:** este endpoint exige apenas um token " +
          "válido (`Authorization: Bearer`). Não há checagem de papel (`role`) — " +
          "qualquer usuário autenticado, de qualquer papel, pode consultar o " +
          "perfil completo (todos os 28 campos de `userPublicSelect`, incluindo " +
          "telefone, WhatsApp e dados de acessibilidade) de qualquer outro usuário " +
          "do sistema.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "Filtra pelo ID exato do usuário. Não há checagem de formato — um " +
                "valor que não seja um ID válido apenas resulta em 0 resultados (404).",
            },
            ra: { type: "string", description: "Filtra pelo RA (Registro Acadêmico) exato." },
            email: {
              type: "string",
              format: "email",
              description: "Filtra pelo e-mail pessoal exato. Deve ser um e-mail válido.",
            },
            educationalEmail: {
              type: "string",
              format: "email",
              description: "Filtra pelo e-mail educacional exato. Deve ser um e-mail válido.",
            },
            name: {
              type: "string",
              description: "Busca parcial (substring) pelo nome do usuário.",
              example: "Silva",
            },
          },
        },
        response: {
          200: {
            description:
              "Lista de usuários encontrados (sempre com pelo menos 1 item — " +
              "zero resultados gera 404, não uma lista vazia).",
            type: "array",
            items: UsuarioPublicoSchema,
          },
          400: {
            description:
              "Falha de validação da querystring — só ocorre se `email` ou " +
              "`educationalEmail` forem informados com formato inválido.",
            ...ValidationErrorSchema,
          },
          401: {
            description: "Token de acesso ausente, malformado, inválido ou expirado.",
            ...UnauthorizedErrorSchema,
          },
          404: {
            description: "Nenhum usuário casa com os filtros informados.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_USER_NOT_FOUND },
            },
          },
          429: RateLimit429Response,
          500: {
            description:
              "Erro inesperado ao consultar usuários. **Atenção:** diferente de " +
              "outros endpoints do módulo de auth, aqui `message` é o texto bruto " +
              "da exceção capturada (`err.message`, via `errMsg()`), não uma " +
              "mensagem fixa — pode expor detalhes internos (ex.: erro do driver " +
              "do banco). Não é sanitizado antes de ir para o cliente.",
            type: "object",
            properties: {
              error: { type: "string", example: EXAMPLE_RAW_DB_ERROR },
            },
          },
        },
      },
    },
    getUser,
  );
}
