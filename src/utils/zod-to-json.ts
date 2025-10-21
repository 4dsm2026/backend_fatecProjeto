// src/utils/zod-to-json.ts
import { z, ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// Converte um Zod schema (objeto interno) para JSON Schema com título único.
export function zodBody(schema: ZodTypeAny, title: string) {
  return zodToJsonSchema(schema, { name: title });
}
