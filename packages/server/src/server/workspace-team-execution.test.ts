import { memberPathInstructions, resultPathInstructions } from "./workspace-team-path-context.js";
import { AgentManager } from "./agent/agent-manager.js";
import { AgentStorage } from "./agent/agent-storage.js";
import { getWorkspaceTeamService } from "./workspace-team-runtime.js";
import { getOrCreateServerId } from "./server-id.js";
import { createTestLogger } from "../test-utils/test-logger.js";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
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
  it("initializes directory context, persists edits, and rebases only the root when execution moves", async () => {
    vi.mocked(transport.inspect).mockResolvedValue({
      provider: "codex",
      cwd: "/Users/me/mock_platform",
      busy: false,
    });
    const { team, member } = await setup();
    expect(member.pathContext).toEqual({
      repository: "mock_platform",
      root: "/Users/me/mock_platform",
    });
    const edited = await service.executeSession(workspace, session, {
      kind: "edit",
      memberId: member.id,
      revision: team.revision,
      alias: member.alias,
      role: member.role,
      skills: [],
      captain: false,
      pathContext: { repository: "platform", root: "/Users/me" },
    });
    const same = await service.executeSession(workspace, session, {
      kind: "configure_execution",
      memberId: member.id,
      revision: edited.revision,
      execution: {
        serverId: member.serverId,
        workspaceId: member.workspaceId,
        agentId: member.agentId,
        provider: member.provider,
        operationId: randomUUID(),
      },
    });
    expect(same.members[1]!.pathContext).toEqual({ repository: "platform", root: "/Users/me" });
    vi.mocked(transport.inspect).mockResolvedValue({
      provider: "codex",
      cwd: "/workspace/platform",
      busy: false,
    });
    const moved = await service.executeSession(workspace, session, {
      kind: "configure_execution",
      memberId: member.id,
      revision: same.revision,
      execution: runner(),
    });
    expect(moved.members[1]!.pathContext).toEqual({
      repository: "platform",
      root: "/workspace/platform",
    });
    expect((await read()).members[1]!.pathContext).toEqual(moved.members[1]!.pathContext);
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
    expect(changed.members[1]).toMatchObject({ ...member, alias: "model-a", execution });
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
  it("updates an automatic alias for an in-place model change without adding execution history", async () => {
    const { team, member } = await setup();
    vi.mocked(transport.inspect).mockResolvedValue({
      provider: "codex",
      model: "gpt-new",
      busy: false,
    });
    const changed = await service.executeSession(workspace, session, {
      kind: "configure_execution",
      memberId: member.id,
      revision: team.revision,
      execution: {
        serverId: member.serverId,
        workspaceId: member.workspaceId,
        agentId: member.agentId,
        provider: member.provider,
        model: "gpt-new",
        operationId: randomUUID(),
      },
    });
    expect(changed.members[1]!.alias).toBe("gpt-new");
    expect(changed.members[1]!.executionHistory).toBeUndefined();
  });
  it("names peers after their own model, disambiguates duplicates and preserves manual names", async () => {
    vi.mocked(transport.inspect).mockResolvedValue({
      provider: "claude",
      model: "Opus 5.5",
      busy: false,
    });
    const { member } = await setup();
    expect(member.alias).toBe("Opus-5-5");
    const added = await service.executeSession(workspace, session, {
      kind: "join",
      serverId: "mac",
      workspaceId: workspace,
      agentId: randomUUID(),
      paneId: "third",
      owned: true,
    });
    expect(added.members[2]!.alias).toBe("Opus-5-5-2");
    const edited = await service.executeSession(workspace, session, {
      kind: "edit",
      memberId: member.id,
      revision: added.revision,
      alias: "Reviewer",
      role: "",
      skills: [],
      captain: false,
    });
    vi.mocked(transport.inspect).mockResolvedValue({
      provider: "codex",
      model: "gpt-6.1-sol",
      busy: false,
    });
    const changed = await service.executeSession(workspace, session, {
      kind: "configure_execution",
      memberId: member.id,
      revision: edited.revision,
      execution: runner(),
    });
    expect(changed.members[1]!.alias).toBe("Reviewer");
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
  it("delivers completion reports to Captain's selected remote execution", async () => {
    const { team, member } = await setup();
    const execution = runner();
    await service.executeSession(workspace, session, {
      kind: "configure_execution",
      memberId: team.captainId!,
      revision: team.revision,
      execution,
    });
    vi.mocked(transport.observe).mockResolvedValue({ status: "completed", result: "Done" });
    const taskId = randomUUID();
    await service.executeSession(workspace, session, {
      kind: "send",
      memberId: member.id,
      senderId: null,
      taskId,
      prompt: "Check",
    });
    await service.executeSession(workspace, session, { kind: "refresh", taskId });
    expect(transport.notify).toHaveBeenCalledWith(
      expect.objectContaining({ id: team.captainId, ...execution }),
      expect.objectContaining({ result: "Done" }),
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
  it("changes Captain execution while preserving conversation and anchor ownership", async () => {
    const { team } = await setup();
    const original = team.members[0]!;
    const execution = runner();
    const changed = await service.executeSession(workspace, session, {
      kind: "configure_execution",
      memberId: team.captainId!,
      revision: team.revision,
      execution,
    });
    expect(changed.captainId).toBe(team.captainId);
    expect(changed.members[0]).toMatchObject({ ...original, execution });
    expect(executionMember(changed.members[0]!)).toMatchObject(execution);
    expect(transport.archive).not.toHaveBeenCalled();
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

describe("legacy member alias recovery", () => {
  it("repairs persisted provider defaults on read and follows the next model switch", async () => {
    const home = await mkdtemp(join(tmpdir(), "paseo-legacy-name-"));
    const transport: TeamTransport = {
      inspect: vi.fn(async () => ({ provider: "codex", busy: false })),
      send: vi.fn(async () => "acknowledged" as const),
      observe: vi.fn(async () => ({ status: "running" as const, result: "" })),
      notify: vi.fn(async () => {}),
    };
    const service = new WorkspaceTeamService(home, "mac", transport);
    try {
      const workspace = "work",
        session = randomUUID();
      await service.executeSession(workspace, session, {
        kind: "join",
        serverId: "mac",
        workspaceId: workspace,
        agentId: randomUUID(),
        paneId: "captain",
      });
      const team = await service.executeSession(workspace, session, {
        kind: "join",
        serverId: "mac",
        workspaceId: workspace,
        agentId: randomUUID(),
        paneId: "peer",
      });
      const file = join(
        home,
        "conversation-teams",
        (await readdir(join(home, "conversation-teams")))[0]!,
      );
      const legacy = JSON.parse(await readFile(file, "utf8"));
      delete legacy.members[1].automaticAlias;
      legacy.members[1].alias = "Codex";
      legacy.members[1].execution = {
        serverId: "mac",
        workspaceId: workspace,
        agentId: team.members[1]!.agentId,
        provider: "claude",
        model: "claude-opus-5-5",
      };
      await writeFile(file, JSON.stringify(legacy));
      const read = await service.executeSession(workspace, session, { kind: "read" });
      expect(read.members[1]).toMatchObject({
        alias: "claude-opus-5-5",
        automaticAlias: true,
        id: team.members[1]!.id,
      });
      vi.mocked(transport.inspect).mockResolvedValue({ provider: "codex", busy: false });
      const changed = await service.executeSession(workspace, session, {
        kind: "configure_execution",
        memberId: team.members[1]!.id,
        revision: read.revision,
        execution: {
          serverId: "mac",
          workspaceId: workspace,
          agentId: team.members[1]!.agentId,
          provider: "codex",
          model: "gpt-next",
          operationId: randomUUID(),
        },
      });
      expect(changed.members[1]).toMatchObject({
        alias: "gpt-next",
        automaticAlias: true,
        id: team.members[1]!.id,
      });
    } finally {
      service.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("team path communication", () => {
  it("uses recipient mapping and labels result roots without rewriting file references", () => {
    const paths = { repository: "platform", root: "/workspace/platform" };
    const instructions = memberPathInstructions({ serverId: "devbox", pathContext: paths });
    expect(instructions).toContain(JSON.stringify(paths));
    expect(instructions).toContain("repository-relative path");
    expect(instructions).toContain("not shared or automatically transferred");
    expect(
      resultPathInstructions({
        pathContext: { repository: "platform", root: "/Users/me/platform" },
      }),
    ).toContain("do not use its root locally");
    expect(memberPathInstructions({ serverId: "mac" })).toContain("verify your working directory");
  });
});
