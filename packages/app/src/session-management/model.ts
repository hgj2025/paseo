import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";

export const DAY_MS = 86_400_000;
export interface ArchiveRule {
  enabled: boolean;
  olderThanDays: number;
  provider: string;
  directory: string;
}
export const DEFAULT_ARCHIVE_RULE: ArchiveRule = {
  enabled: false,
  olderThanDays: 30,
  provider: "",
  directory: "",
};
export type HistoryFilter = "all" | "unarchived" | "archived";
export function agentKey(agent: Pick<AggregatedAgent, "serverId" | "id">): string {
  return JSON.stringify([agent.serverId, agent.id]);
}
export function isWithinDirectory(cwd: string, directory: string): boolean {
  const root = directory.replace(/\/+$/, "") || "/";
  return cwd === root || cwd.startsWith(root === "/" ? root : `${root}/`);
}
export function matchesArchiveRule(
  agent: AggregatedAgent,
  rule: ArchiveRule,
  now: number,
): boolean {
  const timestamp = agent.lastActivityAt.getTime();
  return (
    Number.isFinite(timestamp) &&
    timestamp > 0 &&
    timestamp <= now - rule.olderThanDays * DAY_MS &&
    (!rule.provider || agent.provider === rule.provider) &&
    (!rule.directory || isWithinDirectory(agent.cwd, rule.directory))
  );
}
/** Never interrupt work or cascade a parent archive into other sessions. */
export function canArchive(
  agent: AggregatedAgent,
  parents: ReadonlySet<string>,
  manual = false,
): boolean {
  return (
    !agent.archivedAt &&
    (agent.status === "idle" || agent.status === "closed") &&
    agent.turn.phase === "idle" &&
    !agent.pendingPermissionCount &&
    (!agent.requiresAttention || (manual && agent.attentionReason === "finished")) &&
    !parents.has(agent.id) &&
    !agent.labels["paseo.parent-agent-id"]
  );
}
export function parentAgentIds(agents: readonly AggregatedAgent[]): Set<string> {
  return new Set(
    agents
      .filter((a) => !a.archivedAt)
      .flatMap((a) => {
        const id = a.labels["paseo.parent-agent-id"];
        return id ? [id] : [];
      }),
  );
}
export function filterHistory(
  agents: readonly AggregatedAgent[],
  input: {
    archive: HistoryFilter;
    provider: string;
    directory: string;
  },
): AggregatedAgent[] {
  return agents.filter(
    (a) =>
      (input.archive === "all" || Boolean(a.archivedAt) === (input.archive === "archived")) &&
      (!input.provider || a.provider === input.provider) &&
      (!input.directory || isWithinDirectory(a.cwd, input.directory)),
  );
}

export function nextArchiveAt(report?: {
  at: number;
  error: string | null;
  failed: number;
}): number {
  if (!report) return 0;
  return report.at + (report.error || report.failed ? 3_600_000 : DAY_MS);
}
