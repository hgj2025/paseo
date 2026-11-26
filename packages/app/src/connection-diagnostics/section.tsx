import { ConnectionGraph, graphPalette, type GraphHost } from "./graph";
import { HostConnectionView, type Probe } from "./view";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import type { CollaborationHealthReport } from "@getpaseo/protocol/collaboration-bridge";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { getIsElectronMac } from "@/constants/platform";
import { getHostRuntimeStore, useHosts, useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";

export function ConnectionDiagnosticSection() {
  const { t } = useTranslation();
  const hosts = useHosts();
  const [refresh, setRefresh] = useState(0);
  const [states, setStates] = useState<Record<string, GraphHost>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const selectedId = selected ?? hosts[0]?.serverId ?? null;
  const updateState = useCallback(
    (state: GraphHost) => setStates((previous) => ({ ...previous, [state.serverId]: state })),
    [],
  );
  const refreshAll = useCallback(() => setRefresh((n) => n + 1), []);
  const refreshButton = useMemo(
    () => (
      <Button size="sm" variant="ghost" onPress={refreshAll}>
        {t("connectionDiagnostics.refresh")}
      </Button>
    ),
    [t, refreshAll],
  );
  if (!getIsElectronMac()) return null;
  return (
    <SettingsSection
      title={t("connectionDiagnostics.title")}
      info={t("connectionDiagnostics.hint")}
      trailing={refreshButton}
    >
      <View style={settingsStyles.card} testID="connection-diagnostics">
        {!hosts.length && (
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>{t("connectionDiagnostics.empty")}</Text>
          </View>
        )}
        <ConnectionGraph
          uniProps={graphPalette}
          hosts={hosts}
          states={states}
          selected={selectedId}
          onSelect={setSelected}
        />
        {hosts.map((host) => (
          <HostConnections
            key={`${host.serverId}:${refresh}`}
            serverId={host.serverId}
            label={host.label}
            visible={host.serverId === selectedId}
            onState={updateState}
            labels={hosts}
          />
        ))}
      </View>
    </SettingsSection>
  );
}
function HostConnections({
  serverId,
  label,
  visible,
  onState,
  labels,
}: {
  serverId: string;
  label: string;
  visible: boolean;
  onState: (state: GraphHost) => void;
  labels: { serverId: string; label: string }[];
}) {
  const state = useHostProbe(serverId);
  useEffect(() => {
    onState({
      serverId,
      label,
      online: state.online,
      checking: state.checking,
      probe: state.probe,
    });
  }, [onState, serverId, label, state.online, state.checking, state.probe]);
  return visible ? <HostConnectionView label={label} bordered labels={labels} {...state} /> : null;
}
function useHostProbe(serverId: string) {
  const snapshot = useHostRuntimeSnapshot(serverId);
  const client = snapshot?.client;
  const online = snapshot?.connectionStatus === "online";
  const connectionId = snapshot?.activeConnectionId ?? null;
  const [savedProbe, setProbe] = useState<Probe | null>(null);
  const probe =
    savedProbe?.client === client && savedProbe?.connectionId === snapshot?.activeConnectionId
      ? savedProbe
      : null;
  const [checking, setChecking] = useState(false);
  const generation = useRef(0);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      let busy = false;
      const own = ++generation.current;
      setProbe(null);
      setChecking(false);
      const check = async () => {
        if (!client || !online || busy) return;
        busy = true;
        setChecking(true);
        const supported =
          client.getLastServerInfoMessage()?.features?.connectionDiagnostics === true;
        const start = performance.now();
        let next: Probe;
        try {
          await client.ping({ timeoutMs: 3000 });
          const latencyMs = Math.round(performance.now() - start);
          // Keep the App hop successful even if owner-to-executor detection fails.
          let report: CollaborationHealthReport | undefined;
          if (supported) {
            try {
              report = await client.getCollaborationHealth();
            } catch {
              report = {
                requestId: "",
                checkedAt: new Date().toISOString(),
                error: "unavailable",
                routes: [],
              };
            }
          }
          next = {
            client,
            connectionId,
            checkedAt: new Date().toISOString(),
            latencyMs,
            error: false,
            report,
            supported,
          };
        } catch {
          next = {
            client,
            connectionId,
            checkedAt: new Date().toISOString(),
            latencyMs: null,
            error: true,
            supported,
          };
        }
        if (
          active &&
          generation.current === own &&
          getHostRuntimeStore().getClient(serverId) === client
        ) {
          setProbe(next);
          setChecking(false);
        }
        busy = false;
      };
      void check();
      const interval = setInterval(() => {
        void check();
      }, 30000);
      return () => {
        active = false;
        clearInterval(interval);
      };
    }, [client, online, serverId, connectionId]),
  );
  return { snapshot, online, probe, checking };
}
