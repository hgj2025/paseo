import { WorkspaceTeamGroups, pendingGroup } from "./workspace-team-groups.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import {
  WorkspaceTeamSchema,
  executionMember,
  memberExecutions,
  teamStorageKey,
  TeamActionSchema,
  type WorkspaceTeam,
  type TeamAction,
  type TeamMember,
  type TeamTask,
} from "@getpaseo/protocol/workspace-team";

export interface TeamTransport {
  inspect(
    member: Pick<TeamMember, "serverId" | "agentId" | "workspaceId">,
  ): Promise<{ provider: string; busy: boolean; historyEpoch?: string; historySeq?: number }>;
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
  archive?(member: TeamMember): Promise<void>;
  isArchived?(member: TeamMember): Promise<boolean>;
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
async function assertUnusedReceipt(receiptPath: string, fingerprint: string) {
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
}
function retainTaskHistory(team: WorkspaceTeam) {
  const finished = new Set(
    team.sessionId ? team.tasks : team.tasks.filter((t) => !active(t)).slice(-20),
  );
  team.tasks = team.tasks.filter(
    (t) =>
      active(t) ||
      t.notification === "pending" ||
      t.notification === "sending" ||
      finished.has(t) ||
      Boolean(t.groupId && team.groups?.some((g) => g.id === t.groupId)),
  );
}
function canNotifyTask(task: TeamTask) {
  return (
    ["completed", "failed"].includes(task.status) &&
    (task.notification === "pending" ||
      (task.notification === "uncertain" && Boolean(task.notificationId)))
  );
}
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
          if (team.status && team.status !== "active")
            throw new Error("Conversation is no longer active.");
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
      if (team.status === "ended" || team.status === "ending") continue;
      const captain = team.members.find((m) => m.id === team.captainId);
      if (team.sessionId && captain && (await this.transport.isArchived?.(captain))) {
        await this.endSession(teamStorageKey(team));
        continue;
      }
      const members = new Set(
        team.members
          .filter(
            (m) =>
              executionMember(m).serverId === event.serverId &&
              (!event.agentId || executionMember(m).agentId === event.agentId),
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
      await this.refreshBatch(teamStorageKey(team), tasks);
      await this.groups.advance(teamStorageKey(team));
      this.watch(teamStorageKey(team));
    }
  }
  private async refreshBatch(workspaceId: string, tasks: TeamTask[]) {
    for (let i = 0; i < tasks.length && !this.disposed; i += 4)
      await Promise.all(tasks.slice(i, i + 4).map((task) => this.refresh(workspaceId, task.id)));
  }

