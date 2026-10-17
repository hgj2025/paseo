import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { TeamAction, TeamMember, TeamTask } from "@getpaseo/protocol/workspace-team";
import { WorkspaceTeamService, type TeamTransport } from "./workspace-team-service.js";

describe("persisted team requests", () => {
  let home: string;
  let service: WorkspaceTeamService;
  let transport: TeamTransport;
  let captain: TeamMember;
  let first: TeamMember;
  let second: TeamMember;
  const workspace = "owner-workspace";
  const execute = (action: TeamAction) => service.execute(workspace, action);
  beforeEach(async () => {
    vi.useFakeTimers();
    home = await mkdtemp(join(tmpdir(), "paseo-groups-"));
    transport = {
      inspect: vi.fn(async () => ({ provider: "claude", busy: false })),
      send: vi.fn(async () => "acknowledged" as const),
      observe: vi.fn(async () => ({ status: "completed" as const, result: "Verified output" })),
      notify: vi.fn(async () => {}),
    };
    service = new WorkspaceTeamService(home, "host", transport);
    for (const serverId of ["host", "remote", "host"]) {
      await execute({ kind: "join", serverId, workspaceId: workspace, agentId: randomUUID() });
    }
    [captain, first, second] = (await execute({ kind: "read" })).members as [
      TeamMember,
      TeamMember,
      TeamMember,
    ];
  });
  afterEach(async () => {
    service.dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
    await rm(home, { force: true, recursive: true });
  });
  function start(
    mode: "coordinate" | "broadcast" = "broadcast",
  ): Extract<TeamAction, { kind: "start_group" }> {
    return {
      kind: "start_group",
      groupId: randomUUID(),
      senderId: captain.id,
      memberIds: [first.id, second.id],
      mode,
      prompt: "Review and validate this change",
    };
  }
  it("broadcasts once per member, survives repeat submissions, and reports the group once", async () => {
    const action = start();
    await Promise.all([execute(action), execute(action)]);
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(transport.notify).not.toHaveBeenCalled();
    const done = await execute({ kind: "refresh_group", groupId: action.groupId });
    expect(done.groups?.[0]).toMatchObject({ status: "completed", notification: "delivered" });
    expect(done.tasks.map((t) => t.notification)).toEqual(["none", "none"]);
    await execute(action);
    await execute({ kind: "refresh_group", groupId: action.groupId });
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(transport.notify).toHaveBeenCalledTimes(1);
    await expect(execute({ ...action, prompt: "Different work" })).rejects.toThrow(
      "another request",
    );
  });
  it("lets Captain plan first, then passes completed dependency output to the next member", async () => {
    const action = start("coordinate");
    await execute(action);
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(vi.mocked(transport.send).mock.calls[0]![0].id).toBe(captain.id);
    const plan = {
      kind: "plan_group" as const,
      groupId: action.groupId,
      captainId: captain.id,
      steps: [
        { memberId: first.id, prompt: "Implement", dependsOn: [] },
        { memberId: second.id, prompt: "Review", dependsOn: [first.id] },
      ],
    };
    await execute(plan);
    expect(transport.send).toHaveBeenCalledTimes(2);
    await execute(plan);
    expect(transport.send).toHaveBeenCalledTimes(2);
    await execute({ kind: "refresh_group", groupId: action.groupId });
    expect(transport.send).toHaveBeenCalledTimes(3);
    expect(vi.mocked(transport.send).mock.calls[2]![1].prompt).toContain("Verified output");
    expect(transport.notify).not.toHaveBeenCalled();
    await execute({ kind: "refresh_group", groupId: action.groupId });
    expect(transport.notify).toHaveBeenCalledTimes(1);
  });
  it("rejects incomplete, cyclic and unauthorized plans before dispatching collaborators", async () => {
    const action = start("coordinate");
    await execute(action);
    const plan = {
      kind: "plan_group" as const,
      groupId: action.groupId,
      captainId: captain.id,
      steps: [
        { memberId: first.id, prompt: "First", dependsOn: [second.id] },
        { memberId: second.id, prompt: "Second", dependsOn: [first.id] },
      ],
    };
    await expect(execute(plan)).rejects.toThrow("cycle");
    await expect(execute({ ...plan, steps: plan.steps.slice(0, 1) })).rejects.toThrow(
      "exactly one",
    );
    await expect(execute({ ...plan, captainId: first.id })).rejects.toThrow("Only this request");
    expect(transport.send).toHaveBeenCalledTimes(1);
  });
  it("queues busy members and resumes after restart without resending completed work", async () => {
    vi.mocked(transport.inspect).mockImplementation(async (member) => ({
      provider: "claude",
      busy: member.agentId === second.agentId,
    }));
    const action = start();
    const queued = await execute(action);
    expect(queued.groups?.[0]?.steps.find((s) => s.memberId === second.id)?.status).toBe("queued");
    expect(transport.send).toHaveBeenCalledTimes(1);
    await execute({ kind: "refresh_group", groupId: action.groupId });
    service.dispose();
    service = new WorkspaceTeamService(home, "host", transport);
    vi.mocked(transport.inspect).mockResolvedValue({ provider: "claude", busy: false });
    await execute({ kind: "refresh_group", groupId: action.groupId });
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(transport.send)
        .mock.calls.map(([member]) => member.id)
        .sort(),
    ).toEqual([first.id, second.id].sort());
  });
  it("retries only a failed member and deduplicates retry clicks", async () => {
    vi.mocked(transport.observe).mockImplementation(async (member) => ({
      status: member.id === first.id ? "failed" : "completed",
      result: "Finished",
    }));
    const action = start();
    await execute(action);
    await execute({ kind: "refresh_group", groupId: action.groupId });
    const retry = {
      kind: "retry_group_step" as const,
      groupId: action.groupId,
      memberId: first.id,
      retryId: randomUUID(),
    };
    await Promise.all([execute(retry), execute(retry)]);
    expect(transport.send).toHaveBeenCalledTimes(3);
    expect(vi.mocked(transport.send).mock.calls[2]![0].id).toBe(first.id);
    await expect(execute({ ...retry, memberId: second.id, retryId: randomUUID() })).rejects.toThrow(
      "Only a confirmed failed",
    );
  });
  it("never retries an uncertain dispatch and retries only the summary after a lost acknowledgement", async () => {
    vi.mocked(transport.send).mockResolvedValue("uncertain");
    vi.mocked(transport.observe).mockResolvedValue({
      status: "uncertain",
      result: "Not confirmed",
    });
    const action = start();
    await execute(action);
    await expect(
      execute({
        kind: "retry_group_step",
        groupId: action.groupId,
        memberId: first.id,
        retryId: randomUUID(),
      }),
    ).rejects.toThrow("Only a confirmed failed");
    await execute({ kind: "refresh_group", groupId: action.groupId });
    expect(transport.send).toHaveBeenCalledTimes(2);
    vi.mocked(transport.observe).mockResolvedValue({ status: "completed", result: "Confirmed" });
    vi.mocked(transport.notify).mockRejectedValueOnce(new Error("Lost ACK"));
    await execute({ kind: "refresh_group", groupId: action.groupId });
    await execute({ kind: "refresh_group", groupId: action.groupId });
    const reports = vi.mocked(transport.notify).mock.calls.map(([, task]) => task as TeamTask);
    expect(reports).toHaveLength(2);
    expect(reports[0]!.notificationId).toBe(reports[1]!.notificationId);
    expect(transport.send).toHaveBeenCalledTimes(2);
  });
  it("keeps long requests and dependency output within the persisted task schema", async () => {
    const action = { ...start("coordinate"), prompt: "x".repeat(40000) };
    await execute(action);
    await execute({
      kind: "plan_group",
      groupId: action.groupId,
      captainId: captain.id,
      steps: [
        { memberId: first.id, prompt: "Analyze", dependsOn: [] },
        { memberId: second.id, prompt: "y".repeat(39000), dependsOn: [first.id] },
      ],
    });
    vi.mocked(transport.observe).mockResolvedValue({
      status: "completed",
      result: "z".repeat(64000),
    });
    await execute({ kind: "refresh_group", groupId: action.groupId });
    const saved = await execute({ kind: "read" });
    expect(saved.groups?.[0]?.prompt).toHaveLength(40000);
    expect(saved.tasks).toHaveLength(3);
    expect(saved.tasks.every((task) => task.prompt.length <= 40000)).toBe(true);
    expect(saved.tasks.at(-1)?.prompt).toContain("truncated");
    expect(saved.tasks.at(-1)?.prompt).toContain("y".repeat(39000));
  });
});
