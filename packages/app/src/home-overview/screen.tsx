import { useEffect } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
import { View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { HomeOverviewView } from "./view";
import { useHomeOverview } from "./use-home-overview";
export function HomeOverviewScreen() {
  const focused = useIsFocused();
  const compact = useIsCompactFormFactor();
  const showHome = usePanelStore((state) => state.showMobileAgentList);
  useEffect(() => {
    if (focused && compact) showHome();
  }, [compact, focused, showHome]);
  if (compact) return <View />;
  return focused ? <HomeOverviewContent /> : <View />;
}
const openSession = (serverId: string, agentId: string) => navigateToAgent({ serverId, agentId });
function HomeOverviewContent() {
  const overview = useHomeOverview();
  return (
    <HomeOverviewView
      hosts={overview.hosts}
      sessions={overview.sessions}
      loading={overview.isInitialLoad}
      refresh={overview.refreshAll}
      openSession={openSession}
    />
  );
}