  private path(workspaceId: string) {
    return join(
      this.home,
      workspaceId.includes("::session::") ? "conversation-teams" : "workspace-teams",
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
    const path = this.path(teamStorageKey(team));
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
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
    const matches = teams.filter((team) =>
      team.members.some(
        (m) =>
          (m.serverId === this.serverId && m.agentId === agentId) ||
          (executionMember(m).serverId === this.serverId && executionMember(m).agentId === agentId),
      ),
    );
    const scoped = matches.filter((team) => team.sessionId && team.status !== "ended");
    return scoped.length ? scoped : matches;
  }
  private async list(): Promise<WorkspaceTeam[]> {
    const directories = ["workspace-teams", "conversation-teams"];
    const records = await Promise.all(
      directories.map(async (directory) => {
        let names: string[];
        try {
          names = await readdir(join(this.home, directory));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
          throw error;
        }
        return Promise.all(
          names
            .filter((n) => n.endsWith(".json"))
            .map(async (n) =>
              WorkspaceTeamSchema.parse(
                JSON.parse(await readFile(join(this.home, directory, n), "utf8")),
              ),
            ),
        );
      }),
    );
    return records.flat();
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
      if (team.status === "ended" || team.status === "ending") continue;
      const captain = team.members.find((m) => m.id === team.captainId);
      if (team.sessionId && captain && (await this.transport.isArchived?.(captain))) {
        await this.endSession(teamStorageKey(team));
        continue;
      }
      // A crash between dispatch and acknowledgement is never permission to resend.
      await this.serial(async () => {
        const current = await this.load(teamStorageKey(team));
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
      this.watch(teamStorageKey(team));
    }
  }
  async listSessions(workspaceId: string): Promise<WorkspaceTeam[]> {
    await this.tail;
    return (await this.list()).filter((team) => team.workspaceId === workspaceId && team.sessionId);
  }
  async executeSession(
    workspaceId: string,
    sessionId: string,
    action: TeamAction,
  ): Promise<WorkspaceTeam> {
    const key = teamStorageKey({ workspaceId, sessionId });
    await this.serial(async () => {
      const existing = await this.load(key);
      if (!existing.sessionId) {
        await this.save({ ...existing, workspaceId, sessionId, status: "active" });
      }
    });
    return this.execute(key, action);
  }
  private async endSession(key: string): Promise<WorkspaceTeam> {
    const team = await this.serial(async () => {
      const current = await this.load(key);
      if (!current.sessionId) throw new Error("Only conversation teams can be ended.");
      if (current.status === "ended") return current;
      current.status = "ending";
      await this.save(current, true);
      return current;
    });
    if (team.status === "ended") return team;
    const errors: Record<string, string> = {};
    // Only sessions created for this team are archived; attached sessions stay independent.
    for (const member of [...team.members].sort(
      (a, b) => Number(a.id === team.captainId) - Number(b.id === team.captainId),
    )) {
      if (!member.owned) continue;
      try {
        if (!this.transport.archive)
          throw new Error("Host does not support team session archival.");
        await this.archiveMemberExecutions(member);
      } catch (error) {
        errors[member.id] = String(error);
      }
    }
    return this.serial(async () => {
      const current = await this.load(key);
      current.archiveErrors = errors;
      if (!Object.keys(errors).length) {
        current.status = "ended";
        current.endedAt = new Date().toISOString();
        for (const task of current.tasks) {
          if (active(task)) {
            task.status = "failed";
            task.result = "Conversation ended.";
          }
          task.notification = "none";
        }
        for (const group of current.groups ?? []) {
          if (pendingGroup(group)) {
            group.status = "failed";
            group.result = "Conversation ended.";
          }
          group.notification = "delivered";
        }
      }
      await this.save(current, true);
      return current;
    });
  }
  private async removeSessionMember(
    key: string,
    action: Extract<TeamAction, { kind: "remove" }>,
  ): Promise<WorkspaceTeam> {
    const retiring = await this.serial(async () => {
      const team = await this.load(key);
      if (team.status !== "active") throw new Error("Conversation is no longer active.");
      if (action.revision !== team.revision)
        throw new Error("Team changed. Reopen the member card and try again.");
      const member = team.members.find((m) => m.id === action.memberId);
      if (!member) throw new Error("Team member not found.");
      if (member.id === team.captainId) throw new Error("End the conversation to remove Captain.");
      if (
        memberHasUnfinishedGroup(team, member.id) ||
        team.tasks.some((t) => t.memberId === member.id && active(t))
      )
        throw new Error(
          "This member still has unfinished team work. Finish it or end the conversation.",
        );
      member.removing = true;
      await this.save(team);
      return member;
    });
    if (retiring.owned) {
      if (!this.transport.archive) throw new Error("Host does not support member archival.");
      await this.archiveMemberExecutions(retiring);
    }
    return this.serial(async () => {
      const team = await this.load(key);
      if (team.status !== "active") return team;
      const current = team.members.find((m) => m.id === retiring.id);
      if (current) {
        (team.retiredMembers ??= []).push(current);
        team.members = team.members.filter((m) => m.id !== retiring.id);
        await this.save(team, true);
      }
      return team;
    });
  }
  private async validateJoin(team: WorkspaceTeam, action: Extract<TeamAction, { kind: "join" }>) {
    if (team.sessionId) {
      if (!team.captainId && action.serverId !== this.serverId)
        throw new Error("Create Captain on the conversation host first.");
      if (!action.paneId) throw new Error("A conversation member requires a pane.");
      if (
        team.members.some(
          (m) =>
            m.paneId === action.paneId &&
            (m.agentId !== action.agentId || m.serverId !== action.serverId),
        )
      )
        throw new Error("This pane already belongs to another member.");
      const other = (await this.list()).find(
        (t) =>
          t.sessionId &&
          t.sessionId !== team.sessionId &&
          t.status !== "ended" &&
          t.members.some((m) =>
            memberExecutions(m).some(
              (e) => e.agentId === action.agentId && e.serverId === action.serverId,
            ),
          ),
      );
      if (other) throw new Error("This agent already belongs to another conversation.");
    }
  }
  private updateMember(
    team: WorkspaceTeam,
    action: Extract<TeamAction, { kind: "remove" | "edit" }>,
  ) {
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
      if (team.sessionId) (team.retiredMembers ??= []).push(member);
      team.members = team.members.filter((m) => m.id !== member.id);
    } else {
      if (
        team.members.some(
          (m) => m.id !== member.id && m.alias.toLowerCase() === action.alias.toLowerCase(),
        )
      )
        throw new Error("This member name is already in use.");
      if (team.sessionId && action.captain && member.id !== team.captainId)
        throw new Error("The main conversation remains Captain.");
      if (action.captain && member.serverId !== this.serverId)
        throw new Error("Captain must run on the team workspace's host.");
      member.alias = action.alias;
      member.role = action.role;
      member.skills = action.skills;
      if (action.captain) team.captainId = member.id;
    }
  }
  async execute(workspaceId: string, action: TeamAction): Promise<WorkspaceTeam> {
    await this.recovery;
    action = TeamActionSchema.parse(action);
    if (action.kind === "read") {
      await this.tail;
      return this.load(workspaceId);
    }
    if (action.kind === "end") return this.endSession(workspaceId);
    const session = await this.load(workspaceId);
    if (session.status && session.status !== "active")
      throw new Error("Conversation has ended or is ending; its history is read-only.");
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
    if (action.kind === "configure_execution") return this.configureExecution(workspaceId, action);
    if (action.kind === "send") return this.dispatch(workspaceId, action);
    if (action.kind === "remove" && session.sessionId)
      return this.removeSessionMember(workspaceId, action);
    // Network calls must never hold the daemon's persistence lock.
    let joinedInfo: Awaited<ReturnType<TeamTransport["inspect"]>> | undefined;
    if (action.kind === "join") {
      const current = await this.execute(workspaceId, { kind: "read" });
      if (
        current.members.some((m) =>
          memberExecutions(m).some(
            (e) => e.serverId === action.serverId && e.agentId === action.agentId,
          ),
        )
      ) {
        const member = current.members.find((m) =>
          memberExecutions(m).some(
            (e) => e.serverId === action.serverId && e.agentId === action.agentId,
          ),
        )!;
        if (current.sessionId && member.paneId !== action.paneId)
          throw new Error("This member already owns another pane.");
        return current;
      }
      joinedInfo = await this.transport.inspect(action);
    }
    return this.serial(async () => {
      const team = await this.load(workspaceId);
      if (team.status && team.status !== "active")
        throw new Error("Conversation is no longer active.");
      if (action.kind === "join") {
        await this.validateJoin(team, action);
        if (
          team.members.some((m) =>
            memberExecutions(m).some(
              (e) => e.serverId === action.serverId && e.agentId === action.agentId,
            ),
          )
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
          ...(action.paneId ? { paneId: action.paneId, owned: action.owned === true } : {}),
        };
        team.members.push(member);
        if (captain) team.captainId = member.id;
      } else {
        this.updateMember(team, action);
      }
      await this.save(team, true);
      return team;
    });
  }
  private async archiveMemberExecutions(member: TeamMember) {
    if (!this.transport.archive) throw new Error("Host does not support session archival.");
    const results = await Promise.allSettled(
      memberExecutions(member).map((execution) =>
        this.transport.archive!({ ...member, ...execution }),
      ),
    );
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failures.length) throw new Error(failures.map((r) => String(r.reason)).join("; "));
  }
  private async configureExecution(
    key: string,
    action: Extract<TeamAction, { kind: "configure_execution" }>,
  ): Promise<WorkspaceTeam> {
    const snapshot = await this.execute(key, { kind: "read" });
    const original = snapshot.members.find((m) => m.id === action.memberId);
    if (!snapshot.sessionId || !original) throw new Error("Conversation member not found.");
    if (original.id === snapshot.captainId && action.execution.serverId !== this.serverId)
      throw new Error(
        "Captain execution must remain on the team host until remote team tools are supported.",
      );
    const previous = original.execution;
    if (previous?.operationId === action.execution.operationId) {
      if (JSON.stringify(previous) !== JSON.stringify(action.execution))
        throw new Error("Execution request ID already belongs to another configuration.");
      return snapshot;
    }
    this.assertExecutionChange(snapshot, original, action.revision);
    const target = await this.transport.inspect(action.execution);
    if (target.busy) throw new Error("The selected executor is busy.");
    if (target.provider !== action.execution.provider)
      throw new Error("Executor provider mismatch.");
    const current = await this.transport.inspect(executionMember(original));
    if (
      action.sourceCursor &&
      (current.historyEpoch !== action.sourceCursor.epoch ||
        current.historySeq !== action.sourceCursor.seq)
    )
      throw new Error(
        "Conversation history changed; execution has not been switched. Reopen the model panel and retry.",
      );
    if (current.busy)
      throw new Error(
        "Wait for the current turn and permissions to finish before switching execution.",
      );
    return this.serial(async () => {
      const team = await this.load(key);
      const member = team.members.find((m) => m.id === action.memberId);
      if (!member) throw new Error("Conversation member no longer exists.");
      this.assertExecutionChange(team, member, action.revision);
      // A runner cannot silently become another conversation's executor.
      for (const other of await this.list()) {
        if (other.status === "ended") continue;
        if (
          other.members.some(
            (m) =>
              !(other.sessionId === team.sessionId && m.id === member.id) &&
              memberExecutions(m).some(
                (e) =>
                  e.serverId === action.execution.serverId &&
                  e.agentId === action.execution.agentId,
              ),
          )
        )
          throw new Error("Executor already belongs to another conversation.");
      }
      const prior = member.execution ?? {
        serverId: member.serverId,
        workspaceId: member.workspaceId,
        agentId: member.agentId,
        provider: member.provider,
      };
      const history = member.executionHistory ?? [];
      if (!history.some((e) => e.serverId === prior.serverId && e.agentId === prior.agentId))
        member.executionHistory = [...history, prior];
      member.execution = action.execution;
      await this.save(team, true);
      return team;
    });
  }
  private assertExecutionChange(team: WorkspaceTeam, member: TeamMember, revision: number) {
    if (team.status !== "active" || member.removing)
      throw new Error("Conversation is not available for execution changes.");
    if (team.revision !== revision)
      throw new Error("Team changed; reopen the model panel and retry.");
    if (
      memberHasUnfinishedGroup(team, member.id) ||
      team.tasks.some((task) => task.memberId === member.id && active(task)) ||
      (member.id === team.captainId &&
        team.tasks.some((task) => ["pending", "sending", "uncertain"].includes(task.notification)))
    )
      throw new Error("Wait for active tasks and reports to finish before switching execution.");
  }
  private async dispatch(
    workspaceId: string,
    action: Extract<TeamAction, { kind: "send" }>,
  ): Promise<WorkspaceTeam> {
    if (!action.prompt.trim()) throw new Error("Enter a task before sending.");
    const snapshot = await this.execute(workspaceId, { kind: "read" });
    const target = snapshot.members.find((member) => member.id === action.memberId);
    if (!target) throw new Error("Team member not found.");
    if (target.removing)
      throw new Error("Member removal is pending; retry removal instead of dispatching work.");
    const info = snapshot.tasks.some((task) => task.id === action.taskId)
      ? null
      : await this.transport.inspect(executionMember(target));
    const prepared = await this.serial(async () => {
      const team = await this.load(workspaceId);
      if (team.status && team.status !== "active")
        throw new Error("Conversation is no longer active.");
      if (team.members.find((m) => m.id === action.memberId)?.removing)
        throw new Error("Member removal is pending.");
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
      await assertUnusedReceipt(receiptPath, fingerprint);
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
      retainTaskHistory(team);
      await this.save(team);
      return { member, task };
    });
    if (!prepared) return this.execute(workspaceId, { kind: "read" });
    let status: "running" | "uncertain" = "uncertain";
    let result = "Dispatch acknowledgement is unknown. Do not resend with a new task ID.";
    try {
      if (
        (await this.transport.send(executionMember(prepared.member), prepared.task)) ===
        "acknowledged"
      ) {
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
    if (team.status && team.status !== "active") return;
    const task = team.tasks.find((t) => t.id === taskId);
    const member = team.members.find((m) => m.id === task?.memberId);
    if (!task || !member || task.status === "sending") return;
    if (active(task)) {
      let observed: Awaited<ReturnType<TeamTransport["observe"]>>;
      try {
        observed = await this.transport.observe(executionMember(member), task);
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
      (completed.status && completed.status !== "active") ||
      !captain ||
      !candidate ||
      !canNotifyTask(candidate)
    )
      return;
    try {
      if ((await this.transport.inspect(executionMember(captain))).busy) return;
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
        await this.transport.notify(executionMember(notification.captain), notification.task);
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
        if (team.status && team.status !== "active") {
          this.watching.delete(workspaceId);
          return;
        }
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
