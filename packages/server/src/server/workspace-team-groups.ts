import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  TeamAction,
  TeamGroup,
  TeamGroupStep,
  TeamTask,
  WorkspaceTeam,
} from "@getpaseo/protocol/workspace-team";
import type { TeamTransport } from "./workspace-team-service.js";

type GroupAction = Extract<
  TeamAction,
  { kind: "start_group" | "plan_group" | "retry_group_step" | "refresh_group" }
>;
interface GroupStorage {
  read(): Promise<WorkspaceTeam>;
  change<T>(fn: (team: WorkspaceTeam) => T | Promise<T>): Promise<T>;
  dispatch(action: Extract<TeamAction, { kind: "send" }>): Promise<WorkspaceTeam>;
}
const ended = (group: TeamGroup) => ["completed", "failed"].includes(group.status);
export const pendingGroup = (group: TeamGroup) =>
  group.status !== "clarification" && (!ended(group) || group.notification !== "delivered");

/** Persist intent before network work. A stable task ID survives retries, disconnects and restarts. */
export class WorkspaceTeamGroups {
  private readonly advancing = new Map<string, Promise<void>>();
  constructor(
    private readonly home: string,
    private readonly transport: TeamTransport,
    private readonly storage: (workspaceId: string) => GroupStorage,
  ) {}

  async execute(workspaceId: string, action: GroupAction) {
    const storage = this.storage(workspaceId);
    if (action.kind === "start_group") await storage.change((team) => this.start(team, action));
    if (action.kind === "plan_group") await storage.change((team) => this.plan(team, action));
    if (action.kind === "retry_group_step")
      await storage.change((team) => this.retry(team, action));
    // Scheduling is bounded by the existing transport timeouts and never holds a storage lock.
    await this.advance(workspaceId);
    return storage.read();
  }

