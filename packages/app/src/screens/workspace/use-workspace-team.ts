import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type { TeamAction } from "@getpaseo/protocol/workspace-team";
import { useFetchQuery } from "@/data/query";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { WorkspaceTeamContextValue } from "./workspace-team-context";

/** Header and panes share the layout owner's team cache and mutation path. */
export function useWorkspaceTeamState(serverId: string, workspaceId: string, active: boolean) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const supported = useHostFeature(serverId, "workspaceTeams");
  const supportsGroups = useHostFeature(serverId, "workspaceTeamGroups");
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["workspace-team", serverId, workspaceId],
    [serverId, workspaceId],
  );
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    queryKey,
    queryFn: () => client!.workspaceTeam(workspaceId, { kind: "read" }),
    enabled: supported && connected && Boolean(client) && active,
    refetchInterval: active ? 5000 : false,
    retry: false,
  });
  const execute = useStableEvent(async (action: TeamAction) => {
    if (!client || !connected) throw new Error(t("workspace.terminal.hostDisconnected"));
    const result = await client.workspaceTeam(workspaceId, action);
    queryClient.setQueryData(queryKey, result);
    return result;
  });
  const retry = useStableEvent(() => {
    void query.refetch();
  });
  const context = useMemo<WorkspaceTeamContextValue | null>(
    () =>
      supported
        ? {
            team: query.data ?? null,
            supportsGroups,
            ownerServerId: serverId,
            workspaceId,
            error: query.error ? String(query.error) : null,
            execute,
          }
        : null,
    [supported, supportsGroups, query.data, query.error, serverId, workspaceId, execute],
  );
  return { context, supported, connected, retry };
}
