import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CollaborationBridge, getCollaborationBridge } from "./collaboration-bridge.js";
import { RemoteAgents } from "./remote-agents.js";
const operation = { op: "inspect" as const, agentId: randomUUID(), workspaceId: "workspace" };
describe("Mac collaboration route", () => {
  it("updates routes in place without interrupting other hosts and filters pushed changes", async () => {
    const bridge = new CollaborationBridge();
    const sent = new Map<string, string>();
    const release = bridge.register({
      id: "mac",
      hostIds: ["hgj", "home"],
      send: (m) => {
        sent.set(m.hostId, m.requestId);
      },
    });
    const changes = vi.fn();
    bridge.subscribe(changes);
    const hgj = bridge.execute("hgj", operation);
    const home = bridge.execute("home", operation);
    const failed = expect(home).rejects.toThrow("Destination host disconnected");
    bridge.update(["mac"], ["hgj", "devbox"]);
    await failed;
    bridge.changed(["stranger"], "hgj", operation.agentId);
    expect(changes).not.toHaveBeenCalled();
    bridge.changed(["mac"], "home", operation.agentId);
    expect(changes).not.toHaveBeenCalled();
    bridge.changed(["mac"], "hgj", operation.agentId);
    expect(changes).toHaveBeenCalledOnce();
    bridge.receive(["mac"], { requestId: sent.get("hgj")!, result: "kept" });
    await expect(hgj).resolves.toBe("kept");
    release();
  });
  it("accepts replies only from the registered transport owner and revokes pending requests", async () => {
    const bridge = new CollaborationBridge();
    let requestId = "";
    const release = bridge.register({
      id: "mac-source",
      hostIds: ["hgj"],
      send: (message) => {
        requestId = message.requestId;
      },
    });
    const result = bridge.execute("hgj", operation);
    let settled = false;
    void result.then(() => {
      settled = true;
      return undefined;
    });
    bridge.receive(["unrelated-source"], { requestId, result: "forged" });
    await Promise.resolve();
    expect(settled).toBe(false);
    bridge.receive(["mac-source"], { requestId, result: "verified" });
    await expect(result).resolves.toBe("verified");
    const pending = bridge.execute("hgj", operation);
    const rejection = expect(pending).rejects.toThrow("disconnected");
    release();
    await rejection;
    expect(bridge.has("hgj")).toBe(false);
    await expect(bridge.execute("hgj", operation)).rejects.toThrow("No connected Mac");
  });
  it("does not look for SSH config or resend a task when a Mac route is available", async () => {
    const home = await mkdtemp(join(tmpdir(), "paseo-mac-bridge-"));
    const bridge = getCollaborationBridge(home);
    const sent = vi.fn();
    const release = bridge.register({
      id: "mac-source",
      hostIds: ["hgj"],
      send: (message) => {
        sent(message.operation);
        bridge.receive(["mac-source"], {
          requestId: message.requestId,
          result:
            message.operation.op === "send"
              ? { agentId: operation.agentId, status: "sent" }
              : { Id: operation.agentId },
        });
      },
    });
    try {
      const remote = new RemoteAgents(home);
      await expect(remote.inspect("hgj", operation.agentId, "workspace")).resolves.toMatchObject({
        Id: operation.agentId,
      });
      const task = {
        callerId: "team",
        hostId: "hgj",
        agentId: operation.agentId,
        workspaceId: "workspace",
        requestId: randomUUID(),
        prompt: "Test task",
      };
      expect((await remote.send(task)).state).toBe("acknowledged");
      expect((await remote.send(task)).state).toBe("acknowledged");
      expect(sent.mock.calls.filter(([op]) => op.op === "send")).toHaveLength(1);
      await expect(remote.send({ ...task, prompt: "Different task" })).rejects.toThrow(
        "different task",
      );
    } finally {
      release();
      await rm(home, { recursive: true, force: true });
    }
  });
  it("rejects invalid operations before dispatch", async () => {
    const bridge = new CollaborationBridge();
    const send = vi.fn();
    bridge.register({ id: "mac", hostIds: ["hgj"], send });
    await expect(
      bridge.execute("hgj", { ...operation, agentId: "guessed-prefix" }),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});

it("checks the actual coordinator target hop and never returns remote stderr or credentials", async () => {
  const home = await mkdtemp(join(tmpdir(), "paseo-health-"));
  const bridge = getCollaborationBridge(home);
  const operations: string[] = [];
  const release = bridge.register({
    id: "health-mac",
    hostIds: ["ready", "offline"],
    send(message) {
      operations.push(message.operation.op);
      bridge.receive(["health-mac"], {
        requestId: message.requestId,
        ...(message.hostId === "ready"
          ? { result: { ok: true } }
          : { error: "Transport not connected token=secret-value https://private.invalid" }),
      });
    },
  });
  try {
    const report = await new RemoteAgents(home).health();
    expect(report.routes).toEqual([
      expect.objectContaining({
        hostId: "ready",
        status: "ok",
        transport: "mac",
        latencyMs: expect.any(Number),
      }),
      expect.objectContaining({ hostId: "offline", status: "error", error: "disconnected" }),
    ]);
    expect(operations).toEqual(["ping", "ping"]);
    expect(JSON.stringify(report)).not.toContain("secret-value");
    expect(JSON.stringify(report)).not.toContain("private.invalid");
  } finally {
    release();
    await rm(home, { recursive: true, force: true });
  }
});
