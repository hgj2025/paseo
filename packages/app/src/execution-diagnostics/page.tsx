import { useRouter } from "expo-router";
import { Button } from "@/components/ui/button";
import { buildSettingsSectionRoute } from "@/utils/host-routes";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { getIsElectronMac } from "@/constants/platform";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { getHostRuntimeStore, useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { diagnosticCache } from "./cache";
import { diagnosticHistoryRequest, readDiagnosticPage, type DiagnosticHistory } from "./history";
import { ExecutionDiagnosticPageView, type DiagnosticSessionRow } from "./page-view";

export function ExecutionDiagnosticPage() {
  const router = useRouter();
  const { t } = useTranslation();
  return getIsElectronMac() ? (
    <>
      <Button
        size="sm"
        variant="ghost"
        onPress={() => router.replace(buildSettingsSectionRoute("diagnostics"))}
      >
        {t("executionDiagnostics.backToDiagnostics")}
      </Button>
      <ConnectedDiagnosticPage />
    </>
  ) : null;
}
function ConnectedDiagnosticPage() {
  const { t } = useTranslation();
  const hosts = useHosts();
  const [host, setHost] = useState<string | null>(null);
  const serverId = hosts.some((entry) => entry.serverId === host)
    ? host
    : (hosts[0]?.serverId ?? null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const historyList = useAgentHistory({
    serverId,
    enabled: serverId !== null,
    search: debouncedSearch,
  });
  const [selected, setSelected] = useState<DiagnosticSessionRow | null>(null);
  const [historyWindow, setHistoryWindow] = useState<DiagnosticHistory | undefined>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const revision = useSyncExternalStore(
    diagnosticCache.subscribe,
    diagnosticCache.getVersion,
    diagnosticCache.getVersion,
  );
  const connected = useHostRuntimeIsConnected(selected?.serverId ?? serverId ?? "");
  useEffect(() => {
    generation.current++;
    setSelected(null);
    setHistoryWindow(undefined);
    setLoading(false);
    setFailed(false);
  }, [serverId]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const selectHost = (id: string) => {
    generation.current++;
    setSelected(null);
    setHistoryWindow(undefined);
    setSearch("");
    setDebouncedSearch("");
    setHost(id);
  };
  const selectSession = (session: DiagnosticSessionRow) => {
    generation.current++;
    setSelected(session);
    setHistoryWindow(undefined);
    setLoading(false);
    setFailed(false);
  };
  const loadHistory = useCallback(
    async (older = false) => {
      if (!selected || loading) return;
      const client = getHostRuntimeStore().getSnapshot(selected.serverId)?.client;
      if (!client || !connected) {
        setFailed(true);
        return;
      }
      const request = ++generation.current;
      setLoading(true);
      setFailed(false);
      try {
        const previous = older ? historyWindow : undefined;
        const payload = await client.fetchAgentTimeline(
          selected.id,
          diagnosticHistoryRequest(previous),
        );
        if (generation.current !== request) return;
        const next = readDiagnosticPage(payload, previous);
        diagnosticCache.ingest(selected.serverId, selected.id, next.items, [], {
          live: false,
          connected,
          now: performance.now(),
        });
        setHistoryWindow(next);
      } catch {
        if (generation.current === request) setFailed(true);
      } finally {
        if (generation.current === request) setLoading(false);
      }
    },
    [selected, loading, connected, historyWindow],
  );
  return (
    <SettingsSection title={t("executionDiagnostics.pageTitle")}>
      <ExecutionDiagnosticPageView
        hosts={hosts}
        serverId={serverId}
        selectHost={selectHost}
        search={search}
        setSearch={setSearch}
        sessions={historyList.agents.filter((agent) => agent.serverId === serverId)}
        selected={selected}
        selectSession={selectSession}
        records={(hostId, agentId) => diagnosticCache.get(hostId, agentId)}
        revision={revision}
        loading={historyList.isLoading || historyList.isLoadingMore}
        listFailed={historyList.isError || historyList.hostErrors.length > 0}
        hasMore={historyList.hasMore}
        loadMore={historyList.loadMore}
        refresh={() => {
          void historyList.refreshAll();
        }}
        loadingHistory={loading}
        historyFailed={failed}
        connected={connected}
        hasOlder={Boolean(historyWindow?.hasOlder)}
        loadHistory={(older) => {
          void loadHistory(older);
        }}
        clear={() => {
          diagnosticCache.clear();
        }}
      />
    </SettingsSection>
  );
}
