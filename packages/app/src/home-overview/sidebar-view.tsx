import { ResizeHandle } from "@/components/resize-handle";
import { resolveActiveSessionHeight, useActiveSessionHeight } from "./sidebar-height";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStableEvent } from "@/hooks/use-stable-event";
import { FlatList, Pressable, Text, View, useWindowDimensions } from "react-native";
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
  const { height: windowHeight } = useWindowDimensions();
  const savedHeight = useActiveSessionHeight((state) => state.height);
  const saveHeight = useActiveSessionHeight((state) => state.setHeight);
  const [previewHeight, setPreviewHeight] = useState<number | null>(null);
  const sectionHeight = resolveActiveSessionHeight(previewHeight ?? savedHeight, windowHeight);
  const splitSizes = useMemo(
    () => [sectionHeight / windowHeight, 1 - sectionHeight / windowHeight],
    [sectionHeight, windowHeight],
  );
  const previewResize = useStableEvent((_groupId: string, sizes: number[]) => {
    setPreviewHeight(resolveActiveSessionHeight(sizes[0]! * windowHeight, windowHeight));
  });
  const commitResize = useStableEvent((_groupId: string, sizes: number[]) => {
    saveHeight(resolveActiveSessionHeight(sizes[0]! * windowHeight, windowHeight));
    setPreviewHeight(null);
  });
  const sectionStyle = useMemo(
    () => [
      styles.section,
      compact ? styles.compactSection : { height: sectionHeight, maxHeight: sectionHeight },
    ],
    [compact, sectionHeight],
  );
  const [signalFilter, setSignalFilter] = useState<HomeSession["state"] | null>(null);
  const toggleSignal = useStableEvent((state: HomeSession["state"]) => {
    setSignalFilter((current) =>
      current !== null && signalGroup(current) === signalGroup(state) ? null : state,
    );
  });
  const clearSignal = useStableEvent(() => setSignalFilter(null));
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
  const visibleSessions = useMemo(
    () =>
      signalFilter === null
        ? active
        : active.filter((row) => signalGroup(row.state) === signalGroup(signalFilter)),
    [active, signalFilter],
  );
  const empty = useMemo(() => {
    let message = t("homeOverview.empty");
    if (loading) message = t("homeOverview.loading");
    return <Text style={styles.empty}>{message}</Text>;
  }, [loading, t]);
  const handleOpenSession = useStableEvent((serverId: string, agentId: string) => {
    onBeforeNavigate?.();
    openSession(serverId, agentId);
  });
  const renderItem = useStableEvent(({ item }: { item: HomeSession }) => (
    <ActiveSessionRow
      item={item}
      compact={compact}
      openSession={handleOpenSession}
      toggleSignal={toggleSignal}
      signalFilter={signalFilter}
    />
  ));
  return (
    <View style={sectionStyle} testID="sidebar-cross-host-active">
      <View style={styles.heading}>
        <Text style={styles.label}>{t("homeOverview.today")}</Text>
        {signalFilter !== null && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("homeOverview.clearSignalFilter")}
            testID="sidebar-clear-signal-filter"
            onPress={clearSignal}
            style={styles.signalFilter}
          >
            <View style={[styles.signal, signalStyle(signalFilter)]} />
          </Pressable>
        )}
      </View>
      <FlatList
        nestedScrollEnabled
        data={visibleSessions}
        style={styles.list}
        keyExtractor={sessionKey}
        ListEmptyComponent={empty}
        renderItem={renderItem}
      />
      {!compact && (
        <View style={styles.resizeBoundary}>
          <ResizeHandle
            testID="active-session-sidebar-resize"
            direction="vertical"
            groupId="active-session-sidebar"
            index={0}
            sizes={splitSizes}
            containerSize={windowHeight}
            onPreviewResizeSplit={previewResize}
            onResizeSplit={commitResize}
          />
        </View>
      )}
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
  toggleSignal,
  signalFilter,
}: {
  item: HomeSession;
  compact: boolean;
  signalFilter: HomeSession["state"] | null;
  toggleSignal(state: HomeSession["state"]): void;
  openSession(serverId: string, agentId: string): void;
}) {
  const { t } = useTranslation();
  const filterSignal = useStableEvent(() => toggleSignal(item.state));
  const selected = signalFilter !== null && signalGroup(signalFilter) === signalGroup(item.state);
  const signalAccessibilityState = useMemo(() => ({ selected }), [selected]);
  const open = useStableEvent(() => openSession(item.agent.serverId, item.agent.id));
  const pressableStyle = useStableEvent((state: Parameters<typeof rowStyle>[0]) => [
    rowStyle(state),
    compact && styles.compactRow,
  ]);
  return (
    <View style={styles.rowContainer}>
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
        </View>
        <Text numberOfLines={1} style={styles.meta}>
          {item.agent.serverLabel} · {item.agent.provider}
        </Text>
      </Pressable>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Pressable
            testID={`sidebar-signal-${item.agent.serverId}-${item.agent.id}`}
            accessibilityRole="button"
            accessibilityLabel={t("homeOverview.filterSignal", {
              state: t(`homeOverview.state.${item.state}`),
            })}
            accessibilityState={signalAccessibilityState}
            onPress={filterSignal}
            style={[styles.signalSlot, compact && styles.compactSignalSlot]}
          >
            <View style={[styles.signal, signalStyle(item.state)]} />
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="right">
          <Text>{t(`homeOverview.state.${item.state}`)}</Text>
        </TooltipContent>
      </Tooltip>
    </View>
  );
}
function signalGroup(state: HomeSession["state"]) {
  if (state === "running" || state === "starting") return "running";
  if (state === "waiting" || state === "attention") return "waiting";
  if (state === "finished" || state === "failed") return state;
  return "idle";
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
  resizeBoundary: { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 10 },
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
  rowContainer: { position: "relative" },
  signalFilter: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
  },
  label: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  meta: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  list: { flexGrow: 0, flexShrink: 1 },
  row: {
    marginHorizontal: 8,
    borderRadius: 8,
    paddingLeft: 10,
    paddingRight: 40,
    paddingVertical: 7,
    gap: 3,
  },
  hover: { backgroundColor: theme.colors.surface2 },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  signalSlot: {
    position: "absolute",
    right: 10,
    top: 0,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  compactSignalSlot: { width: 48, height: 48, right: 4 },
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
