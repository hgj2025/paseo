import { useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import type { HomeHost, HomeSession } from "./model";

export function HomeOverviewView({
  hosts,
  sessions,
  loading,
  openSession,
  refresh,
}: {
  hosts: readonly HomeHost[];
  sessions: readonly HomeSession[];
  loading: boolean;
  openSession: (serverId: string, agentId: string) => void;
  refresh: () => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [host, setHost] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const rows = useMemo(
    () =>
      sessions.filter(
        (row) =>
          (filter === "all" || row.active) &&
          (!host || row.agent.serverId === host) &&
          [row.agent.title, row.agent.cwd, row.agent.provider, row.agent.serverLabel]
            .join(" ")
            .toLowerCase()
            .includes(search.toLowerCase().trim()),
      ),
    [sessions, filter, host, search],
  );
  const waiting = sessions.filter((row) => row.state === "waiting").length;
  const running = sessions.filter(
    (row) => row.state === "running" || row.state === "starting",
  ).length;
  const finished = sessions.filter(
    (row) => row.state === "finished" && row.agent.requiresAttention,
  ).length;
  return (
    <View style={styles.body} testID="home-overview">
      <View style={styles.intro}>
        <Text style={styles.heading}>{t("homeOverview.title")}</Text>
        <Text style={styles.hint}>{t("homeOverview.description")}</Text>
        <Text style={styles.text}>{t("homeOverview.summary", { waiting, running, finished })}</Text>
      </View>
      <View style={styles.controls}>
        <Button
          size="sm"
          variant={filter === "active" ? "secondary" : "ghost"}
          accessibilityState={{ selected: filter === "active" }}
          onPress={() => setFilter("active")}
        >
          {t("homeOverview.active")}
        </Button>
        <Button
          size="sm"
          variant={filter === "all" ? "secondary" : "ghost"}
          accessibilityState={{ selected: filter === "all" }}
          onPress={() => setFilter("all")}
        >
          {t("homeOverview.all")}
        </Button>
        <Button size="sm" variant="ghost" onPress={refresh}>
          {t("homeOverview.refresh")}
        </Button>
      </View>
      <View style={styles.controls}>
        <Button
          size="xs"
          variant={host === null ? "secondary" : "ghost"}
          onPress={() => setHost(null)}
        >
          {t("homeOverview.allHosts")}
        </Button>
        {hosts.map((item) => (
          <Button
            key={item.serverId}
            size="xs"
            variant={host === item.serverId ? "secondary" : "ghost"}
            onPress={() => setHost(item.serverId)}
          >
            {item.label}
          </Button>
        ))}
      </View>
      {hosts
        .filter((item) => !item.fresh)
        .map((item) => (
          <Text key={item.serverId} style={styles.hint}>
            {t(item.connected ? "homeOverview.syncing" : "homeOverview.offline", {
              host: item.label,
            })}
          </Text>
        ))}
      <AdaptiveTextInput
        accessibilityLabel={t("homeOverview.search")}
        placeholder={t("homeOverview.search")}
        onChangeText={setSearch}
        style={styles.input}
      />
      {loading && <Text style={styles.hint}>{t("homeOverview.loading")}</Text>}
      <FlatList
        data={rows}
        style={styles.list}
        keyExtractor={(row) => JSON.stringify([row.agent.serverId, row.agent.id])}
        initialNumToRender={15}
        windowSize={5}
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.empty}>
              {t(hosts.length ? "homeOverview.empty" : "homeOverview.noHosts")}
            </Text>
          ) : null
        }
        renderItem={({ item: row }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${row.agent.serverLabel} · ${row.agent.title || row.agent.id} · ${t(`homeOverview.state.${row.state}`)}`}
            onPress={() => openSession(row.agent.serverId, row.agent.id)}
            style={({ hovered }) => [styles.row, hovered && styles.hover]}
          >
            <View style={styles.rowTop}>
              <Text style={styles.title} numberOfLines={1}>
                {row.agent.title || row.agent.id}
              </Text>
              <Text
                style={[
                  styles.status,
                  (row.state === "waiting" || row.state === "failed") && styles.attention,
                ]}
              >
                {t(`homeOverview.state.${row.state}`)}
              </Text>
            </View>
            <Text style={styles.hint} numberOfLines={1}>
              {row.agent.serverLabel} · {row.agent.provider} · {row.agent.cwd}
            </Text>
            <Text style={styles.hint}>
              {t("homeOverview.lastActivity")} {row.agent.lastActivityAt.toLocaleTimeString()} ·{" "}
              {row.agent.id.slice(0, 8)}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  body: { flex: 1, padding: 24, gap: 12, backgroundColor: theme.colors.surface0 },
  intro: { gap: 8 },
  heading: { fontSize: theme.fontSize.xl, color: theme.colors.foreground, fontWeight: "600" },
  text: { fontSize: theme.fontSize.sm, color: theme.colors.foreground },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  input: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    padding: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 6,
  },
  list: { flex: 1 },
  row: {
    paddingVertical: 14,
    paddingHorizontal: 10,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  hover: { backgroundColor: theme.colors.surface1 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1, fontSize: theme.fontSize.base, color: theme.colors.foreground },
  status: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  attention: { color: theme.colors.foreground, fontWeight: "600" },
  empty: { paddingVertical: 24, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
