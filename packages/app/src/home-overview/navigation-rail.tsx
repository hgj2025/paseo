import { SidebarNavRows } from "@/components/sidebar/sidebar-nav-rows";
import { SidebarRailContext } from "@/components/sidebar/sidebar-rail-context";
import { useCallback, useEffect, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, usePathname } from "expo-router";
import { pluginScreensHostKey, rememberPluginContributionHost } from "@/plugins/contribution-host";
import { useInstalledPlugins } from "@/plugins/registry";
import {
  buildPluginSurfaceRoute,
  hostIdFromPathname,
  parsePluginSurfaceRoute,
} from "@/plugins/routes";
import { groupPluginSidebarItems, selectPluginSidebarTarget } from "@/plugins/sidebar-groups";
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

const BOTS_PLUGIN_ID = "paseo-bots";
const BOTS_SCREEN_ID = "bots";
const PINNED_RAIL_PLUGIN_IDS = [BOTS_PLUGIN_ID] as const;

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
    <SidebarNavRows pluginsOnly excludePluginIds={PINNED_RAIL_PLUGIN_IDS} />
  </SidebarRailContext.Provider>
);
export function DesktopNavigationRail() {
  useCompactNavigationDefault();
  const pathname = usePathname();
  const projects = usePanelStore((state) => state.desktop.agentListOpen);
  const overview = useHomeOverview();
  const installedPlugins = useInstalledPlugins();
  const botsTarget = useMemo(() => {
    const groups = groupPluginSidebarItems(installedPlugins, "header");
    const botsGroup = groups.find((group) => group.pluginId === BOTS_PLUGIN_ID);
    if (botsGroup) {
      return selectPluginSidebarTarget(botsGroup, hostIdFromPathname(pathname)).plugin;
    }
    const routeHost = hostIdFromPathname(pathname);
    return (
      installedPlugins.find(
        (plugin) => plugin.id === BOTS_PLUGIN_ID && plugin.serverId === routeHost,
      ) ??
      installedPlugins.find((plugin) => plugin.id === BOTS_PLUGIN_ID) ??
      null
    );
  }, [installedPlugins, pathname]);
  const openBots = useCallback(() => {
    if (!botsTarget) {
      router.push(buildSettingsRoute());
      return;
    }
    rememberPluginContributionHost(pluginScreensHostKey(botsTarget.id), botsTarget.serverId);
    router.push(
      buildPluginSurfaceRoute(botsTarget.serverId, botsTarget.id, {
        kind: "surface",
        id: BOTS_SCREEN_ID,
      }),
    );
  }, [botsTarget]);
  const botsActive = parsePluginSurfaceRoute(pathname)?.pluginId === BOTS_PLUGIN_ID;
  return (
    <NavigationRailView
      home={projects}
      projects={projects}
      bots={botsActive}
      settings={pathname.startsWith("/settings")}
      attention={overview.attentionCount}
      plugins={railPlugins}
      onHome={openHome}
      onProjects={toggleProjects}
      onBots={openBots}
      onNew={openNew}
      onHistory={openHistory}
      onSearch={openSearch}
      onSchedules={openSchedules}
      onMore={openHome}
      onSettings={openSettings}
    />
  );
}
