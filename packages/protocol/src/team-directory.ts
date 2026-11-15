import { z } from "zod";

// Deliberately excludes execution/session identifiers and task or conversation content.
export const TeamDirectorySchema = z.strictObject({
  ownerHostId: z.string().min(1).max(200),
  revision: z.number().int().nonnegative(),
  members: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(200),
        name: z.string().min(1).max(200),
        hostId: z.string().min(1).max(200),
        role: z.string().max(200),
        skills: z.array(z.string().max(200)).max(32),
      }),
    )
    .max(256),
});
export type TeamDirectory = z.infer<typeof TeamDirectorySchema>;
export const TeamDirectoryRequestSchema = z.object({
  type: z.literal("collaboration.directory.request"),
  requestId: z.string(),
  snapshot: TeamDirectorySchema.optional(),
});
export const TeamDirectoryResponseSchema = z.object({
  type: z.literal("collaboration.directory.response"),
  payload: z.object({
    requestId: z.string(),
    snapshot: TeamDirectorySchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const TeamDirectoryChangedSchema = z.object({
  type: z.literal("collaboration.directory.changed"),
});
