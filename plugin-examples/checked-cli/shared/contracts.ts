import { z } from "zod";

export const checkSchema = z.strictObject({
  pointer: z
    .string()
    .max(512)
    .refine(
      (v) => v === "" || (v.startsWith("/") && !/~(?![01])/u.test(v)),
      "Expected a JSON Pointer",
    ),
  type: z.enum(["object", "array", "string", "number", "boolean"]),
  optional: z.boolean().default(false),
  nullable: z.boolean().default(false),
});
export const validationSchema = z.strictObject({
  assertions: z
    .array(
      z.strictObject({
        pointer: checkSchema.shape.pointer,
        equals: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
      }),
    )
    .max(100)
    .default([]),
  checks: z.array(checkSchema).max(100).default([]),
  select: z
    .array(
      z
        .string()
        .refine(
          (v) => v === "" || (v.startsWith("/") && !/~(?![01])/u.test(v)),
          "Expected a JSON Pointer",
        ),
    )
    .max(100)
    .optional(),
});
export const requestSchema = validationSchema.extend({
  command: z.string().min(1).max(4096),
  args: z.array(z.string().max(65536)).max(256).default([]),
  cwd: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(20).max(300000).default(30000),
  maxOutputBytes: z
    .number()
    .int()
    .min(128)
    .max(8 * 1024 * 1024)
    .default(1024 * 1024),
});
export type Validation = z.infer<typeof validationSchema>;
export type Request = z.infer<typeof requestSchema>;
export interface Capture {
  version: 1;
  startedAt: string;
  durationMs: number;
  execution: "not-started" | "exited" | "uncertain";
  exitCode: number | null;
  signal: string | null;
  failure?: "spawn" | "timeout" | "output-limit" | "canceled";
  stdout: string;
  stderr: string;
}
export type FailureStage = "input" | "process" | "json" | "schema" | "business" | "receipt";
export type Outcome =
  | {
      ok: true;
      execution: Capture["execution"];
      exitCode: number | null;
      durationMs: number;
      data: unknown;
    }
  | {
      ok: false;
      stage: FailureStage;
      code: string;
      execution: Capture["execution"];
      exitCode: number | null;
      durationMs: number;
      message: string;
      pointer?: string;
    };
export const captureSchema: z.ZodType<Capture> = z.strictObject({
  version: z.literal(1),
  startedAt: z.string(),
  durationMs: z.number().nonnegative(),
  execution: z.enum(["not-started", "exited", "uncertain"]),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  failure: z.enum(["spawn", "timeout", "output-limit", "canceled"]).optional(),
  stdout: z.string(),
  stderr: z.string(),
});
