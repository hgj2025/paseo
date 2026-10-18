import {
  useConversationHistory,
  ConversationHistoryProvider,
} from "./conversation-history-context";
import { ModelHostProvider } from "./model-host-context";
import { useIsCompactFormFactor } from "@/constants/layout";
import { activeConversation } from "@/stores/conversation-layout";
import {
  useWorkspaceLayoutStore,
  collectAllPanes,
  findPaneContainingTab,
} from "@/stores/workspace-layout-store";
import { EXPLORER_SIDEBAR_PANE_ID } from "@/stores/workspace-layout-actions";
import { useEffect, useMemo, useRef, useState, type ReactNode, type ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useStoreWithEqualityFn } from "zustand/traditional";
import equal from "fast-deep-equal";
import { StyleSheet } from "react-native-unistyles";
import { resolveTerminalProfileLaunch } from "@getpaseo/protocol/terminal-profiles";
import { Combobox } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { ToolbarLabelSelectTrigger } from "@/components/ui/toolbar-label-trigger";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MessagesSquare } from "lucide-react-native";
import { WorkspaceToolbarProvider } from "@/composer/workspace-toolbar-context";
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
import { WorkspaceTeamProvider } from "./workspace-team-context";
import { TeamMemberCard } from "./team-member-card";
import { useWorkspaceTeamState } from "./use-workspace-team";
import { useStableEvent } from "@/hooks/use-stable-event";

function useScopeAgents(serverId: string, workspaceId: string) {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) =>
      Array.from(state.sessions[serverId]?.agents.values() ?? [])
        .filter((agent) => agent.workspaceId === workspaceId && !agent.archivedAt)
        .map((agent) => ({
          id: agent.id,
          label: agent.title || agent.provider,
          description: agent.provider,
        })),
    equal,
  );
}
function isMemberBound(
  pane: ReturnType<typeof usePaneContext>,
  member: ReturnType<typeof usePaneTeam>["member"],
  teamContext: ReturnType<typeof usePaneTeam>["teamContext"],
  conversationSlot: boolean,
) {
  return (
    Boolean(member && teamContext?.team?.sessionId) ||
    (conversationSlot &&
      pane.host === "main" &&
      (pane.target.kind === "agent" || pane.target.kind === "draft"))
  );
}

