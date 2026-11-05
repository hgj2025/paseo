import { buildHomeSessions, homeSessionState, todaySessions } from "@/home-overview/model";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { describe, expect, it } from "vitest";
import {
  aggregateSidebarStateBuckets,
  deriveSidebarStateBucket,
  type SidebarStateBucket,
} from "./sidebar-agent-state";

describe("deriveSidebarStateBucket", () => {
  it("prioritizes pending permissions as needs_input", () => {
    expect(
      deriveSidebarStateBucket({
        status: "idle",
        pendingPermissionCount: 1,
        requiresAttention: false,
        attentionReason: null,
      }),
    ).toBe("needs_input");
  });

  it("keeps legacy permission attention in needs_input", () => {
    expect(
      deriveSidebarStateBucket({
        status: "idle",
        pendingPermissionCount: 0,
        requiresAttention: true,
        attentionReason: "permission",
      }),
    ).toBe("needs_input");
  });

  it("treats unread finished agents as attention", () => {
    expect(
      deriveSidebarStateBucket({
        status: "idle",
        pendingPermissionCount: 0,
        requiresAttention: true,
        attentionReason: "finished",
      }),
    ).toBe("attention");
  });

  it("does not count initializing agents as running", () => {
    expect(
      deriveSidebarStateBucket({
        status: "initializing",
        pendingPermissionCount: 0,
        requiresAttention: false,
        attentionReason: null,
      }),
    ).toBe("done");
  });
});

describe("aggregateSidebarStateBuckets", () => {
  it("returns done for a project with no workspaces", () => {
    expect(aggregateSidebarStateBuckets([])).toBe("done");
  });

  it("returns done when every workspace is done", () => {
    expect(aggregateSidebarStateBuckets(["done", "done", "done"])).toBe("done");
  });

  it("surfaces a single running workspace among finished ones", () => {
    expect(aggregateSidebarStateBuckets(["done", "running", "done"])).toBe("running");
  });

  it("prefers needs_input over every other bucket", () => {
    expect(aggregateSidebarStateBuckets(["running", "attention", "failed", "needs_input"])).toBe(
      "needs_input",
    );
  });

  it("prefers failed over attention and running", () => {
    expect(aggregateSidebarStateBuckets(["running", "attention", "failed"])).toBe("failed");
  });

  it("prefers running over ready-to-review so a working project keeps its loader", () => {
    expect(aggregateSidebarStateBuckets(["attention", "running"])).toBe("running");
  });

  it("prefers ready-to-review over done", () => {
    expect(aggregateSidebarStateBuckets(["done", "attention", "done"])).toBe("attention");
  });

  it("follows the full needs_input > failed > running > attention > done ordering", () => {
    // Each pair of adjacent buckets: the more urgent one wins when both are present.
    expect(aggregateSidebarStateBuckets(["failed", "needs_input"])).toBe("needs_input");
    expect(aggregateSidebarStateBuckets(["running", "failed"])).toBe("failed");
    expect(aggregateSidebarStateBuckets(["attention", "running"])).toBe("running");
    expect(aggregateSidebarStateBuckets(["done", "attention"])).toBe("attention");
  });

  it("is order-independent", () => {
    const buckets: SidebarStateBucket[] = ["attention", "running", "failed"];
    expect(aggregateSidebarStateBuckets(buckets)).toBe(
      aggregateSidebarStateBuckets(buckets.toReversed()),
    );
  });
});

