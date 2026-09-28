// src/utils/openapi-docs-only.ts
import type { FastifyInstance } from "fastify";

/**
 * Torna o `schema` das rotas deste plugin/instância "somente para
 * documentação" — sem efeito na validação ou na serialização em runtime.
 *
 * Por quê isto existe:
 * -------------------------------------------------------------------------
 * Este projeto valida entrada e serializa saída manualmente, via Zod
 * (ver src/utils/zod-helpers.ts), dentro de preHandlers e controllers —
 * e não pelo mecanismo nativo do Fastify (Ajv para schema.body/
 * querystring/params, fast-json-stringify para schema.response).
 *
 * Só que o @fastify/swagger só sabe gerar a documentação OpenAPI a partir
 * do objeto `schema` de cada rota. Se simplesmente adicionássemos um
 * `schema` "rico" (com body/response detalhados) às rotas para fins de
 * documentação, o Fastify passaria a USAR esse schema de verdade:
 *
 *   1) Ajv validaria body/querystring/params ANTES do preHandler rodar.
 *      Qualquer campo marcado como `required` no schema documental faria
 *      o Fastify devolver seu próprio erro 400 padrão
 *      ({ statusCode, error, message }) em vez do formato hoje usado
 *      pelo Zod ({ message: "Validação falhou", issues: [...] }) —
 *      uma mudança real de contrato para quem consome a API.
 *
 *   2) fast-json-stringify serializaria a resposta usando SOMENTE as
 *      propriedades listadas em `schema.response`. Qualquer campo real
 *      da resposta que não estivesse (ou ficasse desatualizado) no
 *      schema documental seria silenciosamente removido da resposta —
 *      um bug de produção difícil de perceber.
 *
 * Para evitar os dois riscos acima, sobrescrevemos aqui o
 * validatorCompiler (sempre aprova os dados como estão) e o
 * serializerCompiler (sempre faz um JSON.stringify comum, igual ao que
 * o Fastify já faz hoje quando não há schema.response nenhum) desta
 * instância. Isso é um mecanismo oficial do Fastify — não um hack — ver
 * "Validator Compiler" e "Serializer Compiler" em:
 * https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
 *
 * Graças ao encapsulamento de plugins do Fastify, chamar isto dentro de
 * uma função de rotas (ex.: authRoutes, anexoRoutes) afeta somente as
 * rotas registradas ali dentro — nunca o servidor inteiro.
 */
export function useDocsOnlySchemas(app: FastifyInstance): void {
  app.setValidatorCompiler(() => (data: unknown) => ({ value: data }));
  app.setSerializerCompiler(() => (data: unknown) => JSON.stringify(data));
}