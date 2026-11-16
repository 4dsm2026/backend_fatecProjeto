/**
 * Respostas de erro (RFC 7807, application/problem+json) para os schemas
 * do Swagger. Só documentação: a validação real é Zod, no controller.
 */
export const ProblemSchema = {
  type: "object",
  required: ["type", "title", "status", "instance"],
  properties: {
    type: { type: "string" },
    title: { type: "string" },
    status: { type: "integer" },
    detail: { type: "string" },
    instance: { type: "string" },
    errors: { type: "array", items: { type: "object" } },
  },
} as const;

export const problemResponse = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: ProblemSchema } },
});

/** Os erros comuns de uma rota autenticada; `naoEncontrado` e `conflito` descrevem o recurso. */
export function commonProblemResponses(naoEncontrado: string, conflito: string) {
  return {
    400: problemResponse("Dados inválidos."),
    401: problemResponse("Autenticação obrigatória."),
    403: problemResponse("Papel sem permissão para a ação."),
    404: problemResponse(naoEncontrado),
    409: problemResponse(conflito),
    429: problemResponse("Limite de requisições excedido."),
    500: problemResponse("Erro inesperado."),
  } as const;
}
