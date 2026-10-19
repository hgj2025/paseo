import { useStableEvent } from "@/hooks/use-stable-event";
import { v4 as uuid } from "uuid";
import { normalizeWorkspaceDescriptor, useSessionStore } from "@/stores/session-store";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Combobox } from "@/components/ui/combobox";
import { ToolbarLabelSelectTrigger } from "@/components/ui/toolbar-label-trigger";
import { HostStatusDotSlot } from "@/components/hosts/host-picker";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { loadModelHostDestinations, type ModelHostDestination } from "./model-host-destinations";
import { ModelHostDirectoryBrowser } from "./model-host-directory-browser";
import { useToast } from "@/contexts/toast-api-context";
import { useModelHostContext } from "./model-host-context";
export function ModelHostActions({ children }: { children?: ReactNode }) {
  return (
    <View style={styles.actions}>
      <ModelHostPicker />
      {children}
    </View>
  );
}
function resolveHostSelection(context: ReturnType<typeof useModelHostContext>) {
  const actualHost = context?.member?.execution?.serverId ?? context?.serverId;
  const selectedHost = context?.previewHost ?? context?.candidate?.serverId ?? actualHost;
  const activeAgentId = context?.member?.execution?.agentId ?? context?.member?.agentId;
  return { actualHost, selectedHost, activeAgentId };
}
function ModelHostPicker() {
  const context = useModelHostContext(),
    hosts = useHosts(),
    { t } = useTranslation(),
    toast = useToast();
  const anchor = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [chosenHost, setChosenHost] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<ModelHostDestination[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const request = useRef(0);
  const { selectedHost } = resolveHostSelection(context);
  useEffect(() => {
    if (context?.scopeRequested && selectedHost) {
      setChosenHost(selectedHost);
      setOpen(true);
    }
  }, [context?.scopeRequested, selectedHost]);
  const prepareDestination = useStableEvent(
    async (serverId: string, destination: ModelHostDestination) => {
      let scope;
      if (destination.kind === "workspace") scope = destination.scope;
      else {
        const client = getHostRuntimeStore().getClient(serverId);
        if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
        const created = await client.createWorkspace({
          idempotencyKey: uuid(),
          source: {
            kind: "directory",
            path: destination.directory,
            ...(destination.kind === "project" ? { projectId: destination.projectId } : {}),
          },
        });
        if (created.error || !created.workspace)
          throw new Error(created.error ?? t("common.error"));
        const workspace = normalizeWorkspaceDescriptor(created.workspace);
        useSessionStore.getState().mergeWorkspaces(serverId, [workspace]);
        scope = {
          serverId: serverId,
          workspaceId: workspace.id,
          directory: workspace.workspaceDirectory,
        };
      }
      return scope;
    },
  );
  const select = useStableEvent(async (id: string) => {
    if (busy) return;
    if (!context?.teamContext?.supportsExecution) {
      toast.error(t("workspace.execution.upgrade"));
      return;
    }
    const generation = ++request.current;
    setBusy(true);
    setLoadError(null);
    try {
      if (chosenHost) {
        const destination =
          destinations.find((entry) => entry.id === id || entry.label === id) ??
          (id.startsWith("/")
            ? { kind: "directory" as const, id, label: id, directory: id }
            : null);
        if (!destination) return;
        const scope = await prepareDestination(chosenHost, destination);
        if (generation !== request.current) return;
        context.selectCandidate(scope);
        setOpen(false);
        return;
      }
      if (id === selectedHost) {
        setOpen(false);
        return;
      }
      setDestinations([]);
      const client = getHostRuntimeStore().getClient(id);
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      const choices = await loadModelHostDestinations(client, id);
      if (generation !== request.current) return;
      setDestinations(choices);
      setChosenHost(id);
    } catch (error) {
      if (generation !== request.current) return;
      setLoadError(String(error));
      toast.error(String(error));
    } finally {
      if (generation === request.current) setBusy(false);
    }
  });
  const openHosts = useStableEvent(() => {
    ++request.current;
    setChosenHost(null);
    setDestinations([]);
    setBusy(false);
    setLoadError(null);
    setOpen(true);
  });
  const changeOpen = useStableEvent((value: boolean) => {
    if (!value) {
      ++request.current;
      context?.cancelScopeRequest();
    }
    setOpen(value);
  });
  if (!context) return null;
  const label = hosts.find((h) => h.serverId === selectedHost)?.label || selectedHost || "";
  return (
    <View ref={anchor} collapsable={false} style={styles.host}>
      <HostStatusDotSlot serverId={selectedHost ?? ""} />
      {context.member ? (
        <ToolbarLabelSelectTrigger
          label={label}
          open={open}
          accessibilityRole="button"
          accessibilityLabel={`${t("settings.hostPicker.switchHost")}: ${label}`}
          testID="model-host-selector"
          onPress={openHosts}
        />
      ) : (
        <Text style={styles.label}>{label}</Text>
      )}
      {open &&
        (chosenHost ? (
          <ModelHostDirectoryBrowser
            serverId={chosenHost}
            hostLabel={hosts.find((host) => host.serverId === chosenHost)?.label ?? chosenHost}
            initialDirectory={destinations[0]?.label}
            anchorRef={anchor}
            busy={busy}
            onSelect={select}
            onOpenChange={changeOpen}
          />
        ) : (
          <Combobox
            options={
              busy
                ? []
                : hosts.map((host) => ({ id: host.serverId, label: host.label || host.serverId }))
            }
            emptyText={busy ? t("common.loading") : (loadError ?? undefined)}
            value={selectedHost ?? ""}
            anchorRef={anchor}
            open={open}
            onOpenChange={changeOpen}
            onSelect={select}
            keepOpenOnSelect
            desktopPreventInitialFlash
            desktopPlacement="bottom-start"
            desktopMinWidth={240}
            title={t("workspace.execution.chooseHost")}
          />
        ))}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  host: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    maxWidth: 160,
    minWidth: 0,
  },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, flexShrink: 1 },
}));
