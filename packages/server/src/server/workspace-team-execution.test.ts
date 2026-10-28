import { AgentManager } from "./agent/agent-manager.js";
import { AgentStorage } from "./agent/agent-storage.js";
import { getWorkspaceTeamService } from "./workspace-team-runtime.js";
import { getOrCreateServerId } from "./server-id.js";
import { createTestLogger } from "../test-utils/test-logger.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceTeamService, type TeamTransport } from "./workspace-team-service.js";
import { executionMember } from "@getpaseo/protocol/workspace-team";

describe("stable conversation execution binding", () => {
  let home: string, service: WorkspaceTeamService, transport: TeamTransport;
  const workspace = "work",
    session = randomUUID();
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "paseo-execution-"));
    transport = {
      inspect: vi.fn(async () => ({ provider: "codex", busy: false })),
      send: vi.fn(async () => "acknowledged" as const),
      observe: vi.fn(async () => ({ status: "running" as const, result: "" })),
      notify: vi.fn(async () => {}),
      archive: vi.fn(async () => {}),
    };
    service = new WorkspaceTeamService(home, "mac", transport);
  });
  afterEach(async () => {
    service.dispose();
    await rm(home, { recursive: true, force: true });
  });
  const read = () => service.executeSession(workspace, session, { kind: "read" });
  async function setup() {
    await service.executeSession(workspace, session, {
      kind: "join",
      serverId: "mac",
      workspaceId: workspace,
      agentId: randomUUID(),
      paneId: "main",
      owned: true,
    });
    const team = await service.executeSession(workspace, session, {
      kind: "join",
      serverId: "mac",
      workspaceId: workspace,
      agentId: randomUUID(),
      paneId: "child",
      owned: true,
    });
    return { team, member: team.members[1]! };
  }
  const runner = () => ({
    serverId: "devbox",
    workspaceId: "linux-work",
    agentId: randomUUID(),
    provider: "codex",
    model: "model-a",
    operationId: randomUUID(),
  });
  it("keeps session, member, pane, alias and anchor across host changes and daemon reload", async () => {
    const { team, member } = await setup();
    const execution = runner();
    const changed = await service.executeSession(workspace, session, {
      kind: "configure_execution",
      memberId: member.id,
      revision: team.revision,
      execution,
    });
    expect(changed.sessionId).toBe(session);
    expect(changed.captainId).toBe(team.captainId);
    expect(changed.members[1]).toMatchObject({ ...member, execution });
    expect(changed.members[1]!.executionHistory).toEqual([
      {
        serverId: member.serverId,
        workspaceId: member.workspaceId,
        agentId: member.agentId,
        provider: member.provider,
      },
    ]);
    expect(changed.retiredMembers).toBeUndefined();
    expect(transport.archive).not.toHaveBeenCalled();
    service.dispose();
    service = new WorkspaceTeamService(home, "mac", transport);
    expect((await read()).members[1]).toEqual(changed.members[1]);
    expect(executionMember(changed.members[1]!)).toMatchObject(execution);
  });
  it("routes subsequent team tasks to the selected runner under the same member ID", async () => {
    const { team, member } = await setup();
    const execution = runner();
    await service.executeSession(workspace, session, {
      kind: "configure_execution",
      memberId: member.id,
      revision: team.revision,
      execution,
    });
    await service.executeSession(workspace, session, {
      kind: "send",
      memberId: member.id,
      senderId: member.id,
      taskId: randomUUID(),
      prompt: "Read only",
    });
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({ ...execution, id: member.id }),
      expect.objectContaining({ memberId: member.id }),
    );
  });
  it("rejects a busy source without changing the binding or archiving anything", async () => {
    const { team, member } = await setup();
    vi.mocked(transport.inspect).mockImplementation(async (target) => ({
      provider: "codex",
      busy: target.agentId === member.agentId,
    }));
    await expect(
      service.executeSession(workspace, session, {
        kind: "configure_execution",
        memberId: member.id,
        revision: team.revision,
        execution: runner(),
      }),
    ).rejects.toThrow("current turn");
    expect((await read()).members[1]).toEqual(member);
    expect(transport.archive).not.toHaveBeenCalled();
  });
  it("deduplicates a committed switch and rejects reuse of its operation ID", async () => {
    const { team, member } = await setup();
    const execution = runner();
    const action = {
      kind: "configure_execution" as const,
      memberId: member.id,
      revision: team.revision,
      execution,
    };
    const changed = await service.executeSession(workspace, session, action);
    expect(await service.executeSession(workspace, session, action)).toEqual(changed);
    await expect(
      service.executeSession(workspace, session, {
        ...action,
        execution: { ...execution, model: "different" },
      }),
    ).rejects.toThrow("another configuration");
  });
  it("keeps the previous binding when the team revision changes", async () => {
    const { team, member } = await setup();
    await service.executeSession(workspace, session, {
      kind: "edit",
      memberId: member.id,
      revision: team.revision,
      alias: "Research",
      role: "Keep this",
      skills: [],
      captain: false,
    });
    await expect(
      service.executeSession(workspace, session, {
        kind: "configure_execution",
        memberId: member.id,
        revision: team.revision,
        execution: runner(),
      }),
    ).rejects.toThrow("Team changed");
    expect((await read()).members[1]!.execution).toBeUndefined();
  });
  it("rejects a stale transcript checkpoint and leaves the source in place", async () => {
    const { team, member } = await setup();
    vi.mocked(transport.inspect).mockResolvedValue({
      provider: "codex",
      busy: false,
      historyEpoch: "e",
      historySeq: 11,
    });
    await expect(
      service.executeSession(workspace, session, {
        kind: "configure_execution",
        memberId: member.id,
        revision: team.revision,
        execution: runner(),
        sourceCursor: { epoch: "e", seq: 10 },
      }),
    ).rejects.toThrow("history changed");
    expect((await read()).members[1]!.execution).toBeUndefined();
  });
  it("keeps Captain on the team host until reverse team tools are supported", async () => {
    const { team } = await setup();
    await expect(
      service.executeSession(workspace, session, {
        kind: "configure_execution",
        memberId: team.captainId!,
        revision: team.revision,
        execution: runner(),
      }),
    ).rejects.toThrow("team host");
    expect((await read()).members[0]!.execution).toBeUndefined();
  });
  it("prevents joining an execution into a second conversation or pane", async () => {
    const { team, member } = await setup();
    const execution = runner();
    await service.executeSession(workspace, session, {
      kind: "configure_execution",
      memberId: member.id,
      revision: team.revision,
      execution,
    });
    await expect(
      service.executeSession(workspace, session, {
        kind: "join",
        ...execution,
        paneId: "another",
      }),
    ).rejects.toThrow("another pane");
    const second = randomUUID();
    await service.executeSession(workspace, second, {
      kind: "join",
      serverId: "mac",
      workspaceId: workspace,
      agentId: randomUUID(),
      paneId: "main",
    });
    await expect(
      service.executeSession(workspace, second, {
        kind: "join",
        ...execution,
        paneId: "another",
      }),
    ).rejects.toThrow("another conversation");
  });
  it("archives all executors only when the member is explicitly removed", async () => {
    const { team, member } = await setup();
    const execution = runner();
    const changed = await service.executeSession(workspace, session, {
      kind: "configure_execution",
      memberId: member.id,
      revision: team.revision,
      execution,
    });
    expect(transport.archive).not.toHaveBeenCalled();
    await service.executeSession(workspace, session, {
      kind: "remove",
      memberId: member.id,
      revision: changed.revision,
    });
    expect(transport.archive).toHaveBeenCalledTimes(2);
    expect(transport.archive).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: member.agentId }),
    );
    expect(transport.archive).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: execution.agentId }),
    );
  });
});

