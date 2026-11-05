import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";

export type HomeStatus =
  | "waiting"
  | "failed"
  | "running"
  | "starting"
  | "finished"
  | "attention"
  | "idle"
  | "unknown";
export interface HomeHost {
  serverId: string;
  label: string;
  fresh: boolean;
  connected: boolean;
}
export interface HomeSession {
  agent: AggregatedAgent;
  state: HomeStatus;
  active: boolean;
}
const priority: Record<HomeStatus, number> = {
  waiting: 0,
  failed: 1,
  attention: 2,
  finished: 3,
  running: 4,
  starting: 5,
  unknown: 6,
  idle: 7,
};
export function homeSessionState(agent: AggregatedAgent, fresh: boolean): HomeStatus {
  if (!fresh) return "unknown";
  if ((agent.pendingPermissionCount ?? 0) > 0 || agent.attentionReason === "permission")
    return "waiting";
  if (agent.status === "error" || agent.attentionReason === "error") return "failed";
  if (agent.status === "running" || agent.turn.phase === "open") return "running";
  if (agent.status === "initializing") return "starting";
  if (agent.attentionReason === "finished") return "finished";
  if (agent.requiresAttention) return "attention";
  return "idle";
}
export function buildHomeSessions(
  agents: readonly AggregatedAgent[],
  hosts: readonly HomeHost[],
): HomeSession[] {
  const hostById = new Map(hosts.map((host) => [host.serverId, host]));
  const unique = new Map<string, HomeSession>();
  for (const agent of agents) {
    const host = hostById.get(agent.serverId);
    // Executors belong to an existing conversation anchor; preparing/retrying a
    // host change must not manufacture extra user-visible sessions.
    if (!host || agent.archivedAt || agent.labels["paseo.conversation.executor"]) continue;
    const state = homeSessionState(agent, host.fresh);
    const active =
      state === "unknown"
        ? agent.status === "running" ||
          agent.status === "initializing" ||
          agent.status === "error" ||
          agent.turn.phase === "open" ||
          Boolean(agent.requiresAttention) ||
          (agent.pendingPermissionCount ?? 0) > 0
        : state !== "idle" && (state !== "finished" || Boolean(agent.requiresAttention));
    unique.set(JSON.stringify([agent.serverId, agent.id]), { agent, state, active });
  }
  return Array.from(unique.values()).sort(
    (a, b) =>
      priority[a.state] - priority[b.state] ||
      b.agent.lastActivityAt.getTime() - a.agent.lastActivityAt.getTime(),
  );
}

/** Calendar day in the viewer's local timezone; status changes never reorder existing rows. */
export function todaySessions(
  sessions: readonly HomeSession[],
  now: Date,
  previousKeys: readonly string[] = [],
): HomeSession[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const key = (row: HomeSession) => JSON.stringify([row.agent.serverId, row.agent.id]);
  const ranks = new Map(previousKeys.map((value, index) => [value, index]));
  return sessions
    .filter((row) => {
      const time = row.agent.lastActivityAt.getTime();
      return time >= start && time < end;
    })
    .sort((a, b) => {
      const ar = ranks.get(key(a)),
        br = ranks.get(key(b));
      if (ar !== undefined || br !== undefined) return (ar ?? Infinity) - (br ?? Infinity);
      return (
        b.agent.lastActivityAt.getTime() - a.agent.lastActivityAt.getTime() ||
        key(a).localeCompare(key(b))
      );
    });
}

export const SESSION_STATUS_TABS = ["running", "waiting", "finished", "failed"] as const;
export type SessionStatusTab = (typeof SESSION_STATUS_TABS)[number];
export function matchesSessionStatus(row: HomeSession, tab: SessionStatusTab): boolean {
  switch (tab) {
    case "running":
      return row.state === "running" || row.state === "starting";
    case "waiting":
      return row.state === "waiting" || row.state === "attention";
    case "finished":
      return row.state === "finished";
    case "failed":
      return row.state === "failed";
  }
}
