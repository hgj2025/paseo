import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WorkspaceTeam } from "@getpaseo/protocol/workspace-team";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useFetchQueries } from "@/data/query";
import { useHostFeatureMap } from "@/runtime/host-features";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { conversationTarget } from "@/stores/conversation-layout";
import type { ConversationGroup, HomeHost } from "./model";

const rosterKey = (serverId: string, workspaceId: string) => [
  "overview-conversations",
  serverId,
  workspaceId,
];

/** Reuse the existing roster RPC/cache; never subscribe to member transcripts. */
export function useConversationGroups(
  agents: readonly AggregatedAgent[],
  hosts: readonly HomeHost[],
) {
  const layouts = useWorkspaceLayoutStore((state) => state.conversationsByWorkspace);
  const hostIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const features = useHostFeatureMap(hostIds, "sessionTeams");
  const runtime = getHostRuntimeStore();
  const queryClient = useQueryClient();
  const scopes = useMemo(() => {
    const result = new Map<string, { serverId: string; workspaceId: string }>();
    for (const agent of agents) {
      if (!agent.workspaceId || agent.archivedAt || !features.get(agent.serverId)) continue;
      result.set(JSON.stringify([agent.serverId, agent.workspaceId]), {
        serverId: agent.serverId,
        workspaceId: agent.workspaceId,
      });
    }
    return Array.from(result.values());
  }, [agents, features]);
  const queries = useFetchQueries<WorkspaceTeam[]>(
    scopes.map((scope) => ({
      queryKey: rosterKey(scope.serverId, scope.workspaceId),
      dataShape: "list",
      staleTimeMs: 30_000,
      enabled: hosts.some((host) => host.serverId === scope.serverId && host.fresh),
      queryFn: () =>
        runtime.getSnapshot(scope.serverId)!.client!.workspaceConversations(scope.workspaceId),
      retry: false,
    })),
  );
  // The open conversation's shared team cache receives joins/execution changes immediately.
  // Fold those updates into the directory cache instead of adding a second polling loop.
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        const [kind, serverId, workspaceId] = event.query.queryKey;
        if (
          kind !== "workspace-team" ||
          event.type !== "updated" ||
          event.action.type !== "success"
        )
          return;
        const team = event.query.state.data as WorkspaceTeam | undefined;
        if (!team?.sessionId || typeof serverId !== "string" || typeof workspaceId !== "string")
          return;
        const key = rosterKey(serverId, workspaceId);
        const previous = queryClient.getQueryData<WorkspaceTeam[]>(key) ?? [];
        queryClient.setQueryData(key, [
          ...previous.filter((entry) => entry.sessionId !== team.sessionId),
          team,
        ]);
      }),
    [queryClient],
  );
  const result = new Map<string, ConversationGroup>();
  for (const [workspaceKey, entries] of Object.entries(layouts)) {
    const owner = workspaceKey.slice(0, workspaceKey.indexOf(":"));
    for (const entry of Object.values(entries)) {
      if (entry.endedAt) continue;
      const tabs = collectAllTabs(entry.layout.root);
      const targets = tabs.flatMap((tab) => {
        const target = conversationTarget(tab.target);
        return target?.kind === "agent"
          ? [
              {
                tabId: tab.tabId,
                serverId: tab.target.kind === "scoped" ? tab.target.serverId : owner,
                agentId: target.agentId,
              },
            ]
          : [];
      });
      const root = targets.find((target) => target.tabId === entry.rootTabId);
      if (root) result.set(`${workspaceKey}:${entry.id}`, { root, members: targets });
    }
  }
  queries.forEach((query, index) => {
    const scope = scopes[index]!;
    for (const team of query.data ?? []) {
      if (!team.sessionId) continue;
      const key = `${scope.serverId}:${scope.workspaceId}:${team.sessionId}`;
      if (team.status === "ended") {
        result.delete(key);
        continue;
      }
      const root = team.members.find((member) => member.id === team.captainId);
      if (root)
        result.set(key, { root, members: team.members.filter((member) => !member.removing) });
    }
  });
  return Array.from(result.values());
}
