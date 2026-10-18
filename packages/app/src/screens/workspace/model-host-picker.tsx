import { useStableEvent } from "@/hooks/use-stable-event";
import { useSessionStore } from "@/stores/session-store";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Combobox } from "@/components/ui/combobox";
import { ToolbarLabelSelectTrigger } from "@/components/ui/toolbar-label-trigger";
import { HostStatusDotSlot } from "@/components/hosts/host-picker";
import { useHosts } from "@/runtime/host-runtime";
import { useWorkspaceScopeOptions } from "@/stores/session-store-hooks";
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
  const selectedHost = context?.candidate?.serverId ?? actualHost;
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
  const serverIds = useMemo(() => hosts.map((h) => h.serverId), [hosts]);
  const scopes = useWorkspaceScopeOptions(serverIds);
  const { actualHost, selectedHost, activeAgentId } = resolveHostSelection(context);
  const currentDirectory = useSessionStore((state) => {
    const session = state.sessions[actualHost ?? ""];
    return (
      session?.agents.get(activeAgentId ?? "")?.cwd ??
      session?.agentDetails.get(activeAgentId ?? "")?.cwd
    );
  });
  const options = useMemo(
    () =>
      chosenHost
        ? scopes
            .filter((s) => s.serverId === chosenHost)
            .map((s) => ({ id: JSON.stringify([s.serverId, s.workspaceId]), label: s.directory }))
        : hosts.map((h) => ({ id: h.serverId, label: h.label || h.serverId })),
    [chosenHost, scopes, hosts],
  );
  const selectScope = (id: string) => {
    const scope = scopes.find((s) => JSON.stringify([s.serverId, s.workspaceId]) === id);
    if (!scope || !context) return;
    context.selectCandidate(scope);
    setOpen(false);
  };
  const select = useStableEvent((id: string) => {
    if (!context?.teamContext?.supportsExecution) {
      toast.error(t("workspace.execution.upgrade"));
      return;
    }
    if (chosenHost) return selectScope(id);
    if (id === selectedHost) {
      setOpen(false);
      return;
    }
    const choices = scopes.filter((s) => s.serverId === id);
    const matching = choices.find((s) => s.directory === currentDirectory);
    if (matching) return selectScope(JSON.stringify([id, matching.workspaceId]));
    setChosenHost(id);
  });
  const openHosts = useStableEvent(() => {
    setChosenHost(null);
    setOpen(true);
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
      {open && (
        <Combobox
          options={options}
          value={selectedHost ?? ""}
          anchorRef={anchor}
          open={open}
          onOpenChange={setOpen}
          onSelect={select}
          keepOpenOnSelect
          desktopPreventInitialFlash
          desktopPlacement="bottom-start"
          desktopMinWidth={240}
          title={t("workspace.execution.chooseHost")}
        />
      )}
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
