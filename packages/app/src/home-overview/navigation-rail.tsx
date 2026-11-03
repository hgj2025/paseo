import { SidebarNavRows } from "@/components/sidebar/sidebar-nav-rows";
import { SidebarRailContext } from "@/components/sidebar/sidebar-rail-context";
import { useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, usePathname } from "expo-router";
import { usePanelStore } from "@/stores/panel-store";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import {
  buildNewWorkspaceRoute,
  buildSessionsRoute,
  buildSchedulesRoute,
  buildSettingsRoute,
} from "@/utils/host-routes";
import { useHomeOverview } from "./use-home-overview";
import { NavigationRailView } from "./navigation-rail-view";

/** One-time compact default; subsequent expand/collapse choices keep using panel-state. */
function useCompactNavigationDefault() {
  useEffect(() => {
    let disposed = false;
    const apply = async () => {
      try {
        const initialized = await AsyncStorage.getItem("mac-navigation-rail-v1");
        if (disposed || initialized) return;
        usePanelStore.getState().closeDesktopAgentList();
        await AsyncStorage.setItem("mac-navigation-rail-v1", "1");
      } catch {
        /* A preference failure must not prevent navigation. */
      }
    };
    const release = usePanelStore.persist.onFinishHydration(() => {
      void apply();
    });
    if (usePanelStore.persist.hasHydrated()) void apply();
    return () => {
      disposed = true;
      release();
    };
  }, []);
}
const openHome = () => usePanelStore.getState().openDesktopAgentList();
const toggleProjects = () => usePanelStore.getState().toggleDesktopAgentList();
const openNew = () => router.push(buildNewWorkspaceRoute());
const openHistory = () => router.push(buildSessionsRoute());
const openSearch = () => useKeyboardShortcutsStore.getState().setCommandCenterOpen(true);
const openSchedules = () => router.push(buildSchedulesRoute());
const openSettings = () => router.push(buildSettingsRoute());
const railPlugins = (
  <SidebarRailContext.Provider value={true}>
    <SidebarNavRows pluginsOnly />
  </SidebarRailContext.Provider>
);
export function DesktopNavigationRail() {
  useCompactNavigationDefault();
  const pathname = usePathname();
  const projects = usePanelStore((state) => state.desktop.agentListOpen);
  const overview = useHomeOverview();
  return (
    <NavigationRailView
      home={projects}
      projects={projects}
      settings={pathname.startsWith("/settings")}
      attention={overview.attentionCount}
      plugins={railPlugins}
      onHome={openHome}
      onProjects={toggleProjects}
      onNew={openNew}
      onHistory={openHistory}
      onSearch={openSearch}
      onSchedules={openSchedules}
      onMore={openHome}
      onSettings={openSettings}
    />
  );
}
