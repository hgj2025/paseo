import { Component, type ReactNode, useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ExecutionRow } from "./model";

interface Props {
  connected: boolean;
  serverId: string;
  agentId: string;
  rows: readonly ExecutionRow[];
  pendingCount: number;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadOlder: () => unknown;
}

class DiagnosticBoundary extends Component<
  { children: ReactNode; fallback: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Text style={styles.muted}>{this.props.fallback}</Text>
    ) : (
      this.props.children
    );
  }
}

/** Read-only detail for the settings page. Collection is owned by the App root. */
export function ExecutionDiagnosticDetail(props: Props) {
  const { t } = useTranslation();
  return (
    <DiagnosticBoundary fallback={t("executionDiagnostics.analysisFailed")}>
      <DiagnosticBody {...props} />
    </DiagnosticBoundary>
  );
}

function DiagnosticBody({
  connected,
  serverId,
  agentId,
  rows,
  pendingCount,
  hasOlder,
  loadingOlder,
  loadOlder,
}: Props) {
  const { t } = useTranslation();
  const [historyError, setHistoryError] = useState(false);
  const [filter, setFilter] = useState<"issues" | "slow" | "all">("issues");
  const [expanded, setExpanded] = useState<string | null>(null);
  const failures = rows.filter((row) => row.status === "failed" && !row.recoveredBy).length;
  const recovered = rows.filter((row) => row.recoveredBy).length;
  const slow = rows.filter((row) => row.slow).length;
  const visible = useMemo(
    () =>
      rows
        .filter(
          (row) => filter === "all" || (filter === "slow" ? row.slow : row.status === "failed"),
        )
        .reverse(),
    [rows, filter],
  );
  const duration = (row: ExecutionRow) =>
    row.durationMs === undefined
      ? t("executionDiagnostics.unknown")
      : `${(row.durationMs / 1000).toFixed(1)}s · ${t(`executionDiagnostics.${row.timing}`)}`;
  return (
    <View style={styles.body} testID="execution-diagnostics-body">
      <Text style={styles.muted} numberOfLines={1}>
        {serverId} / {agentId}
      </Text>
      <Text style={styles.text}>
        {t("executionDiagnostics.summary", {
          failed: failures,
          recovered,
          slow,
          total: rows.length,
        })}
      </Text>
      <Text style={styles.muted}>{t("executionDiagnostics.coverage")}</Text>
      {!connected && <Text style={styles.text}>{t("executionDiagnostics.disconnected")}</Text>}
      {pendingCount > 0 && (
        <Text style={styles.text}>
          {t("executionDiagnostics.pending", { count: pendingCount })}
        </Text>
      )}
      <View style={styles.filters}>
        {(["issues", "slow", "all"] as const).map((value) => (
          <Button
            key={value}
            size="xs"
            variant={filter === value ? "secondary" : "ghost"}
            onPress={() => setFilter(value)}
            accessibilityState={{ selected: filter === value }}
          >
            {t(`executionDiagnostics.${value}`)}
          </Button>
        ))}
        {hasOlder && (
          <Button
            size="xs"
            variant="ghost"
            disabled={loadingOlder}
            onPress={() => {
              setHistoryError(false);
              try {
                void Promise.resolve(loadOlder()).catch(() => setHistoryError(true));
              } catch {
                setHistoryError(true);
              }
            }}
          >
            {t(loadingOlder ? "executionDiagnostics.loading" : "executionDiagnostics.loadOlder")}
          </Button>
        )}
      </View>
      {historyError && <Text style={styles.text}>{t("executionDiagnostics.historyFailed")}</Text>}
      <FlatList
        style={styles.list}
        data={visible}
        keyExtractor={(row) => row.id}
        extraData={expanded}
        initialNumToRender={8}
        windowSize={3}
        ListEmptyComponent={
          <Text style={styles.muted}>
            {t(rows.length ? "executionDiagnostics.noMatches" : "executionDiagnostics.empty")}
          </Text>
        }
        renderItem={({ item: row }) => (
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: expanded === row.id }}
              onPress={() => setExpanded(expanded === row.id ? null : row.id)}
              style={styles.rowToggle}
            >
              <Text style={styles.text}>
                {t(
                  row.recoveredBy
                    ? "executionDiagnostics.recovered"
                    : `executionDiagnostics.status.${row.status}`,
                )}{" "}
                · {t(`executionDiagnostics.category.${row.category}`)}
              </Text>
              <Text style={styles.muted}>{duration(row)}</Text>
              <Text
                style={styles.command}
                numberOfLines={expanded === row.id ? undefined : 1}
                selectable
              >
                {row.command || t("executionDiagnostics.agentError")}
              </Text>
            </Pressable>
            {expanded === row.id && (
              <View style={styles.evidence}>
                <Text selectable style={styles.command}>
                  {row.evidence || t("executionDiagnostics.noEvidence")}
                </Text>
                {row.recoveredBy && (
                  <Text style={styles.muted}>
                    {t("executionDiagnostics.retryEvidence")} {row.recoveredBy}
                  </Text>
                )}
                <Text style={styles.muted}>
                  {t("executionDiagnostics.source")} {row.id}
                </Text>
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  root: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  label: { color: theme.colors.foregroundMuted, fontSize: 12 },
  body: { paddingHorizontal: 16, paddingBottom: 10, gap: 6 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  list: { maxHeight: 480, flexGrow: 0 },
  row: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowToggle: { gap: 3 },
  evidence: { gap: 6, paddingTop: 8 },
  text: { color: theme.colors.foreground, fontSize: 12 },
  muted: { color: theme.colors.foregroundMuted, fontSize: 11 },
  command: {
    color: theme.colors.foreground,
    fontSize: 12,
    fontFamily: theme.fontFamily.mono,
  },
}));
