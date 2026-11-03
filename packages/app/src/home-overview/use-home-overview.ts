import { useMemo, useSyncExternalStore } from "react";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { buildHomeSessions } from "./model";

/** Shared directory demand only; never acquire timeline demand for overview rows. */
export function useHomeOverview() {
  const directory = useAggregatedAgents({ includeArchived: false });
  const profiles = useHosts();
  const runtime = getHostRuntimeStore();
  // Subscribe to the values themselves: React Compiler can eliminate a version
  // used only as an invalidation token while memoizing imperative snapshot reads.
  const readFreshness = () =>
    JSON.stringify(
      profiles.map((profile) => {
        const snapshot = runtime.getSnapshot(profile.serverId);
        return [
          snapshot?.connectionStatus === "online",
          snapshot?.agentDirectoryStatus === "ready",
        ];
      }),
    );
  const freshness = useSyncExternalStore(
    (fn) => runtime.subscribeAll(fn),
    readFreshness,
    readFreshness,
  );
  const hosts = useMemo(() => {
    const states = JSON.parse(freshness) as [boolean, boolean][];
    return profiles.map((profile, index) => ({
      serverId: profile.serverId,
      label: profile.label || profile.serverId,
      connected: states[index]![0],
      fresh: states[index]![0] && states[index]![1],
    }));
  }, [profiles, freshness]);
  const sessions = useMemo(
    () => buildHomeSessions(directory.agents, hosts),
    [directory.agents, hosts],
  );
  const attentionCount = sessions.filter(
    (row) =>
      row.state !== "unknown" &&
      (row.agent.requiresAttention || row.state === "waiting" || row.state === "failed"),
  ).length;
  return { ...directory, hosts, sessions, attentionCount };
}
