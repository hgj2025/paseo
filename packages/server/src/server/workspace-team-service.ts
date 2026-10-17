import { WorkspaceTeamGroups, pendingGroup } from "./workspace-team-groups.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  WorkspaceTeamSchema,
  TeamActionSchema,
  type WorkspaceTeam,
  type TeamAction,
  type TeamMember,
  type TeamTask,
} from "@getpaseo/protocol/workspace-team";

export interface TeamTransport {
  inspect(
    member: Pick<TeamMember, "serverId" | "agentId" | "workspaceId">,
  ): Promise<{ provider: string; busy: boolean }>;
  send(member: TeamMember, task: TeamTask): Promise<"acknowledged" | "uncertain">;
  observe(
    member: TeamMember,
    task: TeamTask,
  ): Promise<{
    status: "running" | "permission" | "completed" | "failed" | "uncertain";
    result: string;
  }>;
  notify(captain: TeamMember, task: TeamTask): Promise<void>;
  subscribe?(listener: (event: { serverId: string; agentId?: string }) => void): () => void;
  dispose?(): void;
}

const active = (task: TeamTask) =>
  ["sending", "running", "permission", "uncertain"].includes(task.status);
export const teamTaskMarker = (task: TeamTask) => `[Team task ${task.id}]`;

function assertGroupTask(team: WorkspaceTeam, action: Extract<TeamAction, { kind: "send" }>) {
  if (action.groupId) {
    const group = team.groups?.find((g) => g.id === action.groupId);
    const permitted =
      group &&
      ((group.coordinatorTaskId === action.taskId && group.captainId === action.memberId) ||
        group.steps.some(
          (step) => step.memberId === action.memberId && step.taskIds.at(-1) === action.taskId,
        ));
    if (!permitted) throw new Error("Task is not part of the committed group plan.");
  }
}
function memberHasUnfinishedGroup(team: WorkspaceTeam, memberId: string) {
  return team.groups?.some(
    (g) =>
      (!["completed", "failed"].includes(g.status) || g.notification !== "delivered") &&
      (g.memberIds.includes(memberId) || g.captainId === memberId),
  );
}

/** One writer per daemon; files are private and independent of desktop layout storage. */
export class WorkspaceTeamService {
  private readonly groups: WorkspaceTeamGroups;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly watching = new Map<string, NodeJS.Timeout>();
  private disposed = false;
  private recovery: Promise<void> | undefined;
  private unsubscribe?: () => void;
  private readonly events = new Map<string, NodeJS.Timeout>();
  private readonly refreshing = new Map<string, Promise<void>>();
  private readonly refreshAgain = new Set<string>();
  constructor(
    private readonly home: string,
    readonly serverId: string,
    private readonly transport: TeamTransport,
  ) {
    this.groups = new WorkspaceTeamGroups(home, transport, (workspaceId) => ({
      read: () => this.execute(workspaceId, { kind: "read" }),
      change: (fn) =>
        this.serial(async () => {
          const team = await this.load(workspaceId);
          const result = await fn(team);
          await this.save(team);
          return result;
        }),
      dispatch: (action) => this.dispatch(workspaceId, action),
    }));
    this.unsubscribe = transport.subscribe?.((event) => {
      const key = `${event.serverId}:${event.agentId ?? "*"}`;
      if (this.disposed || this.events.has(key)) return;
      this.events.set(
        key,
        setTimeout(() => {
          this.events.delete(key);
          void this.onChange(event).catch(() => {});
        }, 50).unref(),
      );
    });
  }
  private async onChange(event: { serverId: string; agentId?: string }) {
    if (this.disposed) return;
    for (const team of await this.list()) {
      const members = new Set(
        team.members
          .filter(
            (m) => m.serverId === event.serverId && (!event.agentId || m.agentId === event.agentId),
          )
          .map((m) => m.id),
      );
      const tasks = team.tasks.filter(
        (task) =>
          (members.has(task.memberId) || members.has(team.captainId ?? "")) &&
          (active(task) ||
            task.notification === "pending" ||
            (task.notification === "uncertain" && task.notificationId)),
      );
      await this.refreshBatch(team.workspaceId, tasks);
      await this.groups.advance(team.workspaceId);
      this.watch(team.workspaceId);
    }
  }
  private async refreshBatch(workspaceId: string, tasks: TeamTask[]) {
    for (let i = 0; i < tasks.length && !this.disposed; i += 4)
      await Promise.all(tasks.slice(i, i + 4).map((task) => this.refresh(workspaceId, task.id)));
  }

