import { useEffect, useState } from "react";
import { Users } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import {
  useWorkspaceLayoutStore,
  useWorkspaceLayoutStoreHydrated,
  collectAllTabs,
} from "@/stores/workspace-layout-store";
import { activeConversation, conversationTarget } from "@/stores/conversation-layout";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-api-context";
import { useWorkspaceTeamState } from "./use-workspace-team";
import { WorkspaceTeamProvider } from "./workspace-team-context";
import type { TeamMember } from "@getpaseo/protocol/workspace-team";
import { useStableEvent } from "@/hooks/use-stable-event";
import { TeamDashboard } from "./team-dashboard";

export function ConversationActions({
  serverId,
  workspaceId,
  controllerOnly = false,
}: {
  serverId: string;
  workspaceId: string;
  controllerOnly?: boolean;
}) {
  const { t } = useTranslation(),
    key = `${serverId}:${workspaceId}`,
    toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const supported = useHostFeature(serverId, "sessionTeams");
  const hydrated = useWorkspaceLayoutStoreHydrated();
  const conversation = useWorkspaceLayoutStore((state) => activeConversation(state, key));
  const layout = useWorkspaceLayoutStore((state) => state.layoutByWorkspace[key]);
  const { context } = useWorkspaceTeamState(serverId, workspaceId, supported);
  const [historyOpen, setHistoryOpen] = useState(false);
  const openHistory = useStableEvent(() => setHistoryOpen(true));
  const closeHistory = useStableEvent(() => setHistoryOpen(false));
  useEffect(() => {
    if (!hydrated || !supported || !connected || !client) return;
    let cancelled = false;
    async function restore() {
      try {
        const teams = await client!.workspaceConversations(workspaceId);
        if (cancelled) return;
        const store = useWorkspaceLayoutStore.getState();
        store.restoreConversations(key, teams);
        store.enableConversations(key);
      } catch (error) {
        if (!cancelled) toast.error(String(error));
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, [hydrated, supported, connected, client, key, workspaceId, toast]);
  const openMember = useStableEvent((member: TeamMember) => {
    const entry =
      layout &&
      collectAllTabs(layout.root).find((tab) => {
        const target = conversationTarget(tab.target);
        const host = tab.target.kind === "scoped" ? tab.target.serverId : serverId;
        return (
          host === member.serverId && target?.kind === "agent" && target.agentId === member.agentId
        );
      });
    if (entry) useWorkspaceLayoutStore.getState().focusTab(key, entry.tabId);
    setHistoryOpen(false);
  });

  if (!supported || !conversation) return null;
  return (
    <>
      {!controllerOnly && (
        <Button
          size="xs"
          variant="ghost"
          leftIcon={Users}
          onPress={openHistory}
          accessibilityLabel={t("workspace.team.dashboard.title")}
          testID="workspace-team-management"
        >
          {t("workspace.team.dashboard.title")}
        </Button>
      )}
      {historyOpen && context && (
        <WorkspaceTeamProvider value={context}>
          <TeamDashboard onClose={closeHistory} onOpenMember={openMember} />
        </WorkspaceTeamProvider>
      )}
    </>
  );
}
