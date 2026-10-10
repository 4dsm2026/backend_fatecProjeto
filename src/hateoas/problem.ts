import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export type ErrorKind =
  | "bad-request"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "unprocessable"
  | "too-many-requests"
  | "internal";

const STATUS_BY_KIND: Record<ErrorKind, number> = {
  "bad-request": 400,
  unauthorized: 401,
  forbidden: 403,
  "not-found": 404,
  conflict: 409,
  unprocessable: 422,
  "too-many-requests": 429,
  internal: 500,
};

const KIND_BY_STATUS: Partial<Record<number, ErrorKind>> = {
  400: "bad-request",
  401: "unauthorized",
  403: "forbidden",
  404: "not-found",
  409: "conflict",
  422: "unprocessable",
  429: "too-many-requests",
};

const DEFAULT_TITLE: Record<ErrorKind, string> = {
  "bad-request": "Requisição inválida",
  unauthorized: "Não autenticado",
  forbidden: "Acesso negado",
  "not-found": "Recurso não encontrado",
  conflict: "Conflito",
  unprocessable: "Não foi possível processar",
  "too-many-requests": "Muitas requisições",
  internal: "Erro interno do servidor",
};

export interface FieldError {
  field: string;
  message: string;
}

/** Formato do corpo de erro (RFC 7807). */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  errors?: FieldError[];
}

/** Erro "esperado" da API. Lance com `throw new ApiError("not-found", "Chamado não encontrado")`. */
export class ApiError extends Error {
  readonly kind: ErrorKind;
  readonly status: number;
  readonly detail?: string;
  readonly errors?: FieldError[];

  constructor(kind: ErrorKind, title: string, detail?: string, errors?: FieldError[]) {
    super(title);
    this.name = "ApiError";
    this.kind = kind;
    this.status = STATUS_BY_KIND[kind];
    this.detail = detail;
    this.errors = errors;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Converte os `issues` do zod em erros por campo (`path` unido por ponto). */
export function fieldErrorsFromZod(
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>,
): FieldError[] {
  return issues.map((issue) => ({ field: issue.path.join("."), message: issue.message }));
}

/** `/email` + contexto `body` (ou `/body/email`) vira `body.email`. */
function fieldFromValidation(item: Record<string, unknown>, context?: string): string {
  const instancePath = typeof item.instancePath === "string" ? item.instancePath : "";
  const segments = instancePath.split("/").filter(Boolean);
  const missing = isRecord(item.params) ? item.params.missingProperty : undefined;
  if (typeof missing === "string") segments.push(missing);
  if (context && segments[0] !== context) segments.unshift(context);
  return segments.join(".");
}

function validationErrors(error: Record<string, unknown>): FieldError[] | undefined {
  if (!Array.isArray(error.validation)) return undefined;
  const context = typeof error.validationContext === "string" ? error.validationContext : undefined;
  return error.validation.filter(isRecord).map((item) => ({
    field: fieldFromValidation(item, context),
    message: typeof item.message === "string" ? item.message : "Valor inválido",
  }));
}

function internalError(): ApiError {
  return new ApiError("internal", DEFAULT_TITLE.internal);
}

/** Transforma QUALQUER erro em `ApiError`. Erro desconhecido vira 500 genérico, sem vazar a mensagem. */
export function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (!isRecord(error)) return internalError();

  const errors = validationErrors(error);
  if (errors) return new ApiError("bad-request", "Dados inválidos", undefined, errors);

  if (error.code === "P2025") return new ApiError("not-found", DEFAULT_TITLE["not-found"]);
  if (error.code === "P2002") return new ApiError("conflict", "Registro já existe");

  const kind = typeof error.statusCode === "number" ? KIND_BY_STATUS[error.statusCode] : undefined;
  if (kind) {
    const detail = typeof error.message === "string" ? error.message : undefined;
    return new ApiError(kind, DEFAULT_TITLE[kind], detail);
  }

  return internalError();
}

export function toProblem(error: ApiError, instance: string): Problem {
  const problem: Problem = {
    type: `/errors/${error.kind}`,
    title: error.message,
    status: error.status,
    instance,
  };
  if (error.detail) problem.detail = error.detail;
  if (error.errors?.length) problem.errors = error.errors;
  return problem;
}

/** Envia o erro como `application/problem+json`. `instance` é o caminho sem a query string. */
export function sendProblem(reply: FastifyReply, request: FastifyRequest, error: ApiError): FastifyReply {
  const instance = request.url.split("?")[0];
  return reply.status(error.status).type("application/problem+json").send(toProblem(error, instance));
}

/** Registra o tratamento de erros e de rota inexistente (loga só os 5xx). */
export function registerProblemHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const apiError = normalizeError(error);
    if (apiError.status >= 500) request.log.error({ err: error }, "Erro não tratado");
    return sendProblem(reply, request, apiError);
  });

  app.setNotFoundHandler((request, reply) =>
    sendProblem(reply, request, new ApiError("not-found", DEFAULT_TITLE["not-found"], "A rota solicitada não existe")),
  );
}