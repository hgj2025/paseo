import { z } from "zod";

export const TeamAliasSchema = z.string().regex(/^[A-Za-z0-9_\-\u4e00-\u9fff]{1,32}$/);
export const TeamMemberSchema = z.object({
  id: z.string().uuid(),
  alias: TeamAliasSchema,
  serverId: z.string().min(1),
  workspaceId: z.string().min(1),
  agentId: z.string().uuid(),
  provider: z.string(),
  role: z.string().max(1000),
  skills: z.array(z.string().max(40)).max(12),
});
export const TeamTaskSchema = z.object({
  id: z.string().uuid(),
  memberId: z.string().uuid(),
  senderId: z.string().uuid().nullable(),
  prompt: z.string().max(40000),
  status: z.enum(["sending", "running", "permission", "completed", "failed", "uncertain"]),
  result: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  observedRunning: z.boolean(),
  notification: z.enum(["pending", "sending", "delivered", "uncertain", "none"]),
  notificationId: z.string().optional(),
  groupId: z.string().uuid().optional(),
});
export const TeamGroupStepSchema = z.object({
  memberId: z.string().uuid(),
  prompt: z.string().min(1).max(40000),
  dependsOn: z.array(z.string().uuid()).max(32),
  taskIds: z.array(z.string().uuid()),
  status: z.enum([
    "queued",
    "running",
    "permission",
    "completed",
    "failed",
    "uncertain",
    "blocked",
  ]),
  result: z.string(),
});
export const TeamGroupSchema = z.object({
  id: z.string().uuid(),
  mode: z.enum(["coordinate", "broadcast"]),
  prompt: z.string().min(1).max(40000),
  memberIds: z.array(z.string().uuid()).min(1).max(32),
  senderId: z.string().uuid(),
  captainId: z.string().uuid(),
  coordinatorTaskId: z.string().uuid(),
  status: z.enum(["planning", "clarification", "running", "completed", "failed", "uncertain"]),
  steps: z.array(TeamGroupStepSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  result: z.string(),
  notification: z.enum(["pending", "sending", "delivered", "uncertain"]),
  notificationId: z.string().uuid(),
  retryIds: z.array(z.string().uuid()),
});
export const WorkspaceTeamSchema = z.object({
  version: z.literal(1),
  workspaceId: z.string(),
  revision: z.number().int().nonnegative(),
  captainId: z.string().uuid().nullable(),
  members: z.array(TeamMemberSchema).max(32),
  tasks: z.array(TeamTaskSchema),
  groups: z.array(TeamGroupSchema).optional(),
});
export const TeamActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("read") }),
  z.object({
    kind: z.literal("join"),
    serverId: z.string().min(1),
    workspaceId: z.string().min(1),
    agentId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal("edit"),
    memberId: z.string().uuid(),
    revision: z.number().int(),
    alias: TeamAliasSchema,
    role: z.string().max(1000),
    skills: z.array(z.string().max(40)).max(12),
    captain: z.boolean(),
  }),
  z.object({ kind: z.literal("remove"), memberId: z.string().uuid(), revision: z.number().int() }),
  z.object({
    kind: z.literal("send"),
    memberId: z.string().uuid(),
    senderId: z.string().uuid().nullable(),
    taskId: z.string().uuid(),
    prompt: z.string().min(1).max(40000),
    groupId: z.string().uuid().optional(),
  }),
  z.object({
    kind: z.literal("start_group"),
    groupId: z.string().uuid(),
    senderId: z.string().uuid(),
    memberIds: z.array(z.string().uuid()).min(1).max(32),
    mode: z.enum(["coordinate", "broadcast"]),
    prompt: z.string().min(1).max(40000),
  }),
  z.object({
    kind: z.literal("plan_group"),
    groupId: z.string().uuid(),
    captainId: z.string().uuid(),
    steps: z
      .array(
        z.object({
          memberId: z.string().uuid(),
          prompt: z.string().min(1).max(40000),
          dependsOn: z.array(z.string().uuid()).max(32),
        }),
      )
      .min(1)
      .max(32),
  }),
  z.object({
    kind: z.literal("retry_group_step"),
    groupId: z.string().uuid(),
    memberId: z.string().uuid(),
    retryId: z.string().uuid(),
  }),
  z.object({ kind: z.literal("refresh_group"), groupId: z.string().uuid() }),
  z.object({ kind: z.literal("refresh"), taskId: z.string().uuid() }),
]);
export const WorkspaceTeamRequestSchema = z.object({
  type: z.literal("workspace.team.execute.request"),
  requestId: z.string(),
  workspaceId: z.string().min(1),
  action: TeamActionSchema,
});
export const WorkspaceTeamResponseSchema = z.object({
  type: z.literal("workspace.team.execute.response"),
  payload: z.object({
    requestId: z.string(),
    team: WorkspaceTeamSchema.nullable(),
    error: z.string().nullable(),
  }),
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;
export type TeamTask = z.infer<typeof TeamTaskSchema>;
export type WorkspaceTeam = z.infer<typeof WorkspaceTeamSchema>;
export type TeamAction = z.infer<typeof TeamActionSchema>;
export type TeamGroup = z.infer<typeof TeamGroupSchema>;
export type TeamGroupStep = z.infer<typeof TeamGroupStepSchema>;
