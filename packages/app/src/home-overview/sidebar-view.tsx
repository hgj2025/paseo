import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStableEvent } from "@/hooks/use-stable-event";
import { FlatList, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { todaySessions, type HomeSession } from "./model";

export function ActiveSessionSidebarView({
  sessions,
  loading,
  openSession,
  compact = false,
  onBeforeNavigate,
}: {
  sessions: readonly HomeSession[];
  loading: boolean;
  compact?: boolean;
  onBeforeNavigate?: () => void;
  openSession(serverId: string, agentId: string): void;
}) {
  const { t } = useTranslation();
  const [day, setDay] = useState(() => new Date().toDateString());
  const ordering = useRef<{ day: string; keys: string[] }>({ day, keys: [] });
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = setTimeout(
      () => setDay(new Date().toDateString()),
      midnight.getTime() - now.getTime() + 50,
    );
    return () => clearTimeout(timer);
  }, [day]);
  const active = useMemo(() => {
    const rows = todaySessions(
      sessions,
      new Date(),
      ordering.current.day === day ? ordering.current.keys : [],
    );
    ordering.current = { day, keys: rows.map(sessionKey) };
    return rows;
  }, [sessions, day]);
  const empty = useMemo(
    () => (
      <Text style={styles.empty}>
        {t(loading ? "homeOverview.loading" : "homeOverview.sidebarEmpty")}
      </Text>
    ),
    [loading, t],
  );
  const handleOpenSession = useStableEvent((serverId: string, agentId: string) => {
    onBeforeNavigate?.();
    openSession(serverId, agentId);
  });
  const renderItem = useStableEvent(({ item }: { item: HomeSession }) => (
    <ActiveSessionRow item={item} compact={compact} openSession={handleOpenSession} />
  ));
  return (
    <View
      style={[styles.section, compact && styles.compactSection]}
      testID="sidebar-cross-host-active"
    >
      <View style={styles.heading}>
        <Text style={styles.label}>{t("homeOverview.today")}</Text>
        <Text style={styles.meta}>
          {t("homeOverview.allHosts")} · {active.length}
        </Text>
      </View>
      <FlatList
        nestedScrollEnabled
        data={active}
        style={styles.list}
        keyExtractor={sessionKey}
        ListEmptyComponent={empty}
        renderItem={renderItem}
      />
    </View>
  );
}
const sessionKey = (row: HomeSession) => JSON.stringify([row.agent.serverId, row.agent.id]);
const rowStyle = ({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
  styles.row,
  (hovered || pressed) && styles.hover,
];
function ActiveSessionRow({
  item,
  compact,
  openSession,
}: {
  item: HomeSession;
  compact: boolean;
  openSession(serverId: string, agentId: string): void;
}) {
  const { t } = useTranslation();
  const open = useStableEvent(() => openSession(item.agent.serverId, item.agent.id));
  const pressableStyle = useStableEvent((state: Parameters<typeof rowStyle>[0]) => [
    rowStyle(state),
    compact && styles.compactRow,
  ]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.agent.serverLabel} · ${item.agent.title || item.agent.provider} · ${t(`homeOverview.state.${item.state}`)}`}
      onPress={open}
      style={pressableStyle}
    >
      <View style={styles.line}>
        <Text numberOfLines={1} style={styles.title}>
          {item.agent.title || item.agent.provider}
        </Text>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <View
              style={styles.signalSlot}
              accessibilityRole="image"
              accessibilityLabel={t(`homeOverview.state.${item.state}`)}
            >
              <View style={[styles.signal, signalStyle(item.state)]} />
            </View>
          </TooltipTrigger>
          <TooltipContent side="right">
            <Text>{t(`homeOverview.state.${item.state}`)}</Text>
          </TooltipContent>
        </Tooltip>
      </View>
      <Text numberOfLines={1} style={styles.meta}>
        {item.agent.serverLabel} · {item.agent.provider}
      </Text>
    </Pressable>
  );
}
function signalStyle(state: HomeSession["state"]) {
  switch (state) {
    case "finished":
      return styles.signalSuccess;
    case "running":
    case "starting":
      return styles.signalRunning;
    case "failed":
      return styles.signalDanger;
    case "waiting":
    case "attention":
      return styles.signalWarning;
    default:
      return styles.signalUnknown;
  }
}
const styles = StyleSheet.create((theme) => ({
  section: {
    maxHeight: 300,
    flexShrink: 1,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingBottom: 8,
  },
  compactSection: { maxHeight: "40%" },
  compactRow: { minHeight: 48 },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  label: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  meta: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  list: { flexGrow: 0, flexShrink: 1 },
  row: { marginHorizontal: 8, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, gap: 3 },
  hover: { backgroundColor: theme.colors.surface2 },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  signalSlot: {
    width: 16,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  signal: { width: 8, height: 8, borderRadius: 4 },
  signalSuccess: { backgroundColor: theme.colors.statusDotSuccess },
  signalRunning: { backgroundColor: theme.colors.statusDotRunning },
  signalDanger: { backgroundColor: theme.colors.statusDotDanger },
  signalWarning: { backgroundColor: theme.colors.statusDotWarning },
  signalUnknown: { backgroundColor: theme.colors.foregroundExtraMuted },
  title: { fontSize: theme.fontSize.base, color: theme.colors.foreground, flex: 1 },
  empty: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
}));