/** The outer workspace owns layout; all resource actions below use this tab's host. */
export function WorkspacePaneSession({ children }: { children: ReactNode }) {
  const compact = useIsCompactFormFactor();
  const anchorPane = usePaneContext();
  const { isInteractive, isWorkspaceFocused } = usePaneFocus();
  const active = useRetainedPanelActive();
  const anchorConnected = useHostRuntimeIsConnected(anchorPane.serverId);
  const ownerKey = buildWorkspaceTabPersistenceKey(anchorPane.layoutOwner ?? anchorPane)!;
  const { member, teamContext, retryTeam, memberPaneId } = usePaneTeam({
    pane: anchorPane,
    ownerKey,
    active,
    isWorkspaceFocused,
    agentId: anchorPane.target.kind === "agent" ? anchorPane.target.agentId : null,
    connected: anchorConnected,
  });
  const execution = member?.execution;
  const pane = useMemo(
    () =>
      execution && anchorPane.target.kind === "agent"
        ? {
            ...anchorPane,
            serverId: execution.serverId,
            workspaceId: execution.workspaceId,
            scopeBound: true,
            target: { kind: "agent" as const, agentId: execution.agentId },
            openTab: (target: WorkspaceTabTarget) =>
              anchorPane.openTab(scopeWorkspaceTabTarget(target, execution)),
            openPreferredTarget: (
              target: WorkspaceTabTarget,
              source: Parameters<typeof anchorPane.openPreferredTarget>[1],
            ) => anchorPane.openPreferredTarget(scopeWorkspaceTabTarget(target, execution), source),
            openTargetToSide: anchorPane.openTargetToSide
              ? (target: WorkspaceTabTarget) =>
                  anchorPane.openTargetToSide!(scopeWorkspaceTabTarget(target, execution))
              : undefined,
            openFileInWorkspace: (
              request: Parameters<typeof anchorPane.openFileInWorkspace>[0],
            ) => {
              const file = scopeWorkspaceTabTarget(
                { kind: "file", ...request.location },
                execution,
              );
              if (request.disposition === "side" && anchorPane.openTargetToSide)
                anchorPane.openTargetToSide(file);
              else anchorPane.openTab(file);
            },
          }
        : anchorPane,
    [anchorPane, execution],
  );
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
  const sync = useSessionStore((state) => state.sessions[pane.serverId]?.viewedTimelineSync);
  const agentId = pane.target.kind === "agent" ? pane.target.agentId : null;
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
  const modelHostContext = useMemo(
    () => conversationHostContext(pane, ownerKey, memberPaneId, member, teamContext),
    [pane, ownerKey, memberPaneId, member, teamContext],
  );
  const agents = useScopeAgents(pane.serverId, pane.workspaceId);
  const options = useMemo(
    () =>
      workspaces.map((w) => ({
        id: JSON.stringify([w.serverId, w.workspaceId]),
        label: w.name,
        description: hosts.find((host) => host.serverId === w.serverId)?.label || w.serverId,
      })),
    [hosts, workspaces],
  );
  const { label, fullScopeLabel } = getScopeLabels(pane, hosts, workspace?.name);
  const conversationSlot = useWorkspaceLayoutStore((state) =>
    Boolean(activeConversation(state, ownerKey)),
  );
  const memberBound = isMemberBound(pane, member, teamContext, conversationSlot);
  const hasComposer = pane.target.kind === "agent" || pane.target.kind === "draft";
  const toolbarPlacement = getPaneToolbarPlacement(memberBound, compact, hasComposer);
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
    if (memberBound) return;
    if (selected) activate(scopeWorkspaceTabTarget({ kind: "new_tab" }, selected));
  });
  const handleSelectAgent = useStableEvent((selectedAgentId: string) =>
    activate({ kind: "agent", agentId: selectedAgentId }),
  );
  const openScopes = useStableEvent(() => setScopeOpen(true));
  const openSessions = useStableEvent(() => setSessionsOpen(true));
  const closeImport = useStableEvent(() => setImportOpen(false));
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
  const toolbar = pane.host === "main" && (
    <View style={styles.toolbar} testID="workspace-pane-scope-bar">
      {member && <TeamMemberCard member={member} />}
      <Combobox
        options={options}
        value={JSON.stringify([pane.serverId, pane.workspaceId])}
        anchorRef={scopeAnchor}
        open={scopeOpen}
        onOpenChange={setScopeOpen}
        title={t("workspace.crossHost.chooseScope")}
        desktopPlacement="top-start"
        desktopMinWidth={320}
        onSelect={handleSelectScope}
      />
      <View ref={scopeAnchor} collapsable={false} style={styles.scope}>
        <HostStatusDotSlot serverId={pane.serverId} />
        <View style={styles.scopeLabel}>
          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarLabelSelectTrigger
                accessibilityRole="button"
                accessibilityLabel={t("workspace.crossHost.chooseScope")}
                accessibilityHint={fullScopeLabel}
                testID="workspace-pane-choose-scope"
                onPress={memberBound ? undefined : openScopes}
                label={label}
                open={scopeOpen}
              />
            </TooltipTrigger>
            <TooltipContent side="top">
              <Text style={styles.tooltip}>{fullScopeLabel}</Text>
            </TooltipContent>
          </Tooltip>
        </View>
      </View>
      <Combobox
        options={agents}
        value={agentId ?? ""}
        anchorRef={sessionsAnchor}
        open={sessionsOpen}
        onOpenChange={setSessionsOpen}
        title={t("workspace.crossHost.sessions")}
        desktopPlacement="top-start"
        desktopMinWidth={300}
        onSelect={handleSelectAgent}
      />
      {!memberBound && (
        <View ref={sessionsAnchor} collapsable={false}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                leftIcon={MessagesSquare}
                accessibilityLabel={t("workspace.crossHost.sessions")}
                testID="workspace-pane-choose-session"
                onPress={openSessions}
              />
            </TooltipTrigger>
            <TooltipContent side="top">
              <Text style={styles.tooltip}>{t("workspace.crossHost.sessions")}</Text>
            </TooltipContent>
          </Tooltip>
        </View>
      )}
    </View>
  );
  const body = (
    <>
      {toolbarPlacement.top && <View style={styles.footer}>{toolbar}</View>}
      <PaneConnectionNotice
        context={teamContext}
        retryTeam={retryTeam}
        scopeBound={pane.scopeBound}
        connected={connected}
      />
      <View style={styles.content}>{children}</View>
      {toolbarPlacement.bottom && toolbar && <View style={styles.footer}>{toolbar}</View>}
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
  const scopedBody = pane.scopeBound ? (
    <NewTabLauncherProvider value={launcher}>{body}</NewTabLauncherProvider>
  ) : (
    body
  );
  return (
    <PaneProvider value={value}>
      <WorkspaceTeamProvider value={teamContext}>
        <ModelHostProvider value={modelHostContext}>
          <ConversationHistoryProvider member={member}>
            <ConversationHistoryNotice />
            <WorkspaceToolbarProvider value={toolbarPlacement.composer ? toolbar : null}>
              {scopedBody}
            </WorkspaceToolbarProvider>
          </ConversationHistoryProvider>
        </ModelHostProvider>
      </WorkspaceTeamProvider>
    </PaneProvider>
  );
}

function getPaneToolbarPlacement(memberBound: boolean, compact: boolean, hasComposer: boolean) {
  return {
    top: memberBound && compact,
    bottom: !memberBound && !hasComposer,
    composer: hasComposer && !memberBound,
  };
}

function PaneConnectionNotice({
  context,
  retryTeam,
  scopeBound,
  connected,
}: {
  context: ReturnType<typeof usePaneTeam>["teamContext"];
  retryTeam(): void;
  scopeBound?: boolean;
  connected: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {" "}
      {context?.error && (
        <Pressable onPress={retryTeam}>
          <Text style={styles.offline}>
            {context.error} · {t("workspace.team.retry")}
          </Text>
        </Pressable>
      )}
      {scopeBound && !connected && (
        <Text style={styles.offline}>{t("workspace.crossHost.offline")}</Text>
      )}
    </>
  );
}

