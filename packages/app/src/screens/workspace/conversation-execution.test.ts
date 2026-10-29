import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  prepareConversationExecutor,
  readExecutionHistory,
  cachedExecutionHistory,
  invalidateExecutionHistory,
  peekExecutionHistory,
  type ExecutionClient,
  type ConversationEntry,
} from "./conversation-execution";
import type { TeamMember } from "@getpaseo/protocol/workspace-team";
const member = (): TeamMember => ({
  id: randomUUID(),
  alias: "Research",
  serverId: "old",
  workspaceId: "work",
  agentId: randomUUID(),
  provider: "claude",
  role: "",
  skills: [],
});
function makeClient(provider = "claude") {
  return {
    fetchAgent: vi.fn(async () => ({
      agent: {
        id: randomUUID(),
        provider,
        status: "idle",
        pendingPermissions: [],
        title: "Research",
      },
    })),
    fetchAgentTimeline: vi.fn(async () => ({
      entries: [],
      hasOlder: false,
      epoch: "epoch",
      startCursor: null,
      staleCursor: false,
      error: null,
    })),
    createAgent: vi.fn(async () => ({ id: randomUUID() })),
    setAgentModel: vi.fn(async () => {}),
    archiveAgent: vi.fn(async () => {}),
  } as unknown as ExecutionClient;
}
const entry = (text: string, seq: number): ConversationEntry => ({
  provider: "claude",
  item: { type: "user_message", text, messageId: randomUUID() },
  timestamp: new Date().toISOString(),
  seqStart: seq,
  seqEnd: seq,
  sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
  collapsed: [],
});
describe("conversation execution preparation", () => {
  it("updates a model in place without creating or archiving any execution", async () => {
    const m = member(),
      client = makeClient(),
      commit = vi.fn();
    await prepareConversationExecutor({
      member: m,
      scope: { serverId: "old", workspaceId: "work", directory: "/code" },
      provider: "claude",
      model: "new-model",
      operationId: randomUUID(),
      clientFor: () => client,
      commit,
    });
    expect(client.setAgentModel).toHaveBeenCalledWith(m.agentId, "new-model");
    expect(client.createAgent).not.toHaveBeenCalled();
    expect(client.archiveAgent).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
  it("carries the entire paged transcript into the new executor before committing the same member", async () => {
    const m = member(),
      source = makeClient(),
      target = makeClient("codex"),
      commit = vi.fn(async () => {});
    const first = entry("CONTINUITY_SECRET_725", 1),
      last = entry("Continue the existing task", 2);
    vi.mocked(source.fetchAgentTimeline)
      .mockResolvedValueOnce({
        entries: [last],
        hasOlder: true,
        epoch: "epoch",
        startCursor: { epoch: "epoch", seq: 2 },
        staleCursor: false,
        error: null,
      } as never)
      .mockResolvedValueOnce({
        entries: [first],
        hasOlder: false,
        epoch: "epoch",
        startCursor: { epoch: "epoch", seq: 1 },
        staleCursor: false,
        error: null,
      } as never);
    await prepareConversationExecutor({
      member: m,
      scope: { serverId: "new", workspaceId: "destination", directory: "/code" },
      provider: "codex",
      model: "model",
      operationId: randomUUID(),
      clientFor: (id) => (id === "old" ? source : target),
      commit,
    });
    const options = vi.mocked(target.createAgent).mock.calls[0]![0];
    expect(options.initialPrompt).toBeUndefined();
    expect(options.config?.systemPrompt).toContain("CONTINUITY_SECRET_725");
    expect(options.config?.systemPrompt).toContain("Continue the existing task");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(source.archiveAgent).not.toHaveBeenCalled();
    expect(m.agentId).toBeDefined();
  });
  it("does not create an executor or change the binding when history cannot be read", async () => {
    const source = makeClient(),
      target = makeClient(),
      commit = vi.fn();
    vi.mocked(source.fetchAgentTimeline).mockRejectedValue(new Error("offline"));
    await expect(
      prepareConversationExecutor({
        member: member(),
        scope: { serverId: "new", workspaceId: "work", directory: "/code" },
        provider: "codex",
        model: "model",
        operationId: randomUUID(),
        clientFor: (id) => (id === "old" ? source : target),
        commit,
      }),
    ).rejects.toThrow("offline");
    expect(target.createAgent).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(source.archiveAgent).not.toHaveBeenCalled();
  });
  it("rejects an epoch change instead of passing an incomplete transcript", async () => {
    const source = makeClient();
    vi.mocked(source.fetchAgentTimeline)
      .mockResolvedValueOnce({
        entries: [entry("tail", 2)],
        hasOlder: true,
        epoch: "first",
        startCursor: { epoch: "first", seq: 2 },
        staleCursor: false,
        error: null,
      } as never)
      .mockResolvedValueOnce({
        entries: [],
        hasOlder: false,
        epoch: "different",
        staleCursor: true,
        error: null,
      } as never);
    await expect(readExecutionHistory(source, { ...member() })).rejects.toThrow("history changed");
  });
  it("keeps the original conversation if the execution commit fails", async () => {
    const m = member(),
      source = makeClient(),
      target = makeClient(),
      commit = vi.fn(async () => {
        throw new Error("revision changed");
      });
    await expect(
      prepareConversationExecutor({
        member: m,
        scope: { serverId: "new", workspaceId: "work", directory: "/code" },
        provider: "codex",
        model: "model",
        operationId: randomUUID(),
        clientFor: (id) => (id === "old" ? source : target),
        commit,
      }),
    ).rejects.toThrow("revision changed");
    expect(source.archiveAgent).not.toHaveBeenCalled();
    expect(target.archiveAgent).not.toHaveBeenCalled();
  });
  it("allows changing models after a finished quota error", async () => {
    const m = member(),
      source = makeClient(),
      commit = vi.fn();
    vi.mocked(source.fetchAgent).mockResolvedValue({
      agent: {
        id: m.agentId,
        provider: "claude",
        status: "error",
        activeTurn: null,
        pendingPermissions: [],
      },
    } as never);
    await prepareConversationExecutor({
      member: m,
      scope: { serverId: "old", workspaceId: "work", directory: "/code" },
      provider: "claude",
      model: "replacement",
      operationId: randomUUID(),
      clientFor: () => source,
      commit,
    });
    expect(source.setAgentModel).toHaveBeenCalledWith(m.agentId, "replacement");
    expect(source.createAgent).not.toHaveBeenCalled();
  });
  it("allows transferring an errored transcript but blocks a still-active turn", async () => {
    const m = member(),
      source = makeClient(),
      target = makeClient(),
      commit = vi.fn();
    const state = {
      id: m.agentId,
      provider: "claude",
      status: "error",
      activeTurn: null,
      pendingPermissions: [],
    };
    vi.mocked(source.fetchAgent).mockResolvedValue({ agent: state } as never);
    const input = {
      member: m,
      scope: { serverId: "new", workspaceId: "work", directory: "/code" },
      provider: "codex",
      model: "replacement",
      operationId: randomUUID(),
      clientFor: (id: string) => (id === "old" ? source : target),
      commit,
    };
    await prepareConversationExecutor(input);
    expect(commit).toHaveBeenCalledTimes(1);
    vi.mocked(source.fetchAgent).mockResolvedValue({
      agent: { ...state, activeTurn: { id: "running" } },
    } as never);
    await expect(
      prepareConversationExecutor({ ...input, operationId: randomUUID() }),
    ).rejects.toThrow("current turn");
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

describe("conversation history retry boundaries", () => {
  it("retains a failed read across remounts until an explicit retry on the same host", async () => {
    const execution = member();
    const client = makeClient();
    const read = vi.mocked(client.fetchAgentTimeline);
    read.mockRejectedValueOnce(new Error("thread not loaded"));
    for (let mount = 0; mount < 4; mount++) {
      await expect(cachedExecutionHistory(execution, client)).rejects.toThrow("thread not loaded");
    }
    expect(read).toHaveBeenCalledTimes(1);
    expect(peekExecutionHistory(execution)).toBeUndefined();
    invalidateExecutionHistory(execution);
    await expect(cachedExecutionHistory(execution, client)).resolves.toEqual([]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls.every(([id]) => id === execution.agentId)).toBe(true);
    expect(peekExecutionHistory(execution)).toEqual([]);
  });

  it("isolates a failed history from the active execution on another host", async () => {
    const old = member();
    const current = { ...old, serverId: "devbox", agentId: randomUUID(), workspaceId: "linux" };
    const oldClient = makeClient("codex");
    const currentClient = makeClient("claude");
    vi.mocked(oldClient.fetchAgentTimeline).mockRejectedValue(new Error("thread not loaded"));
    await expect(cachedExecutionHistory(old, oldClient)).rejects.toThrow("thread not loaded");
    await expect(cachedExecutionHistory(current, currentClient)).resolves.toEqual([]);
    invalidateExecutionHistory(old);
    expect(peekExecutionHistory(current)).toEqual([]);
    expect(currentClient.fetchAgentTimeline).toHaveBeenCalledExactlyOnceWith(
      current.agentId,
      expect.any(Object),
    );
    expect(oldClient.createAgent).not.toHaveBeenCalled();
    expect(currentClient.createAgent).not.toHaveBeenCalled();
  });
});
