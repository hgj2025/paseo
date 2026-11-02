import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const memoryView = defineRpc({
  name: "memory-view",
  input: z.object({
    action: z.enum(["banks", "list", "detail"]),
    bank: z.string().min(1).max(200).optional(),
    id: z.string().min(1).max(200).optional(),
    query: z.string().max(200).optional(),
    type: z.enum(["world", "experience", "observation"]).optional(),
    offset: z.number().int().min(0).max(1000000).optional(),
  }),
  output: z.object({ data: z.any(), automation: z.any().optional() }),
});
