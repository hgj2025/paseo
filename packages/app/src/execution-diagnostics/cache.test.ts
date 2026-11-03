import { describe, expect, it } from "vitest";
import type { ToolCallItem } from "@/types/stream";
import { DiagnosticCache } from "./cache";
function call(
  id: string,
  status: "running" | "completed" = "completed",
  epoch = "v1",
): ToolCallItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(Number(id) * 1000),
    timelineCursor: { epoch, seq: Number(id) },
    payload: {
      source: "agent",
      data: {
        provider: "codex",
        callId: id,
        name: "shell",
        status,
        error: null,
        detail: {
          type: "shell",
          command: "echo --token secret",
          exitCode: status === "completed" ? 0 : null,
        },
      },
    },
  };
}
describe("local diagnostic cache", () => {
  it("keeps host identities distinct and uncollected sessions unknown", () => {
    const cache = new DiagnosticCache();
    expect(cache.get("vm", "same")).toBeUndefined();
    cache.ingest("mac", "same", [call("1")], [], { live: false, connected: true, now: 1 });
    expect(cache.get("vm", "same")).toBeUndefined();
    expect(cache.get("mac", "same")?.rows).toHaveLength(1);
    expect(JSON.stringify(cache.get("mac", "same"))).not.toContain("secret");
  });
  it("retains observations while settings is closed and invalidates gaps", () => {
    const cache = new DiagnosticCache();
    cache.ingest("mac", "a", [call("1", "running")], [], { live: true, connected: true, now: 100 });
    cache.tick(32000);
    expect(cache.get("mac", "a")?.rows[0]).toMatchObject({ slow: true, durationMs: 31900 });
    cache.invalidate("mac");
    cache.ingest("mac", "a", [call("1")], [], { live: true, connected: true, now: 40000 });
    expect(cache.get("mac", "a")?.rows[0]?.timing).toBe("unknown");
  });
  it("clears old epochs and bounds both cache dimensions", () => {
    const cache = new DiagnosticCache(2, 2);
    cache.ingest("mac", "a", [call("1"), call("2"), call("3")], [], {
      live: false,
      connected: true,
      now: 0,
    });
    expect(cache.get("mac", "a")?.rows).toHaveLength(2);
    cache.ingest("mac", "a", [call("4", "completed", "v2")], [], {
      live: false,
      connected: true,
      now: 0,
    });
    expect(cache.get("mac", "a")?.rows.map((r) => r.id)).toEqual(["v2:4"]);
    for (const agentId of ["b", "c"])
      cache.ingest("mac", agentId, [], [], { live: false, connected: true, now: 0 });
    expect(cache.size).toBe(2);
    expect(cache.get("mac", "a")).toBeUndefined();
    cache.clear();
    expect(cache.size).toBe(0);
  });
  it("never leaves an evicted running item indefinitely running", () => {
    const cache = new DiagnosticCache();
    cache.ingest("mac", "a", [call("1", "running")], [], { live: true, connected: true, now: 0 });
    cache.ingest("mac", "a", [call("2")], [], { live: true, connected: true, now: 5 });
    expect(cache.get("mac", "a")?.rows.some((row) => row.status === "running")).toBe(false);
  });
});
