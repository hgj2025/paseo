import { useEffect, useMemo, useRef, useState, type ReactNode, type ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useStoreWithEqualityFn } from "zustand/traditional";
import equal from "fast-deep-equal";
import { StyleSheet } from "react-native-unistyles";
import { resolveTerminalProfileLaunch } from "@getpaseo/protocol/terminal-profiles";
import { Combobox } from "@/components/ui/combobox";
import { HostStatusDotSlot } from "@/components/hosts/host-picker";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { ImportSessionSheet } from "@/components/import-session-sheet";
import { useToast } from "@/contexts/toast-api-context";
import { PaneProvider, usePaneContext, usePaneFocus } from "@/panels/pane-context";
import {
  getHostRuntimeStore,
  useHosts,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
} from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceFields, useWorkspaceScopeOptions } from "@/stores/session-store-hooks";
import { generateDraftId } from "@/stores/draft-keys";
import { NewTabLauncherProvider, type NewTabLauncher } from "@/workspace-tabs/launcher";
import { scopeWorkspaceTabTarget } from "@/workspace-tabs/scope";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { useWorkspaceCoordinationStore } from "@/stores/workspace-coordination-store";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useHostFeature } from "@/runtime/host-features";

/** The outer workspace owns layout; all resource actions below use this tab's host. */
export function WorkspacePaneSession({ children }: { children: ReactNode }) {
  const pane = usePaneContext();
  const { isInteractive, isWorkspaceFocused } = usePaneFocus();
  const { t } = useTranslation();
  const toast = useToast();
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const workspaces = useWorkspaceScopeOptions(serverIds);
  const workspace = useWorkspaceFields(pane.serverId, pane.workspaceId, (w) => ({
    name: w.title || w.name,
    cwd: w.workspaceDirectory,
    isGit: w.projectKind === "git",
  }));
  const client = useHostRuntimeClient(pane.serverId);
  const connected = useHostRuntimeIsConnected(pane.serverId);
  const active = useRetainedPanelActive();
  const sync = useSessionStore((state) => state.sessions[pane.serverId]?.viewedTimelineSync);
  const agentId = pane.target.kind === "agent" ? pane.target.agentId : null;
  const ownerKey = buildWorkspaceTabPersistenceKey(pane.layoutOwner ?? pane)!;
  useEffect(() => {
    if (!pane.scopeBound || !active || !isWorkspaceFocused || !agentId || !connected) return;
    const key = `scoped-pane:${ownerKey}:${pane.tabId}`;
    void getHostRuntimeStore()
      .prepareAgentTimeline(pane.serverId, agentId)
      .catch(() => undefined);
    sync?.replaceVisibleAgentIds(key, [agentId]);
    return () => sync?.replaceVisibleAgentIds(key, []);
  }, [
    active,
    agentId,
    connected,
    isWorkspaceFocused,
    ownerKey,
    pane.scopeBound,
    pane.serverId,
    pane.tabId,
    sync,
  ]);
  const scopeAnchor = useRef<View>(null);
  const sessionsAnchor = useRef<View>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [creatingTerminal, setCreatingTerminal] = useState(false);
  const [linking, setLinking] = useState(false);
  const coordinator = useWorkspaceCoordinationStore((state) => state.coordinators[ownerKey]);
  const supportsCoordination = useHostFeature(pane.serverId, "remoteAgentCoordination");
  const isCoordinator = coordinator?.serverId === pane.serverId && coordinator.agentId === agentId;
  const linkCoordinator = useStableEvent(async () => {
    if (!coordinator || !agentId || linking) return;
    const primary = getHostRuntimeStore().getSnapshot(coordinator.serverId);
    if (primary?.connectionStatus !== "online" || !primary.client) {
      toast.error(t("workspace.terminal.hostDisconnected"));
      return;
    }
    setLinking(true);
    try {
      const target = { hostId: pane.serverId, workspaceId: pane.workspaceId, agentId, label };
      const instructions =
        coordinator.serverId === pane.serverId
          ? "Use send_agent_prompt with the full agentId for later delegated tasks."
          : "For later delegated tasks, verify this host with list_remote_agents, then use send_remote_agent_prompt with hostId, the full agentId and a fresh requestId UUID. Reuse the requestId for acknowledgement checks; use wait_remote_agent for status and recent output. Do not approve the target agent's permissions on the user's behalf.";
      await primary.client.sendAgentMessage(
        coordinator.agentId,
        `The user added this existing agent to the collaboration workspace: ${JSON.stringify(target)}\n${instructions}\nRecord the collaborator and wait for the user's task. Do not start work just because a pane was linked. Each agent keeps its own host and working directory.`,
      );
      toast.show(t("workspace.crossHost.linked"));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setLinking(false);
    }
  });
  const agents = useStoreWithEqualityFn(
    useSessionStore,
    (state) =>
      Array.from(state.sessions[pane.serverId]?.agents.values() ?? [])
        .filter((agent) => agent.workspaceId === pane.workspaceId && !agent.archivedAt)
        .map((agent) => ({
          id: agent.id,
          label: agent.title || agent.provider,
          description: agent.provider,
        })),
    equal,
  );
  const options = useMemo(
    () =>
      workspaces.map((w) => ({
        id: JSON.stringify([w.serverId, w.workspaceId]),
        label: w.name,
        description: hosts.find((host) => host.serverId === w.serverId)?.label || w.serverId,
      })),
    [hosts, workspaces],
  );
  const label = `${hosts.find((host) => host.serverId === pane.serverId)?.label || pane.serverId} · ${workspace?.name || pane.workspaceId}`;
  const activate = useStableEvent((target: WorkspaceTabTarget) => {
    if (pane.target.kind === "new_tab") pane.retargetCurrentTab(target);
    else pane.openTab(target);
  });
  const value = useMemo(() => ({ ...pane, openImportSheet: () => setImportOpen(true) }), [pane]);
  const launcher = useMemo<NewTabLauncher>(
    () => ({
      showChanges: Boolean(workspace?.isGit),
      showPullRequest: Boolean(workspace?.isGit),
      // Browser tabs run in this desktop, not in the remote host.
      showBrowser: false,
      terminalDisabled: !connected || creatingTerminal || !workspace,
      launch: (selection, destination) => {
        const open = (target: WorkspaceTabTarget) =>
          destination.kind === "replace" ? pane.retargetCurrentTab(target) : pane.openTab(target);
        if (selection.kind === "target") return open(selection.target);
        if (selection.kind === "agent") return open({ kind: "draft", draftId: generateDraftId() });
        if (
          selection.kind !== "terminal" ||
          !client ||
          !connected ||
          !workspace ||
          creatingTerminal
        )
          return;
        setCreatingTerminal(true);
        const profile = selection.profile
          ? resolveTerminalProfileLaunch(selection.profile, "")
          : undefined;
        void client
          .createTerminal(workspace.cwd, profile?.name, undefined, {
            workspaceId: pane.workspaceId,
            command: profile?.command,
            args: profile?.args,
          })
          .then((result) => {
            if (!result.terminal) throw new Error(result.error || "Could not create terminal");
            return open({ kind: "terminal", terminalId: result.terminal.id });
          })
          .catch((error) => toast.error(String(error)))
          .finally(() => setCreatingTerminal(false));
      },
    }),
    [client, connected, creatingTerminal, pane, toast, workspace],
  );
  const handleSelectScope = useStableEvent((id: string) => {
    const selected = workspaces.find((w) => JSON.stringify([w.serverId, w.workspaceId]) === id);
    if (selected) activate(scopeWorkspaceTabTarget({ kind: "new_tab" }, selected));
  });
  const handleSelectAgent = useStableEvent((selectedAgentId: string) =>
    activate({ kind: "agent", agentId: selectedAgentId }),
  );
  const openScopes = useStableEvent(() => setScopeOpen(true));
  const openSessions = useStableEvent(() => setSessionsOpen(true));
  const closeImport = useStableEvent(() => setImportOpen(false));
  const handleMakeCoordinator = useStableEvent(() => {
    if (!agentId) return;
    if (!supportsCoordination) {
      toast.error(t("workspace.crossHost.upgrade"));
      return;
    }
    useWorkspaceCoordinationStore.getState().setCoordinator(ownerKey, {
      serverId: pane.serverId,
      workspaceId: pane.workspaceId,
      agentId,
    });
  });
  const handleImported = useStableEvent(
    (
      agent: Parameters<NonNullable<ComponentProps<typeof ImportSessionSheet>["onImported"]>>[0],
    ) => {
      if (agent.workspaceId)
        activate(
          scopeWorkspaceTabTarget(
            { kind: "agent", agentId: agent.id },
            { serverId: pane.serverId, workspaceId: agent.workspaceId },
          ),
        );
    },
  );
  const renderToolbar = () =>
    pane.host === "main" && (
      <View style={styles.toolbar} testID="workspace-pane-scope-bar">
        <Combobox
          options={options}
          value={JSON.stringify([pane.serverId, pane.workspaceId])}
          anchorRef={scopeAnchor}
          open={scopeOpen}
          onOpenChange={setScopeOpen}
          title={t("workspace.crossHost.chooseScope")}
          desktopPlacement="bottom-start"
          desktopMinWidth={320}
          onSelect={handleSelectScope}
        />
        <View ref={scopeAnchor} collapsable={false} style={styles.scope}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("workspace.crossHost.chooseScope")}
            testID="workspace-pane-choose-scope"
            onPress={openScopes}
            style={styles.trigger}
          >
            <HostStatusDotSlot serverId={pane.serverId} />
            <Text style={styles.label} numberOfLines={1}>
              {label}
            </Text>
            <Text style={styles.label}>⌄</Text>
          </Pressable>
        </View>
        <Combobox
          options={agents}
          value={pane.target.kind === "agent" ? pane.target.agentId : ""}
          anchorRef={sessionsAnchor}
          open={sessionsOpen}
          onOpenChange={setSessionsOpen}
          title={t("workspace.crossHost.sessions")}
          desktopPlacement="bottom-start"
          desktopMinWidth={300}
          onSelect={handleSelectAgent}
        />
        <View ref={sessionsAnchor} collapsable={false}>
          <Pressable
            accessibilityRole="button"
            testID="workspace-pane-choose-session"
            onPress={openSessions}
            style={styles.trigger}
          >
            <Text style={styles.label}>{t("workspace.crossHost.sessions")}</Text>
          </Pressable>
        </View>
        {agentId && (
          <Pressable
            accessibilityRole="button"
            testID="workspace-pane-set-coordinator"
            onPress={handleMakeCoordinator}
            style={styles.trigger}
          >
            <Text style={styles.label}>
              {t(
                isCoordinator
                  ? "workspace.crossHost.coordinator"
                  : "workspace.crossHost.makeCoordinator",
              )}
            </Text>
          </Pressable>
        )}
        {agentId && coordinator && !isCoordinator && (
          <Pressable
            accessibilityRole="button"
            testID="workspace-pane-link-coordinator"
            disabled={linking}
            onPress={linkCoordinator}
            style={styles.trigger}
          >
            <Text style={styles.label}>{t("workspace.crossHost.link")}</Text>
          </Pressable>
        )}
      </View>
    );
  const body = (
    <>
      {renderToolbar()}
      {pane.scopeBound && !connected && (
        <Text style={styles.offline}>{t("workspace.crossHost.offline")}</Text>
      )}
      <View style={styles.content}>{children}</View>
      <ImportSessionSheet
        visible={isInteractive && importOpen}
        client={client}
        serverId={pane.serverId}
        cwd={workspace?.cwd}
        workspaceId={pane.workspaceId}
        onClose={closeImport}
        onImportedAgent={handleSelectAgent}
        onImported={handleImported}
      />
    </>
  );
  return (
    <PaneProvider value={value}>
      {pane.scopeBound ? (
        <NewTabLauncherProvider value={launcher}>{body}</NewTabLauncherProvider>
      ) : (
        body
      )}
    </PaneProvider>
  );
}

const styles = StyleSheet.create((theme) => ({
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  scope: { flex: 1, minWidth: 0 },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  label: { color: theme.colors.foregroundMuted, fontSize: 12, flexShrink: 1 },
  offline: { padding: 12, color: theme.colors.foregroundMuted },
  content: { flex: 1, minHeight: 0 },
}));
