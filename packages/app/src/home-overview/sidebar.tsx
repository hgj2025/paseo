import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspaceLayoutStore, collectAllTabs } from "@/stores/workspace-layout-store";
import { activeConversation, conversationTarget } from "@/stores/conversation-layout";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useHomeOverview } from "./use-home-overview";
import { ActiveSessionSidebarView } from "./sidebar-view";
const openSession = (serverId: string, agentId: string) => {
  navigateToAgent({ serverId, agentId });
};
export function ActiveSessionSidebar({
  compact = false,
  fill = false,
  onBeforeNavigate,
}: {
  compact?: boolean;
  fill?: boolean;
  onBeforeNavigate?: () => void;
}) {
  const overview = useHomeOverview();
  const workspace = useActiveWorkspaceSelection();
  const selectedSessionKey = useWorkspaceLayoutStore((state) => {
    if (!workspace) return undefined;
    const key = `${workspace.serverId}:${workspace.workspaceId}`;
    const conversation = activeConversation(state, key);
    if (!conversation) return undefined;
    const root = collectAllTabs(conversation.layout.root).find(
      (tab) => tab.tabId === conversation.rootTabId,
    );
    if (!root) return undefined;
    const target = conversationTarget(root.target);
    if (target?.kind !== "agent") return undefined;
    return JSON.stringify([
      root.target.kind === "scoped" ? root.target.serverId : workspace.serverId,
      target.agentId,
    ]);
  });
  return (
    <ActiveSessionSidebarView
      selectedSessionKey={selectedSessionKey}
      compact={compact}
      fill={fill}
      onBeforeNavigate={onBeforeNavigate}
      sessions={overview.sessions}
      loading={overview.isInitialLoad}
      openSession={openSession}
    />
  );
}