  private path(workspaceId: string) {
    return join(
      this.home,
      "workspace-teams",
      `${createHash("sha256").update(workspaceId).digest("hex")}.json`,
    );
  }
  private async load(workspaceId: string): Promise<WorkspaceTeam> {
    try {
      return WorkspaceTeamSchema.parse(JSON.parse(await readFile(this.path(workspaceId), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { version: 1, workspaceId, revision: 0, captainId: null, members: [], tasks: [] };
    }
  }
  private async save(team: WorkspaceTeam, configurationChanged = false) {
    if (configurationChanged) team.revision++;
    await mkdir(join(this.home, "workspace-teams"), { recursive: true, mode: 0o700 });
    const path = this.path(team.workspaceId);
    await writeFile(`${path}.tmp`, JSON.stringify(team), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => undefined);
    return next;
  }
  async listForAgent(agentId: string): Promise<WorkspaceTeam[]> {
    const teams = await this.list();
    return teams.filter((team) =>
      team.members.some((m) => m.serverId === this.serverId && m.agentId === agentId),
    );
  }
  private async list(): Promise<WorkspaceTeam[]> {
    let names: string[];
    try {
      names = await readdir(join(this.home, "workspace-teams"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return Promise.all(
      names
        .filter((n) => n.endsWith(".json"))
        .map(async (n) =>
          WorkspaceTeamSchema.parse(
            JSON.parse(await readFile(join(this.home, "workspace-teams", n), "utf8")),
          ),
        ),
    );
  }
  resume(): Promise<void> {
    return (this.recovery ??= this.restore());
  }
  dispose() {
    this.disposed = true;
    for (const timer of this.watching.values()) clearTimeout(timer);
    this.watching.clear();
    this.unsubscribe?.();
    for (const timer of this.events.values()) clearTimeout(timer);
    this.events.clear();
    this.transport.dispose?.();
  }
  private async restore() {
    for (const team of await this.list()) {
      // A crash between dispatch and acknowledgement is never permission to resend.
      await this.serial(async () => {
        const current = await this.load(team.workspaceId);
        let changed = false;
        for (const task of current.tasks) {
          if (task.status === "sending") {
            task.status = "uncertain";
            task.result = "Dispatch was interrupted; inspect the target before retrying.";
            changed = true;
          }
          if (task.notification === "sending") {
            task.notification = "uncertain";
            changed = true;
          }
        }
        for (const group of current.groups ?? []) {
          if (group.notification === "sending") {
            group.notification = "uncertain";
            changed = true;
          }
        }
        if (changed) await this.save(current);
      });
      this.watch(team.workspaceId);
    }
  }
  async execute(workspaceId: string, action: TeamAction): Promise<WorkspaceTeam> {
    await this.recovery;
    action = TeamActionSchema.parse(action);
    if (action.kind === "read") {
      await this.tail;
      return this.load(workspaceId);
    }
    if (action.kind === "refresh") {
      await this.refresh(workspaceId, action.taskId);
      this.watch(workspaceId);
      return this.execute(workspaceId, { kind: "read" });
    }
    if (
      action.kind === "start_group" ||
      action.kind === "plan_group" ||
      action.kind === "retry_group_step" ||
      action.kind === "refresh_group"
    ) {
      if (action.kind === "refresh_group") {
        const snapshot = await this.load(workspaceId);
        await this.refreshBatch(
          workspaceId,
          snapshot.tasks.filter((t) => t.groupId === action.groupId),
        );
      }
      const result = await this.groups.execute(workspaceId, action);
      this.watch(workspaceId);
      return result;
    }
    if (action.kind === "send") return this.dispatch(workspaceId, action);
    // Network calls must never hold the daemon's persistence lock.
    let joinedInfo: Awaited<ReturnType<TeamTransport["inspect"]>> | undefined;
    if (action.kind === "join") {
      const current = await this.execute(workspaceId, { kind: "read" });
      if (
        current.members.some((m) => m.serverId === action.serverId && m.agentId === action.agentId)
      )
        return current;
      joinedInfo = await this.transport.inspect(action);
    }
    return this.serial(async () => {
      const team = await this.load(workspaceId);
      if (action.kind === "join") {
        if (
          team.members.some((m) => m.serverId === action.serverId && m.agentId === action.agentId)
        )
          return team;
        if (team.members.length >= 32) throw new Error("A team can have up to 32 members.");
        const info = joinedInfo!;
        const captain = !team.captainId && action.serverId === this.serverId;
        const base = captain
          ? "Captain"
          : (info.provider.charAt(0).toUpperCase() + info.provider.slice(1))
              .replace(/[^A-Za-z0-9_-]/g, "")
              .slice(0, 24) || "Agent";
        let alias = base,
          suffix = 2;
        while (team.members.some((m) => m.alias.toLowerCase() === alias.toLowerCase()))
          alias = `${base}-${suffix++}`;
        const member: TeamMember = {
          id: randomUUID(),
          alias,
          serverId: action.serverId,
          workspaceId: action.workspaceId,
          agentId: action.agentId,
          provider: info.provider,
          role: captain ? "Coordinate tasks and summarize results" : "",
          skills: [],
        };
        team.members.push(member);
        if (captain) team.captainId = member.id;
      } else {
        if (action.revision !== team.revision)
          throw new Error("Team changed. Reopen the member card and try again.");
        const member = team.members.find((m) => m.id === action.memberId);
        if (!member) throw new Error("Team member not found.");
        if (action.kind === "remove") {
          if (memberHasUnfinishedGroup(team, member.id))
            throw new Error("This member belongs to an unfinished team request.");
          if (team.tasks.some((task) => task.memberId === member.id && active(task)))
            throw new Error("This member still has an active or unconfirmed task.");
          if (team.captainId === member.id)
            throw new Error("Choose another Captain before removing this member.");
          team.members = team.members.filter((m) => m.id !== member.id);
        } else {
          if (
            team.members.some(
              (m) => m.id !== member.id && m.alias.toLowerCase() === action.alias.toLowerCase(),
            )
          )
            throw new Error("This member name is already in use.");
          if (action.captain && member.serverId !== this.serverId)
            throw new Error("Captain must run on the team workspace's host.");
          member.alias = action.alias;
          member.role = action.role;
          member.skills = action.skills;
          if (action.captain) team.captainId = member.id;
        }
      }
      await this.save(team, true);
      return team;
    });
  }
  private async dispatch(
    workspaceId: string,
    action: Extract<TeamAction, { kind: "send" }>,
  ): Promise<WorkspaceTeam> {
    if (!action.prompt.trim()) throw new Error("Enter a task before sending.");
    const snapshot = await this.execute(workspaceId, { kind: "read" });
    const target = snapshot.members.find((member) => member.id === action.memberId);
    if (!target) throw new Error("Team member not found.");
    const info = snapshot.tasks.some((task) => task.id === action.taskId)
      ? null
      : await this.transport.inspect(target);
    const prepared = await this.serial(async () => {
      const team = await this.load(workspaceId);
      const prior = team.tasks.find((task) => task.id === action.taskId);
      if (prior) {
        if (
          prior.memberId !== action.memberId ||
          prior.prompt !== action.prompt ||
          prior.senderId !== action.senderId
        )
          throw new Error("Task ID already belongs to another request.");
        return null;
      }
      // Tombstones outlive the bounded visible history, so an old retry cannot run again.
      const receiptPath = join(this.home, "workspace-team-receipts", action.taskId + ".json");
      const fingerprint = createHash("sha256")
        .update(JSON.stringify([workspaceId, action.memberId, action.senderId, action.prompt]))
        .digest("hex");
      try {
        const saved = JSON.parse(await readFile(receiptPath, "utf8"));
        if (saved.fingerprint !== fingerprint)
          throw new Error("Task ID already belongs to another request.");
        throw new Error(
          "This task was already submitted and is outside recent history. Inspect the target conversation; it will not be resent.",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const member = team.members.find((m) => m.id === action.memberId);
      if (!member) throw new Error("Team member not found.");
      if (action.senderId && !team.members.some((m) => m.id === action.senderId))
        throw new Error("Sender is not a team member.");
      if (team.tasks.some((t) => t.memberId === member.id && active(t)))
        throw new Error("This member already has an active or unconfirmed team task.");
      if (info?.busy)
        throw new Error("This agent is busy. Wait for its current task before dispatching.");
      assertGroupTask(team, action);
      const now = new Date().toISOString();
      const task: TeamTask = {
        id: action.taskId,
        memberId: member.id,
        senderId: action.senderId,
        prompt: action.prompt,
        status: "sending",
        result: "",
        createdAt: now,
        updatedAt: now,
        observedRunning: false,
        notification:
          !action.groupId && team.captainId && team.captainId !== member.id ? "pending" : "none",
        ...(action.groupId ? { groupId: action.groupId } : {}),
      };
      await mkdir(join(this.home, "workspace-team-receipts"), { recursive: true, mode: 0o700 });
      await writeFile(receiptPath, JSON.stringify({ fingerprint }), { mode: 0o600, flag: "wx" });
      team.tasks.push(task);
      // Bound completed history, preserving active and unconfirmed dispatches.
      const finished = new Set(team.tasks.filter((t) => !active(t)).slice(-20));
      team.tasks = team.tasks.filter(
        (t) =>
          active(t) ||
          t.notification === "pending" ||
          t.notification === "sending" ||
          finished.has(t) ||
          Boolean(t.groupId && team.groups?.some((g) => g.id === t.groupId)),
      );
      await this.save(team);
      return { member, task };
    });
    if (!prepared) return this.execute(workspaceId, { kind: "read" });
    let status: "running" | "uncertain" = "uncertain";
    let result = "Dispatch acknowledgement is unknown. Do not resend with a new task ID.";
    try {
      if ((await this.transport.send(prepared.member, prepared.task)) === "acknowledged") {
        status = "running";
        result = "Task delivered.";
      }
    } catch (error) {
      result = `${result} ${String(error)}`;
    }
    await this.serial(async () => {
      const team = await this.load(workspaceId);
      const task = team.tasks.find((t) => t.id === prepared.task.id)!;
      task.status = status;
      task.result = result;
      task.updatedAt = new Date().toISOString();
      await this.save(team);
    });
    this.watch(workspaceId);
    return this.execute(workspaceId, { kind: "read" });
  }
  async refresh(workspaceId: string, taskId: string) {
    const key = `${workspaceId}:${taskId}`;
    const existing = this.refreshing.get(key);
    if (existing) {
      this.refreshAgain.add(key);
      return existing;
    }
    const work = (async () => {
      do {
        this.refreshAgain.delete(key);
        await this.refreshOnce(workspaceId, taskId);
      } while (!this.disposed && this.refreshAgain.has(key));
    })();
    this.refreshing.set(key, work);
    try {
      await work;
    } finally {
      this.refreshing.delete(key);
      this.refreshAgain.delete(key);
    }
  }
  private async refreshOnce(workspaceId: string, taskId: string) {
    const team = await this.execute(workspaceId, { kind: "read" });
    const task = team.tasks.find((t) => t.id === taskId);
    const member = team.members.find((m) => m.id === task?.memberId);
    if (!task || !member || task.status === "sending") return;
    if (active(task)) {
      let observed: Awaited<ReturnType<TeamTransport["observe"]>>;
      try {
        observed = await this.transport.observe(member, task);
      } catch (error) {
        await this.serial(async () => {
          const current = await this.load(workspaceId);
          const latest = current.tasks.find((t) => t.id === taskId)!;
          if (active(latest)) {
            latest.result = `Host unavailable: ${String(error)}`;
            await this.save(current);
          }
        });
        return;
      }
      await this.serial(async () => {
        const current = await this.load(workspaceId);
        const latest = current.tasks.find((t) => t.id === taskId)!;
        if (!active(latest)) return;
        latest.status = observed.status;
        latest.result =
          observed.result.length > 64000
            ? observed.result.slice(0, 64000) +
              "\n[Result truncated; inspect the worker conversation for the complete output.]"
            : observed.result;
        latest.observedRunning ||=
          observed.status === "running" || observed.status === "permission";
        latest.updatedAt = new Date().toISOString();
        await this.save(current);
      });
    }
    if (this.disposed) return;
    const completed = await this.execute(workspaceId, { kind: "read" });
    const captain = completed.members.find((m) => m.id === completed.captainId);
    const candidate = completed.tasks.find((t) => t.id === taskId);
    if (
      !captain ||
      !candidate ||
      !["completed", "failed"].includes(candidate.status) ||
      !(
        candidate.notification === "pending" ||
        (candidate.notification === "uncertain" && candidate.notificationId)
      )
    )
      return;
    try {
      if ((await this.transport.inspect(captain)).busy) return;
    } catch {
      return;
    }
    const notification = await this.serial(async () => {
      const current = await this.load(workspaceId);
      const latest = current.tasks.find((t) => t.id === taskId)!;
      if (
        !["completed", "failed"].includes(latest.status) ||
        !(
          latest.notification === "pending" ||
          (latest.notification === "uncertain" && latest.notificationId)
        )
      )
        return null;
      if (current.captainId !== captain.id) return null;
      latest.notificationId ??= `team-report-${latest.id}`;
      latest.notification = "sending";
      await this.save(current);
      return { captain, task: latest };
    });
    if (notification) {
      let delivered = false;
      try {
        await this.transport.notify(notification.captain, notification.task);
        delivered = true;
      } catch {
        /* An uncertain acknowledgement must not trigger a duplicate turn. */
      }
      await this.serial(async () => {
        const current = await this.load(workspaceId);
        current.tasks.find((t) => t.id === taskId)!.notification = delivered
          ? "delivered"
          : "uncertain";
        await this.save(current);
      });
    }
  }
  private watch(workspaceId: string) {
    if (this.disposed || this.watching.has(workspaceId)) return;
    const tick = async () => {
      if (this.disposed) return;
      try {
        const team = await this.execute(workspaceId, { kind: "read" });
        const pending = team.tasks.filter(
          (t) =>
            ["running", "permission", "uncertain"].includes(t.status) ||
            (!active(t) &&
              (t.notification === "pending" ||
                (t.notification === "uncertain" && Boolean(t.notificationId)))),
        );
        await this.groups.advance(workspaceId);
        const after = await this.load(workspaceId);
        if (!pending.length && !after.groups?.some(pendingGroup)) {
          this.watching.delete(workspaceId);
          return;
        }
        await this.refreshBatch(workspaceId, pending);
        await this.groups.advance(workspaceId);
      } catch {
        /* Keep persisted tasks available while the host reconnects. */
      }
      if (!this.disposed)
        this.watching.set(
          workspaceId,
          setTimeout(() => void tick(), this.transport.subscribe ? 30_000 : 5000).unref(),
        );
    };
    this.watching.set(
      workspaceId,
      setTimeout(() => void tick(), this.transport.subscribe ? 100 : 2000).unref(),
    );
  }
}