  private async start(team: WorkspaceTeam, action: Extract<GroupAction, { kind: "start_group" }>) {
    const memberIds = [...new Set(action.memberIds)].sort();
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([team.workspaceId, action.senderId, action.mode, memberIds, action.prompt]),
      )
      .digest("hex");
    const prior = team.groups?.find((group) => group.id === action.groupId);
    const receipt = join(this.home, "workspace-team-group-receipts", action.groupId + ".json");
    try {
      const saved = JSON.parse(await readFile(receipt, "utf8"));
      if (saved.fingerprint !== fingerprint)
        throw new Error("Group ID already belongs to another request.");
      if (prior) return;
      throw new Error(
        "This request was already accepted. Inspect the team history; it will not be resent.",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!action.prompt.trim()) throw new Error("Enter a task before sending.");
    if (!team.captainId || !team.members.some((m) => m.id === action.senderId))
      throw new Error("A Captain and a valid sender are required.");
    for (const id of memberIds) {
      if (!team.members.some((m) => m.id === id))
        throw new Error("A selected member is no longer in this team.");
      if (id === team.captainId)
        throw new Error("Select collaborators; Captain coordinates and summarizes this request.");
    }
    const now = new Date().toISOString();
    const group: TeamGroup = {
      id: action.groupId,
      mode: action.mode,
      prompt: action.prompt,
      memberIds,
      senderId: action.senderId,
      captainId: team.captainId,
      coordinatorTaskId: randomUUID(),
      status: action.mode === "coordinate" ? "planning" : "running",
      steps:
        action.mode === "broadcast"
          ? memberIds.map((memberId) =>
              this.step({ memberId, prompt: action.prompt, dependsOn: [] }),
            )
          : [],
      createdAt: now,
      updatedAt: now,
      result: "",
      notification: "pending",
      notificationId: randomUUID(),
      retryIds: [],
    };
    await mkdir(join(this.home, "workspace-team-group-receipts"), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(receipt, JSON.stringify({ fingerprint }), { mode: 0o600, flag: "wx" });
    const groups = team.groups ?? [];
    const recent = new Set(
      groups.filter((g) => ended(g) && g.notification === "delivered").slice(-29),
    );
    team.groups = [
      ...groups.filter((g) => !ended(g) || g.notification !== "delivered" || recent.has(g)),
      group,
    ];
  }
  private step(input: Pick<TeamGroupStep, "memberId" | "prompt" | "dependsOn">): TeamGroupStep {
    return { ...input, taskIds: [randomUUID()], status: "queued", result: "" };
  }
  private plan(team: WorkspaceTeam, action: Extract<GroupAction, { kind: "plan_group" }>) {
    const group = this.get(team, action.groupId);
    if (group.captainId !== action.captainId || group.mode !== "coordinate")
      throw new Error("Only this request's Captain can commit its plan.");
    if (group.steps.length) {
      const saved = group.steps.map(({ memberId, prompt, dependsOn }) => ({
        memberId,
        prompt,
        dependsOn,
      }));
      if (JSON.stringify(saved) !== JSON.stringify(action.steps))
        throw new Error("The plan is already committed and cannot be replaced.");
      return;
    }
    for (const step of action.steps) {
      if (!step.prompt.trim()) throw new Error("Every member needs a non-empty task.");
      if (step.dependsOn.length && step.prompt.length > 39000)
        throw new Error(
          "Shorten a dependent task to 39000 characters to leave room for dependency results.",
        );
    }
    const ids = action.steps.map((step) => step.memberId);
    if (
      new Set(ids).size !== ids.length ||
      ids.length !== group.memberIds.length ||
      ids.some((id) => !group.memberIds.includes(id))
    )
      throw new Error(
        "The plan must assign exactly one task to every selected collaborator, and nobody else.",
      );
    const byId = new Map(action.steps.map((step) => [step.memberId, step]));
    const visited = new Set<string>();
    const visit = (id: string, path: Set<string>) => {
      if (visited.has(id)) return;
      if (path.has(id)) throw new Error("Task dependencies must not contain a cycle.");
      const step = byId.get(id);
      if (!step) throw new Error("A dependency must reference another selected collaborator.");
      for (const dependency of step.dependsOn) visit(dependency, new Set([...path, id]));
      visited.add(id);
    };
    ids.forEach((id) => visit(id, new Set()));
    group.steps = action.steps.map((step) => this.step(step));
    group.status = "running";
    group.updatedAt = new Date().toISOString();
  }
  private retry(team: WorkspaceTeam, action: Extract<GroupAction, { kind: "retry_group_step" }>) {
    const group = this.get(team, action.groupId);
    if (group.retryIds.includes(action.retryId)) return;
    const step = group.steps.find((s) => s.memberId === action.memberId);
    if (!step || step.status !== "failed")
      throw new Error(
        "Only a confirmed failed task can be retried. Check uncertain delivery first.",
      );
    step.taskIds.push(randomUUID());
    step.status = "queued";
    step.result = "";
    group.retryIds.push(action.retryId);
    group.status = "running";
    group.notification = "pending";
    group.notificationId = randomUUID();
    for (const blocked of group.steps) if (blocked.status === "blocked") blocked.status = "queued";
  }
  private get(team: WorkspaceTeam, id: string) {
    const group = team.groups?.find((g) => g.id === id);
    if (!group) throw new Error("Team request not found.");
    return group;
  }

  async advance(workspaceId: string) {
    const existing = this.advancing.get(workspaceId);
    if (existing) return existing;
    const work = this.advanceOnce(workspaceId);
    this.advancing.set(workspaceId, work);
    try {
      await work;
    } finally {
      this.advancing.delete(workspaceId);
    }
  }
  private async advanceOnce(workspaceId: string) {
    const storage = this.storage(workspaceId);
    const snapshot = await storage.read();
    for (const group of snapshot.groups ?? []) {
      if (!pendingGroup(group)) continue;
      if (!group.steps.length) await this.coordinate(storage, group);
      else {
        await this.sync(storage, group.id);
        // Separate hosts/members can start concurrently; per-member reservations remain in dispatch.
        const current = this.get(await storage.read(), group.id);
        await Promise.all(
          current.steps
            .filter((step) => step.status === "queued")
            .map((step) => this.runStep(storage, current, step)),
        );
        await this.sync(storage, group.id);
        await this.report(storage, group.id);
      }
    }
  }
  private async coordinate(storage: GroupStorage, group: TeamGroup) {
    const team = await storage.read();
    const task = team.tasks.find((t) => t.id === group.coordinatorTaskId);
    if (task) {
      await storage.change((latest) => {
        const current = this.get(latest, group.id);
        if (current.steps.length) return;
        if (["completed", "failed"].includes(task.status)) current.status = "clarification";
        if (task.status === "uncertain") current.status = "uncertain";
        current.result = task.result;
      });
      return;
    }
    const roster = team.members
      .filter((m) => group.memberIds.includes(m.id))
      .map(({ id, alias }) => ({ id, alias }));
    const request =
      group.prompt.length > 34000
        ? group.prompt.slice(0, 34000) +
          "\n[Read the full request with get_team_tasks before planning.]"
        : group.prompt;
    const prompt = `[Team request ${group.id}]\n${request}\n\nYou are Captain. Coordinate ONLY the user-selected members below. Use list_team_members to read their roles and skills, then assign exactly one scoped task per member using plan_team_request (workspaceId=${team.workspaceId}, groupId=${group.id}). Include dependsOn member IDs for sequential work. If ambiguous, ask the user here and wait; do not guess. The service executes the persisted plan, waits for busy members, and reports once after the group ends. Do not send_team_task separately or poll. Never approve another member's permissions.\nSelected members: ${JSON.stringify(roster)}`;
    try {
      await storage.dispatch({
        kind: "send",
        taskId: group.coordinatorTaskId,
        memberId: group.captainId,
        senderId: group.senderId,
        groupId: group.id,
        prompt,
      });
    } catch (error) {
      await storage.change((latest) => {
        this.get(latest, group.id).result = String(error);
      });
    }
  }
  private async runStep(storage: GroupStorage, group: TeamGroup, step: TeamGroupStep) {
    if (
      step.dependsOn.some(
        (id) => group.steps.find((s) => s.memberId === id)?.status !== "completed",
      )
    )
      return;
    const dependencies = group.steps
      .filter((s) => step.dependsOn.includes(s.memberId))
      .map((s) => ({ memberId: s.memberId, result: s.result }));
    const context = dependencies.length
      ? `\n\nCompleted dependencies:\n${JSON.stringify(dependencies)}`
      : "";
    // Never truncate task instructions. Only dependency excerpts are bounded.
    const truncation = "\n[Dependency context truncated; use get_team_tasks for full results.]";
    const budget = 40000 - step.prompt.length;
    const prompt =
      step.prompt +
      (context.length > budget
        ? context.slice(0, budget - truncation.length) + truncation
        : context);
    try {
      await storage.dispatch({
        kind: "send",
        memberId: step.memberId,
        senderId: group.senderId,
        taskId: step.taskIds.at(-1)!,
        groupId: group.id,
        prompt,
      });
    } catch (error) {
      await storage.change((latest) => {
        this.get(latest, group.id).steps.find((s) => s.memberId === step.memberId)!.result =
          String(error);
      });
    }
  }
  private async sync(storage: GroupStorage, groupId: string) {
    await storage.change((team) => {
      const group = this.get(team, groupId);
      for (const step of group.steps) {
        const task = team.tasks.find((t) => t.id === step.taskIds.at(-1));
        if (task) {
          step.status = task.status === "sending" ? "running" : task.status;
          step.result = task.result;
        }
      }
      for (const step of group.steps) {
        if (
          step.status === "queued" &&
          step.dependsOn.some((id) =>
            ["failed", "blocked"].includes(group.steps.find((s) => s.memberId === id)!.status),
          )
        ) {
          step.status = "blocked";
          step.result = "A prerequisite failed; retry that task before continuing.";
        }
      }
      if (group.steps.every((step) => step.status === "completed")) group.status = "completed";
      else if (
        group.steps.every((step) => ["completed", "failed", "blocked"].includes(step.status))
      )
        group.status = "failed";
      else if (group.steps.some((step) => step.status === "uncertain")) group.status = "uncertain";
      else group.status = "running";
      group.updatedAt = new Date().toISOString();
    });
  }
  private async report(storage: GroupStorage, groupId: string) {
    const snapshot = await storage.read();
    const group = this.get(snapshot, groupId);
    if (!ended(group) || group.notification === "delivered" || group.notification === "sending")
      return;
    const captain = snapshot.members.find((m) => m.id === group.captainId);
    if (!captain) return;
    try {
      if ((await this.transport.inspect(captain)).busy) return;
    } catch {
      return;
    }
    await storage.change((team) => {
      this.get(team, groupId).notification = "sending";
    });
    const report: TeamTask = {
      id: group.id,
      groupId: group.id,
      memberId: captain.id,
      senderId: group.senderId,
      prompt: group.prompt,
      status: group.status === "completed" ? "completed" : "failed",
      result: group.steps
        .map(
          (s) =>
            `@${snapshot.members.find((m) => m.id === s.memberId)?.alias ?? s.memberId}: ${s.status}\n${s.result.slice(0, Math.floor(58000 / group.steps.length))}`,
        )
        .join("\n\n"),
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      observedRunning: true,
      notification: "sending",
      notificationId: group.notificationId,
    };
    let delivered = false;
    try {
      await this.transport.notify(captain, report);
      delivered = true;
    } catch {
      /* Retry only this idempotent report, never the work. */
    }
    await storage.change((team) => {
      const latest = this.get(team, groupId);
      if (latest.notificationId === group.notificationId)
        latest.notification = delivered ? "delivered" : "uncertain";
    });
  }
}
