import { usePathname } from "expo-router";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { selectedSessionKey } from "./selected-session";
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
  const pathname = usePathname();
  const selectedKey = useWorkspaceLayoutStore((state) =>
    selectedSessionKey(pathname, state, overview.groups),
  );
  return (
    <ActiveSessionSidebarView
      selectedSessionKey={selectedKey}
      compact={compact}
      fill={fill}
      onBeforeNavigate={onBeforeNavigate}
      sessions={overview.sessions}
      loading={overview.isInitialLoad}
      openSession={openSession}
    />
  );
}
