import { expect, it } from "vitest";
import { CollaborationOperationSchema } from "./collaboration-bridge.js";
const agentId = "11111111-1111-4111-8111-111111111111";
it("limits operations to bounded agent actions and requires workspace/task identity for writes", () => {
  expect(CollaborationOperationSchema.safeParse({ op: "exec", command: "sh" }).success).toBe(false);
  expect(CollaborationOperationSchema.safeParse({ op: "archive", agentId }).success).toBe(false);
  expect(
    CollaborationOperationSchema.safeParse({
      op: "send",
      agentId,
      workspaceId: "w",
      prompt: "task",
    }).success,
  ).toBe(false);
  expect(CollaborationOperationSchema.safeParse({ op: "inspect", agentId }).success).toBe(true);
  expect(
    CollaborationOperationSchema.safeParse({ op: "wait", agentId, timeoutSeconds: 31 }).success,
  ).toBe(false);
  expect(CollaborationOperationSchema.safeParse({ op: "list" }).success).toBe(true);
});
