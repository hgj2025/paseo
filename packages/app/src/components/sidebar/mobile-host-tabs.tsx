import { Flame } from "lucide-react-native";
import { DensityIcon } from "@/components/ui/density-icon";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

export function MobileHostTabs({
  hosts,
  selectedHostId,
  onSelect,
  actions,
  desktop = false,
}: {
  hosts: readonly { serverId: string; label: string }[];
  selectedHostId: string | null;
  onSelect: (serverId: string | null) => void;
  actions?: ReactNode;
  desktop?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View
      style={[styles.header, desktop && styles.desktopHeader]}
      testID={desktop ? "sidebar-host-tabs" : "mobile-host-tabs"}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.tabs}
      >
        <HostTab
          desktop={desktop}
          id={null}
          label={t("mobileHome.active")}
          selected={selectedHostId === null}
          onSelect={onSelect}
        />
        {hosts.map((host) => (
          <HostTab
            desktop={desktop}
            key={host.serverId}
            id={host.serverId}
            label={host.label || host.serverId}
            selected={selectedHostId === host.serverId}
            onSelect={onSelect}
          />
        ))}
      </ScrollView>
      <View style={styles.actions}>{actions}</View>
    </View>
  );
}
function HostTab({
  desktop,
  id,
  label,
  selected,
  onSelect,
}: {
  desktop: boolean;
  id: string | null;
  label: string;
  selected: boolean;
  onSelect: (id: string | null) => void;
}) {
  const [focused, setFocused] = useState(false);
  const focus = useCallback(() => setFocused(true), []);
  const blur = useCallback(() => setFocused(false), []);
  const press = useCallback(() => onSelect(id), [id, onSelect]);
  const state = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={state}
      aria-selected={selected}
      accessibilityLabel={label}
      onPress={press}
      onFocus={focus}
      onBlur={blur}
      style={[
        styles.tab,
        !desktop && selected && styles.selected,
        desktop && styles.desktopTab,
        desktop && focused && styles.desktopFocused,
        desktop && selected && styles.desktopSelected,
      ]}
      testID={`mobile-host-tab-${id ?? "active"}`}
    >
      {desktop && id === null ? (
        <DensityIcon icon={Flame} size="sm" color={selected ? "foreground" : "foregroundMuted"} />
      ) : (
        <Text
          numberOfLines={1}
          style={[styles.label, desktop && styles.desktopLabel, selected && styles.selectedLabel]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
const styles = StyleSheet.create((theme) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[2],
  },
  desktopHeader: { paddingTop: 2, paddingBottom: 6, gap: 4 },
  desktopTab: {
    minHeight: 32,
    paddingHorizontal: 7,
    borderRadius: 0,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    outlineWidth: 0,
  },
  desktopSelected: { borderBottomColor: theme.colors.foreground },
  desktopFocused: { borderBottomColor: theme.colors.foregroundMuted },
  desktopLabel: { fontSize: theme.fontSize.sm },
  scroll: { flex: 1, minWidth: 0 },
  tabs: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  tab: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    maxWidth: 180,
  },
  selected: { backgroundColor: theme.colors.surface2 },
  label: { fontSize: theme.fontSize.base, color: theme.colors.foregroundMuted },
  selectedLabel: { color: theme.colors.foreground, fontWeight: theme.fontWeight.medium },
  actions: { flexDirection: "row", alignItems: "center" },
}));
