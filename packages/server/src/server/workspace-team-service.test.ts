import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { RemoteAgentConnection } from "./agent/remote-agent-connection.js";
import { WorkspaceTeamService, type TeamTransport } from "./workspace-team-service.js";

describe("workspace team dispatch", () => {
  let home: string;
  let service: WorkspaceTeamService;
  let transport: TeamTransport;
  const workspace = "workspace-owner";
  beforeEach(async () => {
    vi.useFakeTimers();
    home = await mkdtemp(join(tmpdir(), "paseo-team-"));
    transport = {
      inspect: vi.fn(async () => ({ provider: "claude", busy: false })),
      send: vi.fn(async () => "acknowledged" as const),
      observe: vi.fn(async () => ({ status: "completed" as const, result: "Verified result" })),
      notify: vi.fn(async () => {}),
    };
    service = new WorkspaceTeamService(home, "host", transport);
  });
  afterEach(async () => {
    service.dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
    await rm(home, { recursive: true, force: true });
  });
  async function members() {
    await service.execute(workspace, {
      kind: "join",
      serverId: "host",
      workspaceId: workspace,
      agentId: randomUUID(),
    });
    const team = await service.execute(workspace, {
      kind: "join",
      serverId: "remote",
      workspaceId: "remote-workspace",
      agentId: randomUUID(),
    });
    return { team, captain: team.members[0]!, member: team.members[1]! };
  }
  it("keeps stable identities across naming, duplicate enrollment and restart", async () => {
    const { team, captain, member } = await members();
    expect(captain.alias).toBe("Captain");
    const renamed = await service.execute(workspace, {
      kind: "edit",
      memberId: member.id,
      alias: "分析员",
      role: "Read-only code review",
      skills: ["Go"],
      captain: false,
      revision: team.revision,
    });
    const duplicate = await service.execute(workspace, {
      kind: "join",
      serverId: member.serverId,
      workspaceId: member.workspaceId,
      agentId: member.agentId,
    });
    expect(duplicate.members).toEqual(renamed.members);
    expect(duplicate.members[1]).toMatchObject({
      id: member.id,
      agentId: member.agentId,
      alias: "分析员",
      skills: ["Go"],
    });
    expect(
      await new WorkspaceTeamService(home, "host", transport).execute(workspace, { kind: "read" }),
    ).toEqual(renamed);
    await expect(
      service.execute(workspace, {
        kind: "edit",
        memberId: member.id,
        alias: "captain",
        role: "",
        skills: [],
        captain: false,
        revision: renamed.revision,
      }),
    ).rejects.toThrow("already in use");
    await expect(
      service.execute(workspace, {
        kind: "edit",
        memberId: member.id,
        alias: "Analyst",
        role: "",
        skills: [],
        captain: false,
        revision: team.revision,
      }),
    ).rejects.toThrow("Team changed");
  });
  it("delivers concurrent retries once and returns a completed result to Captain once", async () => {
    const { member, captain } = await members();
    const action = {
      kind: "send" as const,
      memberId: member.id,
      senderId: captain.id,
      taskId: randomUUID(),
      prompt: "Review the receipt endpoint",
    };
    await Promise.all([service.execute(workspace, action), service.execute(workspace, action)]);
    expect(transport.send).toHaveBeenCalledTimes(1);
    await Promise.all([
      service.refresh(workspace, action.taskId),
      service.refresh(workspace, action.taskId),
    ]);
    expect(transport.notify).toHaveBeenCalledTimes(1);
    const team = await service.execute(workspace, { kind: "read" });
    expect(team.tasks[0]).toMatchObject({
      id: action.taskId,
      status: "completed",
      result: "Verified result",
      notification: "delivered",
    });
    await service.execute(workspace, action);
    expect(transport.send).toHaveBeenCalledTimes(1);
    await expect(
      service.execute(workspace, { ...action, prompt: "Different task" }),
    ).rejects.toThrow("another request");
  });
  it("rejects busy recipients without interrupting their current work", async () => {
    const { member } = await members();
    vi.mocked(transport.inspect).mockResolvedValue({ provider: "claude", busy: true });
    await expect(
      service.execute(workspace, {
        kind: "send",
        memberId: member.id,
        senderId: null,
        taskId: randomUUID(),
        prompt: "Task",
      }),
    ).rejects.toThrow("busy");
    expect(transport.send).not.toHaveBeenCalled();
  });
  it("retains ambiguous dispatch without resending, even after restart", async () => {
    const { member } = await members();
    vi.mocked(transport.send).mockRejectedValue(new Error("Lost acknowledgement"));
    const action = {
      kind: "send" as const,
      memberId: member.id,
      senderId: null,
      taskId: randomUUID(),
      prompt: "Task",
    };
    expect((await service.execute(workspace, action)).tasks[0]?.status).toBe("uncertain");
    const restarted = new WorkspaceTeamService(home, "host", transport);
    await restarted.resume();
    await restarted.execute(workspace, action);
    expect(transport.send).toHaveBeenCalledTimes(1);
    await expect(restarted.execute(workspace, { ...action, taskId: randomUUID() })).rejects.toThrow(
      "unconfirmed",
    );
    await restarted.execute(workspace, { kind: "refresh", taskId: action.taskId });
    expect(transport.send).toHaveBeenCalledTimes(1);
  });
  it("does not infer a running turn from a disconnected host", async () => {
    const { member } = await members();
    const taskId = randomUUID();
    await service.execute(workspace, {
      kind: "send",
      memberId: member.id,
      senderId: null,
      taskId,
      prompt: "Task",
    });
    vi.mocked(transport.observe).mockRejectedValue(new Error("offline"));
    await service.refresh(workspace, taskId);
    expect((await service.execute(workspace, { kind: "read" })).tasks[0]).toMatchObject({
      status: "running",
      observedRunning: false,
    });
    expect(transport.notify).not.toHaveBeenCalled();
  });
  it("preserves permission requests and allows member edits while task status changes", async () => {
    const { team, member } = await members();
    const taskId = randomUUID();
    await service.execute(workspace, {
      kind: "send",
      memberId: member.id,
      senderId: null,
      taskId,
      prompt: "Task",
    });
    vi.mocked(transport.observe).mockResolvedValue({
      status: "permission",
      result: "Waiting for user",
    });
    await service.refresh(workspace, taskId);
    expect(transport.notify).not.toHaveBeenCalled();
    const edited = await service.execute(workspace, {
      kind: "edit",
      memberId: member.id,
      alias: "Reviewer",
      role: "Review",
      skills: [],
      captain: false,
      revision: team.revision,
    });
    expect(edited.tasks[0]?.status).toBe("permission");
  });
  it("defers completion reports while Captain is busy and stops watchers on disposal", async () => {
    const { member, captain } = await members();
    const taskId = randomUUID();
    await service.execute(workspace, {
      kind: "send",
      memberId: member.id,
      senderId: null,
      taskId,
      prompt: "Task",
    });
    vi.mocked(transport.inspect).mockImplementation(async (m) => ({
      provider: "claude",
      busy: m.agentId === captain.agentId,
    }));
    await service.refresh(workspace, taskId);
    expect((await service.execute(workspace, { kind: "read" })).tasks[0]).toMatchObject({
      status: "completed",
      notification: "pending",
    });
    expect(transport.notify).not.toHaveBeenCalled();
    vi.mocked(transport.inspect).mockResolvedValue({ provider: "claude", busy: false });
    await service.refresh(workspace, taskId);
    expect(transport.notify).toHaveBeenCalledTimes(1);
    service.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not replay old task IDs after their visible history is pruned", async () => {
    const { member } = await members();
    const first = {
      kind: "send" as const,
      memberId: member.id,
      senderId: null,
      taskId: randomUUID(),
      prompt: "First",
    };
    await service.execute(workspace, first);
    await service.refresh(workspace, first.taskId);
    for (let i = 0; i < 22; i++) {
      const taskId = randomUUID();
      await service.execute(workspace, { ...first, taskId, prompt: `Task ${i}` });
      await service.refresh(workspace, taskId);
    }
    expect(
      (await service.execute(workspace, { kind: "read" })).tasks.some((t) => t.id === first.taskId),
    ).toBe(false);
    await expect(service.execute(workspace, first)).rejects.toThrow("already submitted");
    expect(transport.send).toHaveBeenCalledTimes(23);
  });
  it("keeps reads and edits responsive while a remote inspection is blocked", async () => {
    const { team, member } = await members();
    let release!: (value: { provider: string; busy: boolean }) => void;
    vi.mocked(transport.inspect).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const send = service.execute(workspace, {
      kind: "send",
      memberId: member.id,
      senderId: null,
      taskId: randomUUID(),
      prompt: "Task",
    });
    await Promise.resolve();
    const edited = await service.execute(workspace, {
      kind: "edit",
      memberId: member.id,
      alias: "Fast",
      role: "",
      skills: [],
      captain: false,
      revision: team.revision,
    });
    expect(edited.members[1]?.alias).toBe("Fast");
    release({ provider: "claude", busy: false });
    await send;
  });

  it("reconciles a lost send acknowledgement on a host event without resending", async () => {
    service.dispose();
    let changed!: (event: { serverId: string; agentId?: string }) => void;
    transport.subscribe = (listener) => {
      changed = listener;
      return () => {};
    };
    service = new WorkspaceTeamService(home, "host", transport);
    const { member } = await members();
    vi.mocked(transport.send).mockRejectedValueOnce(new Error("lost acknowledgement"));
    const taskId = randomUUID();
    await service.execute(workspace, {
      kind: "send",
      memberId: member.id,
      senderId: null,
      taskId,
      prompt: "Task",
    });
    changed({ serverId: member.serverId, agentId: member.agentId });
    await vi.waitFor(async () => {
      expect((await service.execute(workspace, { kind: "read" })).tasks[0]?.notification).toBe(
        "delivered",
      );
    });
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(transport.notify).toHaveBeenCalledTimes(1);
  });

  it("persists the same completion identity when reconciling a lost report acknowledgement", async () => {
    const { member } = await members();
    const taskId = randomUUID();
    await service.execute(workspace, {
      kind: "send",
      memberId: member.id,
      senderId: null,
      taskId,
      prompt: "Task",
    });
    vi.mocked(transport.notify).mockRejectedValueOnce(new Error("unknown report acknowledgement"));
    await service.refresh(workspace, taskId);
    const first = (await service.execute(workspace, { kind: "read" })).tasks[0]!;
    expect(first).toMatchObject({
      notification: "uncertain",
      notificationId: `team-report-${taskId}`,
    });
    await service.refresh(workspace, taskId);
    expect((await service.execute(workspace, { kind: "read" })).tasks[0]).toMatchObject({
      notification: "delivered",
      notificationId: first.notificationId,
    });
    expect(vi.mocked(transport.notify).mock.calls.map((call) => call[1].notificationId)).toEqual([
      first.notificationId,
      first.notificationId,
    ]);
  });

  it("marks interrupted sends uncertain and never replays uncertain completion notices", async () => {
    const { member } = await members();
    const taskId = randomUUID();
    await service.execute(workspace, {
      kind: "send",
      memberId: member.id,
      senderId: null,
      taskId,
      prompt: "Task",
    });
    const file = join(home, "workspace-teams", (await readdir(join(home, "workspace-teams")))[0]!);
    const saved = JSON.parse(await readFile(file, "utf8"));
    saved.tasks[0].status = "sending";
    saved.tasks[0].notification = "sending";
    await writeFile(file, JSON.stringify(saved));
    const restarted = new WorkspaceTeamService(home, "host", transport);
    await restarted.resume();
    expect((await restarted.execute(workspace, { kind: "read" })).tasks[0]).toMatchObject({
      status: "uncertain",
      notification: "uncertain",
    });
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(transport.notify).not.toHaveBeenCalled();
  });
});