function getScopeLabels(
  pane: ReturnType<typeof usePaneContext>,
  hosts: ReturnType<typeof useHosts>,
  workspaceName: string | undefined,
) {
  const hostLabel = hosts.find((host) => host.serverId === pane.serverId)?.label || pane.serverId;
  const fullScopeLabel = `${hostLabel} · ${workspaceName || pane.workspaceId}`;
  const owner = pane.layoutOwner ?? pane;
  const isOwnerScope = owner.serverId === pane.serverId && owner.workspaceId === pane.workspaceId;
  return { label: isOwnerScope ? hostLabel : fullScopeLabel, fullScopeLabel };
}

function usePaneTeam({
  pane,
  ownerKey,
  active,
  isWorkspaceFocused,
  agentId,
  connected,
}: {
  pane: ReturnType<typeof usePaneContext>;
  ownerKey: string;
  active: boolean;
  isWorkspaceFocused: boolean;
  agentId: string | null;
  connected: boolean;
}) {
  const [joinError, setJoinError] = useState<string | null>(null);
  const owner = pane.layoutOwner ?? pane;
  const conversation = useWorkspaceLayoutStore((state) => activeConversation(state, ownerKey));
  const memberPaneId = useWorkspaceLayoutStore((state) => {
    const layout = state.layoutByWorkspace[ownerKey];
    return layout ? findPaneContainingTab(layout.root, pane.tabId)?.id : undefined;
  });
  const isRoot = conversation?.rootTabId === pane.tabId;
  const hasSplit = useWorkspaceLayoutStore((state) => {
    const layout = state.layoutByWorkspace[ownerKey];
    return Boolean(
      layout &&
      collectAllPanes(layout.root).filter(
        (entry) => !entry.hidden && entry.id !== EXPLORER_SIDEBAR_PANE_ID,
      ).length > 1,
    );
  });
  const {
    context,
    connected: ownerConnected,
    supported: supportsTeams,
    retry,
  } = useWorkspaceTeamState(owner.serverId, owner.workspaceId, active && isWorkspaceFocused);
  const team = context?.team;
  const executeTeam = context?.execute;
  const member = team?.members.find(
    (entry) => entry.serverId === pane.serverId && entry.agentId === agentId,
  );
  const joinBlocked =
    (!conversation && !hasSplit && !team?.members.length) ||
    Boolean(conversation?.endedAt) ||
    Boolean(conversation && !isRoot && !team?.captainId);
  useEffect(() => {
    if (
      joinBlocked ||
      !supportsTeams ||
      !executeTeam ||
      !team ||
      member ||
      !agentId ||
      !connected ||
      !ownerConnected ||
      !active ||
      !isWorkspaceFocused ||
      joinError
    )
      return;
    void executeTeam({
      kind: "join",
      serverId: pane.serverId,
      workspaceId: pane.workspaceId,
      agentId,
      ...(conversation ? { paneId: memberPaneId, owned: true } : {}),
    }).catch((error) => setJoinError(String(error)));
  }, [
    joinBlocked,
    conversation,
    isRoot,
    memberPaneId,
    hasSplit,
    supportsTeams,
    team,
    member,
    agentId,
    connected,
    ownerConnected,
    active,
    isWorkspaceFocused,
    joinError,
    executeTeam,
    pane.serverId,
    pane.workspaceId,
  ]);
  const teamContext = useMemo(
    () => (context ? { ...context, error: joinError || context.error } : null),
    [context, joinError],
  );
  const retryTeam = useStableEvent(() => {
    setJoinError(null);
    retry();
  });
  return { member, teamContext, retryTeam, memberPaneId };
}

const styles = StyleSheet.create((theme) => ({
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 28,
  },
  scope: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginLeft: theme.spacing[1],
  },
  scopeLabel: { minWidth: 0, flexShrink: 1 },
  tooltip: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  footer: { padding: theme.spacing[4] },
  offline: { padding: 12, color: theme.colors.foregroundMuted },
  content: { flex: 1, minHeight: 0 },
}));

function conversationHostContext(
  pane: ReturnType<typeof usePaneContext>,
  ownerKey: string,
  paneId: string | undefined,
  member: ReturnType<typeof usePaneTeam>["member"],
  teamContext: ReturnType<typeof usePaneTeam>["teamContext"],
) {
  if (!paneId || pane.host !== "main" || !teamContext?.team?.sessionId) return null;
  return { ownerKey, paneId, serverId: pane.serverId, member, teamContext };
}

function ConversationHistoryNotice() {
  const history = useConversationHistory();
  const { t } = useTranslation();
  if (!history.error && !history.loading) return null;
  return (
    <Pressable onPress={history.error ? history.retry : undefined}>
      <Text style={styles.offline}>
        {history.error
          ? `${t("workspace.execution.historyUnavailable")} · ${t("workspace.team.retry")}`
          : t("common.states.loading")}
      </Text>
    </Pressable>
  );
}