describe("conversation archival of stored-only agents", () => {
  let home: string;
  let manager: AgentManager;
  let storage: AgentStorage;
  let service: WorkspaceTeamService;
  let hostId: string;
  const workspaceId = "stored-workspace";
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "paseo-team-stored-archive-"));
    const logger = createTestLogger();
    storage = new AgentStorage(join(home, "agents"), logger);
    manager = new AgentManager({ clients: {}, registry: storage, logger });
    hostId = getOrCreateServerId(home);
    service = getWorkspaceTeamService({
      paseoHome: home,
      agentManager: manager,
      agentStorage: storage,
      logger,
    });
  });
  afterEach(async () => {
    service.dispose();
    await rm(home, { recursive: true, force: true });
  });
  async function joinStored(sessionId: string, paneId: string) {
    const agentId = randomUUID();
    await storage.upsert({
      id: agentId,
      provider: "codex",
      cwd: home,
      workspaceId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      labels: {},
      lastStatus: "closed",
      config: null,
      persistence: null,
      archivedAt: null,
    });
    await service.executeSession(workspaceId, sessionId, {
      kind: "join",
      serverId: hostId,
      workspaceId,
      agentId,
      paneId,
      owned: true,
    });
    return agentId;
  }
  it("ends a conversation without resuming stored-only Captain and members", async () => {
    const sessionId = randomUUID();
    const captain = await joinStored(sessionId, "main");
    const member = await joinStored(sessionId, "child");
    expect(manager.getAgent(captain)).toBeNull();
    const result = await service.executeSession(workspaceId, sessionId, { kind: "end" });
    expect(result.status).toBe("ended");
    expect(result.archiveErrors).toEqual({});
    for (const id of [captain, member]) {
      expect((await storage.get(id))?.archivedAt).toBeTruthy();
      expect(manager.getAgent(id)).toBeNull();
    }
    expect(await service.executeSession(workspaceId, sessionId, { kind: "end" })).toEqual(result);
  });
  it("refuses to archive a stored agent that moved to a different workspace", async () => {
    const sessionId = randomUUID();
    const captain = await joinStored(sessionId, "main");
    const record = (await storage.get(captain))!;
    await storage.upsert({ ...record, workspaceId: "different-workspace" });
    const result = await service.executeSession(workspaceId, sessionId, { kind: "end" });
    expect(result.status).toBe("ending");
    expect(Object.values(result.archiveErrors ?? {}).join()).toContain("workspace changed");
    expect((await storage.get(captain))?.archivedAt).toBeNull();
  });
});