// The global Home overview must not infer completion from idle or disconnected caches.
function overviewAgent(input: Partial<AggregatedAgent> = {}): AggregatedAgent {
  return {
    id: "same",
    serverId: "mac",
    serverLabel: "Mac",
    title: "Captain",
    provider: "codex",
    status: "idle",
    turn: { phase: "idle", cancellationRequestId: null },
    cwd: "/repo",
    createdAt: new Date(0),
    lastActivityAt: new Date(1000),
    requiresAttention: false,
    attentionReason: null,
    labels: {},
    ...input,
  };
}
describe("cross-host Home overview", () => {
  it("requires an explicit finished marker and preserves pending/running precedence", () => {
    expect(homeSessionState(overviewAgent(), true)).toBe("idle");
    expect(homeSessionState(overviewAgent({ status: "closed" }), true)).toBe("idle");
    expect(
      homeSessionState(
        overviewAgent({ attentionReason: "finished", requiresAttention: true }),
        true,
      ),
    ).toBe("finished");
    expect(
      homeSessionState(overviewAgent({ status: "running", attentionReason: "finished" }), true),
    ).toBe("running");
    expect(
      homeSessionState(overviewAgent({ status: "running", pendingPermissionCount: 1 }), true),
    ).toBe("waiting");
    expect(homeSessionState(overviewAgent({ requiresAttention: true }), true)).toBe("attention");
  });
  it("marks cached finished/running states unknown when the host is offline or syncing", () => {
    const agent = overviewAgent({ attentionReason: "finished", requiresAttention: true });
    expect(homeSessionState(agent, false)).toBe("unknown");
    const rows = buildHomeSessions(
      [agent],
      [{ serverId: "mac", label: "Mac", connected: false, fresh: false }],
    );
    expect(rows[0]).toMatchObject({ state: "unknown", active: true });
  });
  it("keeps the same agent ID on distinct hosts separate and excludes archived/removed hosts", () => {
    const hosts = [
      { serverId: "mac", label: "Mac", connected: true, fresh: true },
      { serverId: "vm", label: "devbox", connected: true, fresh: true },
    ];
    const agents = [
      overviewAgent(),
      overviewAgent({ serverId: "vm", serverLabel: "devbox", status: "running" }),
      overviewAgent({ id: "archived", archivedAt: new Date() }),
      overviewAgent({ serverId: "removed" }),
    ];
    expect(
      buildHomeSessions(agents, hosts).map((row) => [row.agent.serverId, row.agent.id]),
    ).toEqual([
      ["vm", "same"],
      ["mac", "same"],
    ]);
    expect(buildHomeSessions([agents[0]!, agents[0]!], hosts)).toHaveLength(1);
  });
  it("keeps unread finished work in the default active view but not acknowledged idle work", () => {
    const hosts = [{ serverId: "mac", label: "Mac", connected: true, fresh: true }];
    const rows = buildHomeSessions(
      [
        overviewAgent({ id: "done", requiresAttention: true, attentionReason: "finished" }),
        overviewAgent({ id: "idle" }),
        overviewAgent({ id: "read", attentionReason: "finished" }),
        overviewAgent({ id: "starting", status: "initializing" }),
      ],
      hosts,
    );
    expect(rows.filter((row) => row.active).map((row) => row.agent.id)).toEqual([
      "done",
      "starting",
    ]);
  });
});

describe("today sidebar sessions", () => {
  it("retains today's idle/read/completed sessions, excludes yesterday and advances at midnight", () => {
    const now = new Date(2026, 10, 3, 12);
    const hosts = [{ serverId: "mac", label: "Mac", fresh: true, connected: true }];
    const rows = buildHomeSessions(
      [
        overviewAgent({
          id: "today",
          lastActivityAt: new Date(2026, 10, 3, 0),
          attentionReason: "finished",
        }),
        overviewAgent({
          id: "yesterday",
          lastActivityAt: new Date(2026, 10, 2, 23, 59),
          status: "running",
        }),
        overviewAgent({ id: "idle", lastActivityAt: new Date(2026, 10, 3, 11) }),
      ],
      hosts,
    );
    expect(todaySessions(rows, now).map((r) => r.agent.id)).toEqual(["idle", "today"]);
    expect(todaySessions(rows, new Date(2026, 10, 4))).toEqual([]);
  });
  it("preserves row positions across status and activity changes, appending new sessions", () => {
    const now = new Date(2026, 10, 3, 12);
    const hosts = [{ serverId: "mac", label: "Mac", fresh: true, connected: true }];
    const rows = buildHomeSessions(
      [
        overviewAgent({ id: "a", status: "running", lastActivityAt: now }),
        overviewAgent({ id: "b", attentionReason: "finished", lastActivityAt: now }),
        overviewAgent({ id: "new", lastActivityAt: now }),
      ],
      hosts,
    );
    const keys = ["a", "b"].map((id) => JSON.stringify(["mac", id]));
    expect(todaySessions(rows, now, keys).map((r) => r.agent.id)).toEqual(["a", "b", "new"]);
  });
});

it("excludes internal cross-host executors, including uncommitted retries", () => {
  const hosts = [{ serverId: "mac", label: "Mac", fresh: true, connected: true }];
  const rows = buildHomeSessions(
    [
      overviewAgent({ id: "anchor" }),
      overviewAgent({
        id: "pending",
        labels: { "paseo.conversation.executor": "member" },
        status: "idle",
      }),
      overviewAgent({
        id: "runner",
        labels: { "paseo.conversation.executor": "member" },
        status: "running",
      }),
    ],
    hosts,
  );
  expect(rows.map((row) => row.agent.id)).toEqual(["anchor"]);
});
