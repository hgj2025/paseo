import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
export const preferences = defineSettings({
  id: "integration",
  scope: "host",
  version: 1,
  schema: z.strictObject({
    enabled: z.boolean().default(true),
    runnerCommand: z.array(z.string().min(1)).min(1).default(["paseo-checked-cli"]),
  }),
});
