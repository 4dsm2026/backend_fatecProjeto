import { z } from "zod";
import { PaginationQuerySchema } from "../hateoas";

const zUrl = z.string().trim().max(500).url("Informe um endereço completo (https://…)");
const zXpath = z.string().trim().min(2, "Informe o XPath").max(500);

export const FonteSchema = z.object({
  body: z
    .object({
      url: zUrl.nullable().optional().or(z.literal("")),
      xpath: zXpath.nullable().optional().or(z.literal("")),
      atualizacaoAutomatica: z.boolean().optional(),
    })
    .refine((b) => Object.keys(b).length > 0, { message: "Informe ao menos um campo" }),
});

export const TesteFonteSchema = z.object({
  body: z.object({ url: zUrl, xpath: zXpath }),
});

export const VersoesListSchema = z.object({ query: PaginationQuerySchema });

export const VersaoIdSchema = z.object({ params: z.object({ id: z.string().min(1).max(64) }) });
