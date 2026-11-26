import { describe, expect, it, vi } from "vitest";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { archiveCandidates, loadHostHistory } from "./service";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { DAY_MS, DEFAULT_ARCHIVE_RULE } from "./model";
const page = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-agent-history", () => ({ fetchAgentHistoryPage: page }));
function snapshot(patch: Partial<AgentSnapshotPayload> = {}): AgentSnapshotPayload {
  return {
    id: "a",
    provider: "claude",
    status: "closed",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastUserMessageAt: null,
    cwd: "/tmp",
    model: null,
    title: "test",
    currentModeId: null,
    availableModes: [],
    persistence: null,
    pendingPermissions: [],
    requiresAttention: false,
    labels: {},
    activeTurn: null,
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    ...patch,
  };
}
function candidate(): AggregatedAgent {
  return {
    id: "a",
    serverId: "home",
    serverLabel: "home",
    provider: "claude",
    status: "closed",
    createdAt: new Date(1000),
    lastActivityAt: new Date(1000),
    cwd: "/tmp",
    title: "test",
    labels: {},
    turn: { phase: "idle", cancellationRequestId: null },
  };
}
function fakeClient(current: AgentSnapshotPayload) {
  return {
    fetchAgent: vi.fn(async () => ({ agent: current, project: null })),
    archiveAgent: vi.fn(async () => ({ archivedAt: new Date().toISOString() })),
  };
}
describe("archive execution", () => {
  it("reads all pages and rejects incomplete pagination", async () => {
    page
      .mockReset()
      .mockResolvedValueOnce({
        agents: [candidate()],
        pageInfo: { hasMore: true, nextCursor: "next" },
      })
      .mockResolvedValueOnce({
        agents: [candidate(), { ...candidate(), id: "b" }],
        pageInfo: { hasMore: false },
      });
    const client = {} as Pick<DaemonClient, "fetchAgentHistory">;
    expect((await loadHostHistory(client, "home")).map((a) => a.id)).toEqual(["a", "b"]);
    page
      .mockReset()
      .mockResolvedValue({ agents: [], pageInfo: { hasMore: true, nextCursor: "same" } });
    await expect(loadHostHistory(client, "home")).rejects.toThrow("pagination");
  });
  it("rechecks status and protects open sessions", async () => {
    const client = fakeClient(
      snapshot({
        status: "running",
        activeTurn: { turnId: "t", startedAt: new Date().toISOString() },
      }),
    );
    const input = {
      client,
      serverId: "home",
      candidates: [candidate()],
      parents: new Set<string>(),
      protectedIds: () => new Set<string>(),
    };
    expect(await archiveCandidates(input)).toEqual({ archived: 0, skipped: 1, failed: 0 });
    client.fetchAgent.mockResolvedValue({ agent: snapshot(), project: null });
    expect(await archiveCandidates({ ...input, protectedIds: () => new Set(["a"]) })).toEqual({
      archived: 0,
      skipped: 1,
      failed: 0,
    });
    expect(client.archiveAgent).not.toHaveBeenCalled();
  });
  it("rechecks activity and continues after request failure", async () => {
    const client = fakeClient(snapshot({ updatedAt: new Date().toISOString() }));
    const input = {
      client,
      serverId: "home",
      candidates: [candidate()],
      parents: new Set<string>(),
      protectedIds: () => new Set<string>(),
      rule: { ...DEFAULT_ARCHIVE_RULE, olderThanDays: 7 },
    };
    expect((await archiveCandidates(input)).skipped).toBe(1);
    client.fetchAgent.mockResolvedValue({
      agent: snapshot({ updatedAt: new Date(Date.now() - 8 * DAY_MS).toISOString() }),
      project: null,
    });
    client.archiveAgent.mockRejectedValueOnce(new Error("disconnected"));
    expect(await archiveCandidates({ ...input, candidates: [candidate(), candidate()] })).toEqual({
      archived: 1,
      skipped: 0,
      failed: 1,
    });
  });
  it("cancels without reading or archiving", async () => {
    const client = fakeClient(snapshot());
    expect(
      await archiveCandidates({
        client,
        serverId: "home",
        candidates: [candidate()],
        parents: new Set(),
        protectedIds: () => new Set(),
        shouldContinue: () => false,
      }),
    ).toEqual({ archived: 0, skipped: 0, failed: 0 });
    expect(client.fetchAgent).not.toHaveBeenCalled();
  });
});