describe("persistent collaboration connection", () => {
  let home: string;
  let connection: RemoteAgentConnection;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "paseo-connection-"));
  });
  afterEach(async () => {
    connection?.dispose();
    await rm(home, { recursive: true, force: true });
  });
  async function bridge(serverId = "remote") {
    const script = join(home, "bridge.cjs");
    await writeFile(
      script,
      `const fs = require('node:fs');
const readline = require('node:readline');
fs.appendFileSync(${JSON.stringify(join(home, "starts"))}, 'start\\n');
console.log(JSON.stringify({event:'ready',version:1,serverId:${JSON.stringify(serverId)}}));
readline.createInterface({input:process.stdin}).on('line',line => {
  const request=JSON.parse(line);
  fs.appendFileSync(${JSON.stringify(join(home, "requests"))}, JSON.stringify(request)+'\\n');
  if(request.op==='drop')process.exit(1);
  console.log(JSON.stringify({id:request.id,result:{ok:true,agentId:request.agentId}}));
});`,
    );
    return [process.execPath, script];
  }
  it("multiplexes requests and restores reads after disconnect without replaying a write", async () => {
    connection = new RemoteAgentConnection({ id: "remote", command: await bridge() }, () => {});
    const agentId = randomUUID();
    await connection.request({ op: "watch", agentId });
    await Promise.all(
      Array.from({ length: 8 }, () => connection.request({ op: "inspect", agentId })),
    );
    expect((await readFile(join(home, "starts"), "utf8")).trim().split("\n")).toHaveLength(1);
    await expect(connection.request({ op: "drop", agentId })).rejects.toThrow("closed");
    expect(await connection.request({ op: "inspect", agentId })).toMatchObject({ agentId });
    const calls = (await readFile(join(home, "requests"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls.filter((call) => call.op === "drop")).toHaveLength(1);
    expect(calls.filter((call) => call.op === "watch")).toHaveLength(2);
  });
  it("rejects a different host before sending an operation", async () => {
    connection = new RemoteAgentConnection(
      { id: "expected", command: await bridge("wrong") },
      () => {},
    );
    await expect(connection.request({ op: "inspect", agentId: randomUUID() })).rejects.toThrow(
      "identity",
    );
    await expect(readFile(join(home, "requests"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
