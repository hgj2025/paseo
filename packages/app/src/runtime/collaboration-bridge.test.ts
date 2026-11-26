import { describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { CollaborationExecutor, mountCollaborationBridge } from "./collaboration-bridge";
const agentId = "11111111-1111-4111-8111-111111111111",
  taskId = "22222222-2222-4222-8222-222222222222";
function harness() {
  const agent = {
    id: agentId,
    provider: "claude",
    model: "fable",
    cwd: "/repo",
    workspaceId: "remote-workspace",
    status: "idle",
    pendingPermissions: [],
    activeTurn: null,
    archivedAt: null,
    attentionReason: "finished",
  };
  const client = {
    fetchAgent: vi.fn(async () => ({ agent })),
    fetchAgentTimeline: vi.fn(async () => ({
      epoch: "epoch",
      window: { maxSeq: 12 },
      entries: [],
      hasOlder: false,
    })),
    sendAgentMessage: vi.fn(async () => {}),
    archiveAgent: vi.fn(async () => {}),
  };
  const clientFor = vi.fn((id: string) =>
    id === "hgj" ? (client as unknown as DaemonClient) : null,
  );
  return { client, agent, clientFor, executor: new CollaborationExecutor(clientFor) };
}
describe("paired collaboration executor", () => {
  it("cancels a queued operation when its route is revoked", async () => {
    const { executor, client } = harness();
    const controller = new AbortController();
    controller.abort(new Error("route revoked"));
    await expect(
      executor.execute(
        "hgj",
        { op: "archive", agentId, workspaceId: "remote-workspace" },
        controller.signal,
      ),
    ).rejects.toThrow("route revoked");
    expect(client.archiveAgent).not.toHaveBeenCalled();
    expect(client.fetchAgent).not.toHaveBeenCalled();
  });
  it("inspects through the chosen paired host and validates workspace", async () => {
    const { executor, client, clientFor } = harness();
    expect(
      await executor.execute("hgj", { op: "inspect", agentId, workspaceId: "remote-workspace" }),
    ).toMatchObject({ Id: agentId, Model: "fable", HistorySeq: 12 });
    expect(clientFor).toHaveBeenCalledWith("hgj");
    await expect(
      executor.execute("hgj", { op: "archive", agentId, workspaceId: "other" }),
    ).rejects.toThrow("workspace mismatch");
    expect(client.archiveAgent).not.toHaveBeenCalled();
    await expect(
      executor.execute("unpaired", { op: "inspect", agentId, workspaceId: "remote-workspace" }),
    ).rejects.toThrow("disconnected");
  });
  it("sends a task once, keeps ambiguous failures and rejects a changed payload", async () => {
    const { executor, client } = harness();
    const op = {
      op: "send" as const,
      agentId,
      workspaceId: "remote-workspace",
      taskId,
      prompt: "Do work",
    };
    await Promise.all([executor.execute("hgj", op), executor.execute("hgj", op)]);
    expect(client.sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(client.sendAgentMessage).toHaveBeenCalledWith(agentId, "Do work", {
      messageId: taskId,
      activeTurnBehavior: "steer",
    });
    await expect(executor.execute("hgj", { ...op, prompt: "Another" })).rejects.toThrow(
      "another request",
    );
  });
  it("never treats an idle agent without a correlated task as completed", async () => {
    const { executor } = harness();
    await expect(
      executor.execute("hgj", { op: "observe", agentId, workspaceId: "remote-workspace", taskId }),
    ).resolves.toMatchObject({ status: "uncertain" });
  });
  it("registers only connected paired hosts and releases routes on runtime disposal", async () => {
    const release = vi.fn(async () => {});
    const subscribe = vi.fn(() => () => {});
    const source = {
      getLastServerInfoMessage: () => ({ features: { collaborationBridge: true } }),
      updateCollaborationBridgeRoutes: vi.fn(),
      registerCollaborationBridge: vi.fn(() => ({
        ready: Promise.resolve({}),
        subscribe,
        release,
      })),
    } as unknown as DaemonClient;
    const runtime = {
      getHosts: () => [{ serverId: "home" }, { serverId: "hgj" }, { serverId: "offline" }],
      getSnapshot: (id: string) => ({ connectionStatus: id === "offline" ? "offline" : "online" }),
      getClient: () => null,
      subscribeAll: vi.fn(() => () => {}),
    };
    const dispose = mountCollaborationBridge(source, "home", runtime);
    expect(source.registerCollaborationBridge).toHaveBeenCalledWith(["hgj"]);
    dispose();
    expect(release).toHaveBeenCalledTimes(1);
  });
});

it("probes the paired daemon without requiring or reading an agent", async () => {
  const ping = vi.fn(async () => undefined);
  const fetchAgent = vi.fn();
  const executor = new CollaborationExecutor(
    () => ({ ping, fetchAgent }) as unknown as DaemonClient,
  );
  await expect(executor.execute("devbox", { op: "ping" })).resolves.toEqual({ ok: true });
  expect(ping).toHaveBeenCalledWith({ timeoutMs: 3000 });
  expect(fetchAgent).not.toHaveBeenCalled();
});
