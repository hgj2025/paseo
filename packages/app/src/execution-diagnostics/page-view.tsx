import { useTranslation } from "react-i18next";
import { FlatList, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { ExecutionDiagnosticDetail } from "./view";
import type { SessionDiagnostic } from "./cache";

export interface DiagnosticSessionRow {
  id: string;
  serverId: string;
  title: string | null;
  provider: string;
}
export interface DiagnosticPageProps {
  hosts: { serverId: string; label: string }[];
  serverId: string | null;
  selectHost: (id: string) => void;
  search: string;
  setSearch: (text: string) => void;
  sessions: DiagnosticSessionRow[];
  selected: DiagnosticSessionRow | null;
  selectSession: (session: DiagnosticSessionRow) => void;
  records: (serverId: string, agentId: string) => SessionDiagnostic | undefined;
  revision: number;
  loading: boolean;
  listFailed: boolean;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
  loadingHistory: boolean;
  historyFailed: boolean;
  connected: boolean;
  hasOlder: boolean;
  loadHistory: (older?: boolean) => void;
  clear: () => void;
}
export function ExecutionDiagnosticPageView(props: DiagnosticPageProps) {
  const { t } = useTranslation();
  const { selected } = props;
  const record = selected ? props.records(selected.serverId, selected.id) : undefined;
  return (
    <View style={styles.page} testID="execution-diagnostic-page">
      <Text style={styles.hint}>{t("executionDiagnostics.collection")}</Text>
      <View style={styles.buttons}>
        {props.hosts.map((host) => (
          <Button
            key={host.serverId}
            variant={props.serverId === host.serverId ? "secondary" : "ghost"}
            size="sm"
            accessibilityState={{ selected: props.serverId === host.serverId }}
            onPress={() => props.selectHost(host.serverId)}
          >
            {host.label}
          </Button>
        ))}
      </View>
      {!props.hosts.length && <Text style={styles.text}>{t("executionDiagnostics.noHosts")}</Text>}
      <AdaptiveTextInput
        accessibilityLabel={t("executionDiagnostics.search")}
        placeholder={t("executionDiagnostics.search")}
        initialValue={props.search}
        resetKey={props.serverId ?? "all"}
        onChangeText={props.setSearch}
        style={styles.input}
      />
      <View style={styles.buttons}>
        <Button size="xs" variant="ghost" disabled={props.loading} onPress={props.refresh}>
          {t("executionDiagnostics.refresh")}
        </Button>
        <Button size="xs" variant="ghost" onPress={props.clear}>
          {t("executionDiagnostics.clear")}
        </Button>
      </View>
      {props.loading && <Text style={styles.hint}>{t("executionDiagnostics.loading")}</Text>}
      {props.listFailed && <Text style={styles.text}>{t("executionDiagnostics.listFailed")}</Text>}
      <FlatList
        style={styles.sessions}
        data={props.sessions}
        keyExtractor={(session) => JSON.stringify([session.serverId, session.id])}
        extraData={[props.revision, selected]}
        initialNumToRender={10}
        windowSize={3}
        ListEmptyComponent={
          !props.loading && !props.listFailed ? (
            <Text style={styles.hint}>{t("executionDiagnostics.noSessions")}</Text>
          ) : null
        }
        renderItem={({ item: session }) => {
          const value = props.records(session.serverId, session.id);
          return (
            <Pressable
              style={[
                styles.session,
                selected?.id === session.id &&
                  selected.serverId === session.serverId &&
                  styles.selected,
              ]}
              accessibilityRole="button"
              accessibilityState={{
                selected: selected?.id === session.id && selected.serverId === session.serverId,
              }}
              onPress={() => props.selectSession(session)}
            >
              <Text style={styles.text} numberOfLines={1}>
                {session.title || session.id} · {session.provider}
              </Text>
              <Text style={styles.hint} numberOfLines={1}>
                {session.id}
              </Text>
              <Text style={styles.hint}>
                {value
                  ? t("executionDiagnostics.summary", {
                      failed: value.rows.filter(
                        (row) => row.status === "failed" && !row.recoveredBy,
                      ).length,
                      recovered: value.rows.filter((row) => row.recoveredBy).length,
                      slow: value.rows.filter((row) => row.slow).length,
                      total: value.rows.length,
                    })
                  : t("executionDiagnostics.notAnalyzed")}
              </Text>
            </Pressable>
          );
        }}
      />
      {props.hasMore && (
        <Button size="xs" variant="ghost" disabled={props.loading} onPress={props.loadMore}>
          {t("executionDiagnostics.moreSessions")}
        </Button>
      )}
      {selected ? (
        <View style={styles.detail}>
          <Text style={styles.heading}>{selected.title || selected.id}</Text>
          <View style={styles.buttons}>
            <Button
              size="xs"
              variant="secondary"
              disabled={props.loadingHistory || !props.connected}
              onPress={() => props.loadHistory()}
            >
              {t("executionDiagnostics.readHistory")}
            </Button>
            {props.hasOlder && (
              <Button
                size="xs"
                variant="ghost"
                disabled={props.loadingHistory || !props.connected}
                onPress={() => props.loadHistory(true)}
              >
                {t("executionDiagnostics.loadOlder")}
              </Button>
            )}
          </View>
          {props.loadingHistory && (
            <Text style={styles.hint}>{t("executionDiagnostics.loading")}</Text>
          )}
          {props.historyFailed && (
            <Text style={styles.text}>{t("executionDiagnostics.historyFailed")}</Text>
          )}
          {record ? (
            <ExecutionDiagnosticDetail
              key={JSON.stringify([selected.serverId, selected.id])}
              serverId={selected.serverId}
              agentId={selected.id}
              rows={record.rows}
              connected={props.connected}
              pendingCount={0}
              hasOlder={false}
              loadingOlder={false}
              loadOlder={() => {}}
            />
          ) : (
            <Text style={styles.hint}>{t("executionDiagnostics.notAnalyzed")}</Text>
          )}
        </View>
      ) : (
        <Text style={styles.hint}>{t("executionDiagnostics.chooseSession")}</Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  page: { gap: 12 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  input: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    padding: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 6,
  },
  sessions: { maxHeight: 260, flexGrow: 0 },
  session: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  selected: { backgroundColor: theme.colors.surface2 },
  detail: { paddingTop: 12, gap: 10, borderTopWidth: 1, borderTopColor: theme.colors.border },
  heading: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, fontWeight: "600" },
  text: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
