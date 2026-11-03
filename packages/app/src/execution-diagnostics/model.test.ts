import { describe, expect, it } from "vitest";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import { analyzeExecutions, diagnosticItems, observeExecutions, redactEvidence } from "./model";

function call(
  id: string,
  status: "running" | "completed" | "failed" | "canceled" = "failed",
  overrides: Partial<ToolCallItem> = {},
): ToolCallItem {
  return {
    kind: "tool_call",
    id,
    turnId: "turn",
    timestamp: new Date(Number(id) * 1000),
    timelineCursor: { epoch: "epoch", seq: Number(id) },
    payload: {
      source: "agent",
      data: {
        provider: "codex",
        callId: id,
        name: "Shell",
        status,
        error: null,
        detail: {
          type: "shell",
          command: "go test ./domain/repo",
          cwd: "/project",
          exitCode: status === "completed" ? 0 : status === "running" ? null : 1,
          output: status === "failed" ? "--- FAIL: TestExternal" : "ok",
        },
      },
    },
    ...overrides,
  };
}

describe("execution diagnostics", () => {
  it("recognizes test failure and links only an exact later successful retry", () => {
    const rows = analyzeExecutions([call("1"), call("2", "completed")]);
    expect(rows[0]).toMatchObject({
      category: "test",
      status: "failed",
      recoveredBy: "epoch:2",
      timing: "unknown",
    });
    expect(rows[1]?.status).toBe("completed");
  });
  it.each(["turn", "epoch", "cwd", "command", "compound"])(
    "does not infer recovery after a changed %s",
    (change) => {
      const first = call("1");
      const second = call("2", "completed");
      if (change === "turn") second.turnId = "other";
      if (change === "epoch") second.timelineCursor = { epoch: "other", seq: 2 };
      if (second.payload.source === "agent" && second.payload.data.detail.type === "shell") {
        if (change === "cwd") second.payload.data.detail.cwd = "/other";
        if (change === "command") second.payload.data.detail.command = "go test ./other";
        if (
          change === "compound" &&
          first.payload.source === "agent" &&
          first.payload.data.detail.type === "shell"
        )
          first.payload.data.detail.command = second.payload.data.detail.command =
            "go test ./domain/repo; echo done";
      }
      expect(analyzeExecutions([first, second])[0]?.recoveredBy).toBeUndefined();
    },
  );
  it("does not fabricate durations for history and excludes canceled calls from failure", () => {
    const row = analyzeExecutions([call("1", "canceled")])[0];
    expect(row).toMatchObject({
      status: "canceled",
      timing: "unknown",
      slow: false,
    });
    expect(row?.durationMs).toBeUndefined();
  });
  it("measures only continuous observation and invalidates an interrupted running call", () => {
    const running = [call("1", "running")];
    const started = observeExecutions(running, new Map(), 100, true);
    const finished = observeExecutions([call("1", "completed")], started, 32100, true);
    expect(analyzeExecutions([call("1", "completed")], finished, 50000)[0]).toMatchObject({
      durationMs: 32000,
      timing: "observed",
      slow: true,
    });
    const interrupted = observeExecutions(running, started, 200, false);
    const recovered = observeExecutions([call("1", "completed")], interrupted, 500, true);
    expect(analyzeExecutions([call("1", "completed")], recovered)[0]?.durationMs).toBeUndefined();
    const disconnectedLater = observeExecutions([call("1", "completed")], finished, 60000, false);
    expect(analyzeExecutions([call("1", "completed")], disconnectedLater)[0]?.durationMs).toBe(
      32000,
    );
  });
  it("deduplicates tail/head, uses the latest result, and bounds loaded analysis", () => {
    expect(diagnosticItems([call("1", "running")], [call("1", "completed")])).toEqual([
      call("1", "completed"),
    ]);
    expect(
      diagnosticItems(
        Array.from({ length: 2100 }, (_, i) => call(String(i))),
        [],
      ),
    ).toHaveLength(2000);
  });
  it("does not convert successful warnings or search exit 1 into proven recovery", () => {
    const item = call("1", "completed");
    if (item.payload.source === "agent" && item.payload.data.detail.type === "shell")
      item.payload.data.detail.output = "WARNING: cgroup unavailable ERROR example fixture";
    expect(analyzeExecutions([item])[0]?.status).toBe("completed");
    const search = call("2");
    if (search.payload.source === "agent" && search.payload.data.detail.type === "shell")
      search.payload.data.detail.command = "rg absent .";
    expect(analyzeExecutions([search])[0]?.status).toBe("failed");
  });
  it("includes agent errors and uses provider-reported timing", () => {
    const item = call("1", "completed");
    if (item.payload.source === "agent")
      item.payload.data.detail = {
        type: "fetch",
        url: "https://example.com",
        durationMs: 45000,
      };
    const error: StreamItem = {
      kind: "notification",
      id: "err",
      sourceType: "error",
      timestamp: new Date(),
      level: "error",
      message: "OAuth expired",
    };
    expect(analyzeExecutions([item, error])).toMatchObject([
      { timing: "reported", slow: true },
      { category: "turn", status: "failed" },
    ]);
  });
  it("redacts common credentials from display copies", () => {
    expect(
      redactEvidence(
        'curl --token abc https://me:pw@example.com Authorization=secret Bearer xyz api_key="foo bar" #offer=encoded',
      ),
    ).not.toMatch(/abc|me:pw|secret|xyz|foo bar|encoded/);
  });
});
