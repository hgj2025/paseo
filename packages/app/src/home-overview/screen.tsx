import { View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { HomeOverviewView } from "./view";
import { useHomeOverview } from "./use-home-overview";
export function HomeOverviewScreen() {
  const focused = useIsFocused();
  return focused ? <HomeOverviewContent /> : <View />;
}
function HomeOverviewContent() {
  const overview = useHomeOverview();
  return (
    <HomeOverviewView
      hosts={overview.hosts}
      sessions={overview.sessions}
      loading={overview.isInitialLoad}
      refresh={overview.refreshAll}
      openSession={(serverId, agentId) => {
        navigateToAgent({ serverId, agentId });
      }}
    />
  );
}
