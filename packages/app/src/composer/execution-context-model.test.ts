import { describe, expect, it } from "vitest";
import type { StreamItem, AgentToolCallItem } from "@/types/stream";
import { executionCheckoutEvidence } from "./execution-context-model";
function shell(status: AgentToolCallItem["payload"]["data"]["status"]): AgentToolCallItem {
  return {
    kind: "tool_call",
    id: "shell-1",
    timestamp: new Date(0),
    payload: {
      source: "agent",
      data: {
        provider: "codex",
        callId: "shell-1",
        name: "shell",
        status,
        error: null,
        detail: { type: "shell", command: "git status", cwd: "/repo" },
      },
    },
  };
}
describe("checkout refresh evidence", () => {
  it("refreshes for terminal tool outcomes, not running tools or streamed text", () => {
    const running = executionCheckoutEvidence("/repo", [shell("running")]);
    expect(running.revision).toBe("");
    const ignored = { kind: "assistant_message" } as StreamItem;
    expect(executionCheckoutEvidence("/repo", [shell("running"), ignored]).revision).toBe("");
    expect(executionCheckoutEvidence("/repo", [shell("completed")]).revision).toBe(
      "shell-1:completed",
    );
    expect(executionCheckoutEvidence("/repo", [shell("failed")]).revision).toBe("shell-1:failed");
    expect(executionCheckoutEvidence("/repo", [shell("completed")]).directories).toEqual([
      { path: "/repo", edited: false },
    ]);
  });
});
