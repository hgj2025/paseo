import type { ComponentType, ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  Home,
  Folder,
  Plus,
  History,
  Search,
  CalendarClock,
  MoreHorizontal,
  Settings,
} from "lucide-react-native";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
export const NAVIGATION_RAIL_WIDTH = 52;
export interface RailProps {
  home: boolean;
  projects: boolean;
  settings: boolean;
  attention: number;
  plugins?: ReactNode;
  onHome: () => void;
  onProjects: () => void;
  onNew: () => void;
  onHistory: () => void;
  onSearch: () => void;
  onSchedules: () => void;
  onMore: () => void;
  onSettings: () => void;
}
export function RailButton({
  icon: Icon,
  label,
  active,
  badge,
  onPress,
  testID,
}: {
  icon: ComponentType<{ size: number; color: string }>;
  label: string;
  active?: boolean;
  badge?: number;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected: Boolean(active) }}
          onPress={onPress}
          testID={testID}
          style={({ hovered }) => [styles.button, (active || hovered) && styles.highlight]}
        >
          <Icon size={20} color={active ? styles.activeIcon.color : styles.icon.color} />
          {Boolean(badge) && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge! > 99 ? "99+" : badge}</Text>
            </View>
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="right">
        <Text style={styles.tooltip}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}
export function NavigationRailView(props: RailProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.rail} testID="desktop-navigation-rail">
      <View style={styles.items}>
        <RailButton
          icon={Home}
          label={t("homeOverview.homeLabel", { count: props.attention })}
          active={props.home}
          badge={props.attention}
          onPress={props.onHome}
          testID="rail-home"
        />
        <RailButton
          icon={Folder}
          label={t("homeOverview.projects")}
          active={props.projects}
          onPress={props.onProjects}
          testID="rail-projects"
        />
        <View style={styles.separator} />
        <RailButton
          icon={Plus}
          label={t("sidebar.actions.newWorkspace")}
          onPress={props.onNew}
          testID="rail-new"
        />
        <RailButton
          icon={History}
          label={t("sidebar.sections.sessions")}
          onPress={props.onHistory}
          testID="rail-history"
        />
        <RailButton
          icon={Search}
          label={t("common.actions.search")}
          onPress={props.onSearch}
          testID="rail-search"
        />
        <RailButton
          icon={CalendarClock}
          label={t("homeOverview.schedules")}
          onPress={props.onSchedules}
          testID="rail-schedules"
        />
        {props.plugins}
        <RailButton
          icon={MoreHorizontal}
          label={t("homeOverview.more")}
          onPress={props.onMore}
          testID="rail-more"
        />
      </View>
      <View style={styles.spacer} />
      <RailButton
        icon={Settings}
        label={t("homeOverview.settings")}
        active={props.settings}
        onPress={props.onSettings}
        testID="rail-settings"
      />
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  rail: {
    width: NAVIGATION_RAIL_WIDTH,
    flexShrink: 0,
    paddingHorizontal: 7,
    paddingTop: 54,
    paddingBottom: 10,
    backgroundColor: theme.colors.surfaceSidebar,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    alignItems: "center",
  },
  items: { gap: 6, alignItems: "center" },
  spacer: { flex: 1 },
  button: {
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 8,
  },
  highlight: { backgroundColor: theme.colors.surface3 },
  icon: { color: theme.colors.foregroundMuted },
  activeIcon: { color: theme.colors.foreground },
  separator: { height: 1, width: 22, backgroundColor: theme.colors.border, marginVertical: 6 },
  badge: {
    position: "absolute",
    right: -3,
    top: -3,
    minWidth: 16,
    paddingHorizontal: 3,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.foreground,
  },
  badgeText: { fontSize: 10, color: theme.colors.surfaceSidebar, fontWeight: "600" },
  tooltip: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));
