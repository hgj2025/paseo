import { useCallback, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useHosts } from "@/runtime/host-runtime";
import {
  useActiveWorkspaceSelection,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import {
  SIDEBAR_CURRENT_HOST,
  resolveSidebarHostFilters,
  useSidebarViewStore,
} from "@/stores/sidebar-view-store";
import { Combobox } from "@/components/ui/combobox";
import { ToolbarLabelSelectTrigger } from "@/components/ui/toolbar-label-trigger";

const ALL_HOSTS = "@all";

/** A local directory filter; never changes navigation or the pane's execution host. */
export function SidebarHostFilter() {
  const { t } = useTranslation();
  const hosts = useHosts();
  const active = useActiveWorkspaceSelection();
  const last = useLastWorkspaceSelection();
  const filters = useSidebarViewStore((state) => state.hostFilters);
  const selectHost = useSidebarViewStore((state) => state.selectHostFilter);
  const [open, setOpen] = useState(false);
  const anchor = useRef<View>(null);
  const currentId = active?.serverId ?? last?.serverId;
  const resolved = resolveSidebarHostFilters(
    filters,
    hosts.map((host) => host.serverId),
    currentId,
  );
  const currentLabel = hosts.find((host) => host.serverId === resolved[0])?.label ?? resolved[0];
  let label = t("sidebar.display.hostFilter.multiple");
  if (filters.includes(SIDEBAR_CURRENT_HOST)) {
    label = currentLabel ?? t("sidebar.display.hostFilter.current");
  } else if (filters.length === 0) {
    label = t("sidebar.display.hostFilter.all");
  } else if (filters.length === 1) {
    label = currentLabel ?? filters[0]!;
  }
  const options = useMemo(
    () => [
      { id: SIDEBAR_CURRENT_HOST, label: t("sidebar.display.hostFilter.current") },
      { id: ALL_HOSTS, label: t("sidebar.display.hostFilter.all") },
      ...hosts.map((host) => ({ id: host.serverId, label: host.label || host.serverId })),
    ],
    [hosts, t],
  );
  const show = useCallback(() => setOpen(true), []);
  const select = useCallback(
    (id: string) => {
      selectHost(id === ALL_HOSTS ? null : id);
      setOpen(false);
    },
    [selectHost],
  );
  return (
    <View ref={anchor} collapsable={false} style={styles.container}>
      <ToolbarLabelSelectTrigger
        label={label}
        open={open}
        onPress={show}
        accessibilityLabel={`${t("sidebar.display.hostFilter.label")}: ${label}`}
        testID="sidebar-host-filter"
      />
      {open && (
        <Combobox
          options={options}
          value={filters[0] ?? ALL_HOSTS}
          onSelect={select}
          anchorRef={anchor}
          open={open}
          onOpenChange={setOpen}
          title={t("sidebar.display.hostFilter.label")}
          desktopPlacement="bottom-start"
          desktopMinWidth={220}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  container: { maxWidth: 140, minWidth: 0, flexShrink: 1, borderRadius: theme.borderRadius.md },
}));
