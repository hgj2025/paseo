import { useEffect } from "react";
import { AppState } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { getHostRuntimeStore, isHostRuntimeConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import {
  observeOpenWorkspaceAgentIds,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { agentHistoryQueryKey, allAgentHistoryQueryRootKey } from "@/hooks/agent-history-query-key";
import { DAY_MS, matchesArchiveRule, parentAgentIds, canArchive, nextArchiveAt } from "./model";
import { archiveCandidates, loadHostHistory } from "./service";
import { useArchiveRules } from "./store";

const busyHosts = new Set<string>();
export async function withArchiveLock<T>(serverId: string, run: () => Promise<T>): Promise<T> {
  if (busyHosts.has(serverId))
    throw new Error("An archive operation is already running for this host");
  busyHosts.add(serverId);
  try {
    return await run();
  } finally {
    busyHosts.delete(serverId);
  }
}
export function getProtectedAgentIds(
  serverId: string,
  candidates: readonly { id: string; workspaceId?: string }[] = [],
  protectOpenTabs = true,
): Set<string> {
  const protectedIds = new Set<string>();
  if (protectOpenTabs) {
    const release = observeOpenWorkspaceAgentIds(serverId, (ids) =>
      ids.forEach((id) => protectedIds.add(id)),
    );
    release();
    for (const [key, ids] of Object.entries(
      useWorkspaceLayoutStore.getState().pinnedAgentIdsByWorkspace,
    )) {
      if (key.startsWith(`${serverId}:`)) for (const id of ids) protectedIds.add(id);
    }
  }
  const session = useSessionStore.getState().sessions[serverId];
  if (!session?.hasHydratedWorkspaces)
    throw new Error("Workspace metadata is not ready; retry after the host finishes syncing");
  for (const agent of [...session.agents.values(), ...candidates]) {
    const workspace = agent.workspaceId ? session?.workspaces?.get(agent.workspaceId) : null;
    if (workspace?.pinnedAt || (agent.workspaceId && !workspace)) protectedIds.add(agent.id);
  }
  return protectedIds;
}
export function useInvalidateHistory() {
  const queryClient = useQueryClient();
  return (serverId: string) => {
    for (const queryKey of [
      agentHistoryQueryKey(serverId),
      allAgentHistoryQueryRootKey(),
      ["sidebarAgentsList", serverId],
      ["allAgents", serverId],
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };
}
/** One due-time timer; no directory demand, transcript reads or per-session polling. */
export function SessionArchiveCoordinator() {
  const rules = useArchiveRules((s) => s.rules);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!Object.values(rules).some((rule) => rule.enabled)) return;
    const runtime = getHostRuntimeStore();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    const tick = async () => {
      if (stopped || running || AppState.currentState !== "active") return;
      if (
        !useArchiveRules.persist.hasHydrated() ||
        !useWorkspaceLayoutStore.persist.hasHydrated()
      ) {
        timer = setTimeout(() => void tick(), 1000);
        return;
      }
      running = true;
      let nextDelay = DAY_MS;
      try {
        for (const [serverId, rule] of Object.entries(rules)) {
          if (stopped || !rule.enabled) continue;
          const report = useArchiveRules.getState().reports[serverId];
          const due = nextArchiveAt(report);
          if (due > Date.now()) {
            nextDelay = Math.min(nextDelay, due - Date.now());
            continue;
          }
          const client = runtime.getClient(serverId);
          if (!client || !isHostRuntimeConnected(runtime.getSnapshot(serverId))) {
            nextDelay = Math.min(nextDelay, 300_000);
            continue;
          }
          try {
            await withArchiveLock(serverId, async () => {
              const agents = await loadHostHistory(client, serverId);
              const parents = parentAgentIds(agents);
              const candidates = agents.filter(
                (agent) =>
                  canArchive(agent, parents) && matchesArchiveRule(agent, rule, Date.now()),
              );
              const result = await archiveCandidates({
                client,
                serverId,
                candidates,
                parents,
                rule,
                protectedIds: () => getProtectedAgentIds(serverId, agents),
                shouldContinue: () => !stopped && AppState.currentState === "active",
              });
              if (stopped || AppState.currentState !== "active") {
                nextDelay = Math.min(nextDelay, 300_000);
                return;
              }
              if (result.failed) nextDelay = Math.min(nextDelay, 3_600_000);
              useArchiveRules
                .getState()
                .report(serverId, { ...result, at: Date.now(), error: null });
              void queryClient.invalidateQueries({ queryKey: agentHistoryQueryKey(serverId) });
              void queryClient.invalidateQueries({ queryKey: allAgentHistoryQueryRootKey() });
            });
          } catch (error) {
            if (!stopped)
              useArchiveRules.getState().report(serverId, {
                at: Date.now(),
                archived: 0,
                skipped: 0,
                failed: 0,
                error: error instanceof Error ? error.message : String(error),
              });
            nextDelay = Math.min(nextDelay, 3_600_000);
          }
        }
      } finally {
        running = false;
        if (!stopped) timer = setTimeout(() => void tick(), Math.max(1000, nextDelay));
      }
    };
    const wake = () => {
      if (running || stopped) return;
      clearTimeout(timer);
      timer = setTimeout(() => void tick(), 1000);
    };
    const unsubscribe = runtime.subscribeHostList(wake);
    const appSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") wake();
    });
    wake();
    return () => {
      stopped = true;
      clearTimeout(timer);
      unsubscribe();
      appSubscription.remove();
    };
  }, [rules, queryClient]);
  return null;
}
