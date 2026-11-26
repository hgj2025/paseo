import { describe, expect, it } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import {
  agentKey,
  canArchive,
  nextArchiveAt,
  DEFAULT_ARCHIVE_RULE,
  DAY_MS,
  filterHistory,
  isWithinDirectory,
  matchesArchiveRule,
  parentAgentIds,
} from "./model";
import { openArchiveRuleForm } from "./rule-form";
export function agent(patch: Partial<AggregatedAgent> = {}): AggregatedAgent {
  return {
    id: "a",
    serverId: "home",
    serverLabel: "home",
    title: "test",
    status: "closed",
    turn: { phase: "idle", cancellationRequestId: null },
    cwd: "/tmp/test",
    provider: "claude",
    lastActivityAt: new Date(1000),
    createdAt: new Date(1000),
    labels: {},
    requiresAttention: false,
    pendingPermissionCount: 0,
    ...patch,
  };
}
describe("archive policy", () => {
  it("runs once a day and backs off failures without replaying missed days", () => {
    expect(nextArchiveAt()).toBe(0);
    expect(nextArchiveAt({ at: 100, error: null, failed: 0 })).toBe(100 + DAY_MS);
    expect(nextArchiveAt({ at: 100, error: "offline", failed: 0 })).toBe(3_600_100);
    expect(nextArchiveAt({ at: 100, error: null, failed: 1 })).toBe(3_600_100);
  });
  it("is opt-in and matches age, provider and directory boundaries", () => {
    expect(DEFAULT_ARCHIVE_RULE.enabled).toBe(false);
    const rule = {
      ...DEFAULT_ARCHIVE_RULE,
      olderThanDays: 7,
      directory: "/tmp",
      provider: "claude",
    };
    expect(matchesArchiveRule(agent(), rule, 1000 + 7 * DAY_MS)).toBe(true);
    expect(matchesArchiveRule(agent(), rule, 999 + 7 * DAY_MS)).toBe(false);
    expect(matchesArchiveRule(agent({ cwd: "/tmp-other" }), rule, 8 * DAY_MS)).toBe(false);
    expect(matchesArchiveRule(agent({ provider: "codex" }), rule, 8 * DAY_MS)).toBe(false);
    expect(matchesArchiveRule(agent({ lastActivityAt: new Date(NaN) }), rule, 8 * DAY_MS)).toBe(
      false,
    );
    expect(isWithinDirectory("/tmp/child", "/tmp/")).toBe(true);
  });
  it("rejects running, pending, attention, archived and related sessions", () => {
    expect(canArchive(agent(), new Set())).toBe(true);
    const finished = agent({ requiresAttention: true, attentionReason: "finished" });
    expect(canArchive(finished, new Set())).toBe(false);
    expect(canArchive(finished, new Set(), true)).toBe(true);
    expect(
      canArchive(
        agent({ requiresAttention: true, attentionReason: "permission" }),
        new Set(),
        true,
      ),
    ).toBe(false);
    for (const patch of [
      { status: "running" as const },
      { status: "initializing" as const },
      { status: "error" as const },
      { pendingPermissionCount: 1 },
      { requiresAttention: true },
      { archivedAt: new Date() },
      { labels: { "paseo.parent-agent-id": "parent" } },
      {
        turn: {
          phase: "open" as const,
          turnId: "t",
          startedAt: new Date(),
          cancellationRequestId: null,
        },
      },
    ])
      expect(canArchive(agent(patch), new Set())).toBe(false);
    const parents = parentAgentIds([
      agent({ id: "child", labels: { "paseo.parent-agent-id": "a" } }),
    ]);
    expect(canArchive(agent(), parents)).toBe(false);
  });
  it("keeps host identity and archived filters distinct", () => {
    expect(agentKey(agent())).not.toBe(agentKey(agent({ serverId: "devbox" })));
    const history = [agent(), agent({ id: "old", archivedAt: new Date() })];
    expect(
      filterHistory(history, { archive: "archived", directory: "", provider: "" }).map((a) => a.id),
    ).toEqual(["old"]);
  });
  it("validates rules and opens a fresh independent draft", () => {
    const a = openArchiveRuleForm();
    const b = openArchiveRuleForm();
    a.set({ days: "0" });
    expect(a.value()).toBeNull();
    a.set({ days: "7", directory: "relative" });
    expect(a.value()).toBeNull();
    a.set({ directory: "/tmp", provider: " claude " });
    expect(a.value()).toEqual({
      enabled: false,
      olderThanDays: 7,
      provider: "claude",
      directory: "/tmp",
    });
    expect(b.value()).toEqual(DEFAULT_ARCHIVE_RULE);
  });
});
