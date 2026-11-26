import { z } from "zod";

// Fixed agent operations only: no commands, paths, credentials or connection URLs cross this channel.
const agentId = z.string().uuid();
const workspaceId = z.string().min(1);
const taskId = z.string().uuid();
export const CollaborationOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("list") }),
  z.object({ op: z.literal("ping") }),
  z.object({ op: z.literal("inspect"), agentId, workspaceId: workspaceId.optional() }),
  z.object({ op: z.literal("archive"), agentId, workspaceId }),
  z.object({
    op: z.literal("send"),
    agentId,
    workspaceId,
    taskId,
    prompt: z.string().min(1).max(41000),
  }),
  z.object({ op: z.literal("observe"), agentId, workspaceId, taskId }),
  z.object({ op: z.literal("wait"), agentId, timeoutSeconds: z.number().int().min(1).max(30) }),
]);
export type CollaborationOperation = z.infer<typeof CollaborationOperationSchema>;
export const CollaborationRegisterRequestSchema = z.object({
  type: z.literal("collaboration.bridge.register.request"),
  requestId: z.string(),
  hostIds: z.array(z.string().min(1)).max(64),
});
export const CollaborationRegisterResponseSchema = z.object({
  type: z.literal("collaboration.bridge.register.response"),
  payload: z.object({ requestId: z.string(), subscriptionId: z.string() }),
});
export const CollaborationExecuteRequestSchema = z.object({
  type: z.literal("collaboration.bridge.execute.request"),
  requestId: z.string(),
  hostId: z.string().min(1),
  operation: CollaborationOperationSchema,
});
export const CollaborationExecuteResponseSchema = z.object({
  type: z.literal("collaboration.bridge.execute.response"),
  requestId: z.string(),
  result: z.unknown().optional(),
  error: z.string().max(2000).optional(),
});

export const CollaborationChangedSchema = z.object({
  type: z.literal("collaboration.bridge.changed"),
  hostId: z.string().min(1),
  agentId: z.string().uuid(),
});

export const CollaborationRoutesSchema = z.object({
  type: z.literal("collaboration.bridge.routes"),
  hostIds: z.array(z.string().min(1)).max(64),
});

export const CollaborationHealthRequestSchema = z.object({
  type: z.literal("collaboration.health.request"),
  requestId: z.string(),
});
export const CollaborationHealthResponseSchema = z.object({
  type: z.literal("collaboration.health.response"),
  payload: z.object({
    requestId: z.string(),
    checkedAt: z.string(),
    error: z.string().nullable(),
    routes: z.array(
      z.object({
        hostId: z.string(),
        label: z.string(),
        transport: z.enum(["mac", "ssh", "cli"]),
        status: z.enum(["ok", "error", "unchecked"]),
        latencyMs: z.number().nullable(),
        error: z.string().nullable(),
      }),
    ),
  }),
});
export type CollaborationHealthReport = z.infer<
  typeof CollaborationHealthResponseSchema
>["payload"];
