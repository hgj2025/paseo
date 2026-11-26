import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { fetchAgentHistoryPage } from "@/hooks/use-agent-history";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { canArchive, matchesArchiveRule, type ArchiveRule } from "./model";

export async function loadHostHistory(
  client: Pick<DaemonClient, "fetchAgentHistory">,
  serverId: string,
): Promise<AggregatedAgent[]> {
  const agents = new Map<string, AggregatedAgent>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await fetchAgentHistoryPage({ client, serverId, cursor });
    for (const agent of page.agents) agents.set(agent.id, agent);
    if (!page.pageInfo.hasMore) return [...agents.values()];
    cursor = page.pageInfo.nextCursor;
    if (!cursor || cursors.has(cursor)) throw new Error("History pagination did not complete");
    cursors.add(cursor);
  } while (cursors.size < 1000);
  throw new Error("History is too large; narrow the host before retrying");
}
export interface ArchiveResult {
  archived: number;
  skipped: number;
  failed: number;
}
export async function archiveCandidates(input: {
  client: Pick<DaemonClient, "fetchAgent" | "archiveAgent">;
  serverId: string;
  candidates: readonly AggregatedAgent[];
  parents: ReadonlySet<string>;
  protectedIds: () => ReadonlySet<string>;
  rule?: ArchiveRule;
  manual?: boolean;
  shouldContinue?: () => boolean;
}): Promise<ArchiveResult> {
  const result: ArchiveResult = { archived: 0, skipped: 0, failed: 0 };
  for (const candidate of input.candidates) {
    if (input.shouldContinue && !input.shouldContinue()) break;
    try {
      // Re-read metadata immediately before mutating: a preview may have gone stale.
      const entry = await input.client.fetchAgent(candidate.id);
      if (!entry) {
        result.skipped++;
        continue;
      }
      const normalized = normalizeAgentSnapshot(entry.agent, input.serverId);
      const fresh: AggregatedAgent = {
        ...normalized,
        serverLabel: input.serverId,
        pendingPermissionCount: normalized.pendingPermissions.length,
      };
      const protectedIds = input.protectedIds();
      if (
        !canArchive(fresh, input.parents, input.manual) ||
        protectedIds.has(fresh.id) ||
        (input.rule && !matchesArchiveRule(fresh, input.rule, Date.now()))
      ) {
        result.skipped++;
        continue;
      }
      if (input.shouldContinue && !input.shouldContinue()) break;
      await input.client.archiveAgent(fresh.id);
      result.archived++;
    } catch {
      result.failed++;
    }
  }
  return result;
}
