import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { CollaborationHealthReport } from "@getpaseo/protocol/collaboration-bridge";
import type { HostRuntimeSnapshot } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
export interface Probe {
  client: DaemonClient;
  connectionId: string | null;
  checkedAt: string;
  latencyMs: number | null;
  error: boolean;
  report?: CollaborationHealthReport;
  supported: boolean;
}
export function HostConnectionView({
  label,
  bordered,
  labels,
  snapshot,
  online,
  probe,
  checking,
}: {
  label: string;
  bordered: boolean;
  labels: { serverId: string; label: string }[];
  snapshot: Pick<HostRuntimeSnapshot, "activeConnection"> | null;
  online: boolean;
  probe: Probe | null;
  checking: boolean;
}) {
  const { t } = useTranslation();
  const status = appHopStatus(online, checking, probe);
  const routes = online ? (probe?.report?.routes ?? []) : [];
  const hint = reportHint(probe, routes.length);
  return (
    <View style={[styles.host, bordered && settingsStyles.rowBorder]}>
      <View style={styles.line}>
        <Text style={settingsStyles.rowTitle}>
          {t("connectionDiagnostics.appHop", { host: label })}
        </Text>
        <Status status={status} latencyMs={status === "ok" ? probe?.latencyMs : null} />
      </View>
      <Text style={settingsStyles.rowHint}>
        {t("connectionDiagnostics.transport")} · {snapshot?.activeConnection?.type ?? "—"}
      </Text>
      {probe && (
        <Text style={settingsStyles.rowHint}>
          {t("connectionDiagnostics.checkedAt", {
            time: new Date(probe.checkedAt).toLocaleTimeString(),
          })}
        </Text>
      )}
      {routes.map((route) => (
        <View key={route.hostId} style={styles.route}>
          <View style={styles.line}>
            <Text style={styles.routeTitle}>
              {label} → {labels.find((h) => h.serverId === route.hostId)?.label ?? route.label}
            </Text>
            <Status status={checking ? "checking" : route.status} latencyMs={route.latencyMs} />
          </View>
          <Text style={settingsStyles.rowHint}>
            {t(`connectionDiagnostics.route.${route.transport}`)}
            {route.error
              ? ` · ${t(`connectionDiagnostics.failure.${route.error as "timeout" | "disconnected" | "unavailable"}`)}`
              : ""}
          </Text>
        </View>
      ))}
      {online && probe && !checking && !probe.error && (
        <Text style={settingsStyles.rowHint}>{t(hint)}</Text>
      )}
    </View>
  );
}
function appHopStatus(online: boolean, checking: boolean, probe: Probe | null): ConnectionStatus {
  if (!online) return "disconnected";
  if (checking) return "checking";
  if (!probe) return "unchecked";
  return probe.error ? "error" : "ok";
}
function reportHint(probe: Probe | null, count: number) {
  if (!probe?.supported) return "connectionDiagnostics.upgrade" as const;
  if (probe.report?.error) return "connectionDiagnostics.reportFailed" as const;
  if (!count) return "connectionDiagnostics.noRoutes" as const;
  return "connectionDiagnostics.readOnly" as const;
}
type ConnectionStatus = "ok" | "error" | "disconnected" | "checking" | "unchecked";
function Status({
  status,
  latencyMs,
}: {
  status: "ok" | "error" | "disconnected" | "checking" | "unchecked";
  latencyMs?: number | null;
}) {
  const { t } = useTranslation();
  let dotStyle = styles.unknown;
  if (status === "ok") dotStyle = styles.good;
  else if (status === "error" || status === "disconnected") dotStyle = styles.bad;
  return (
    <View style={styles.status}>
      <View style={[styles.dot, dotStyle]} />
      <Text style={styles.statusText}>
        {t(`connectionDiagnostics.status.${status}`)}
        {status === "ok" && latencyMs != null ? ` · ${latencyMs} ms` : ""}
      </Text>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  host: { padding: theme.spacing[4], gap: theme.spacing[1] },
  line: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  route: { marginTop: theme.spacing[3], paddingLeft: theme.spacing[4], gap: theme.spacing[1] },
  routeTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, flexShrink: 1 },
  status: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  statusText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  good: { backgroundColor: theme.colors.statusSuccess },
  bad: { backgroundColor: theme.colors.statusDanger },
  unknown: { backgroundColor: theme.colors.foregroundMuted },
}));
