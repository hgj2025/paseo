import { beginNavigationTrace, navigationDispatched } from "@/navigation/diagnostics/collector";
import { AgentStatusDot } from "@/components/agent-status-dot";
import type { ComponentProps } from "react";
import { HistoryHealthBadge } from "@/history-health/badge";
import { SwipeToAction } from "./swipe-to-action";
import { appendWorkspaceAgentRows, uniqueConversationRows } from "./unique-conversation-rows";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useToast } from "@/contexts/toast-api-context";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { Button } from "@/components/ui/button";
import { getHostRuntimeStore, useHosts, useHostRuntimeClient } from "@/runtime/host-runtime";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { Pencil, X } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useWorkspaceLayoutStore, collectAllTabs } from "@/stores/workspace-layout-store";
import { conversationTarget } from "@/stores/conversation-layout";
import { density } from "@/styles/density";
import { isNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSessionStore } from "@/stores/session-store";

export function useSidebarConversations(
  serverId: string,
  workspaceId: string,
  workspaceDirectory?: string,
) {
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const readFreshHosts = () =>
    JSON.stringify(
      hosts
        .filter((host) => {
          const snapshot = runtime.getSnapshot(host.serverId);
          return (
            snapshot?.connectionStatus === "online" && snapshot.agentDirectoryStatus === "ready"
          );
        })
        .map((host) => host.serverId),
    );
  const freshHosts = useSyncExternalStore(
    (notify) => runtime.subscribeAll(notify),
    readFreshHosts,
    readFreshHosts,
  );
  const freshHostIds = useMemo(() => new Set(JSON.parse(freshHosts) as string[]), [freshHosts]);
  const key = `${serverId}:${workspaceId}`;
  const savedEntries = useWorkspaceLayoutStore((state) => state.conversationsByWorkspace[key]);
  const activeLayout = useWorkspaceLayoutStore((state) => state.layoutByWorkspace[key]);
  const activeId = useWorkspaceLayoutStore((state) => state.activeConversationByWorkspace[key]);
  // The active layout is live; saved layouts are snapshots taken on navigation.
  // In particular, sending a draft replaces its target before the snapshot is saved.
  const entries = useMemo(() => {
    if (!activeId || !activeLayout || !savedEntries?.[activeId]) return savedEntries;
    return {
      ...savedEntries,
      [activeId]: { ...savedEntries[activeId], layout: activeLayout },
    };
  }, [savedEntries, activeId, activeLayout]);
  const { t } = useTranslation();
  const rows = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      const agents = state.sessions[serverId]?.agents;
      const represented = new Set<string>();
      for (const entry of Object.values(entries ?? {})) {
        for (const tab of collectAllTabs(entry.layout.root)) {
          const target = conversationTarget(tab.target);
          if (target?.kind !== "agent") continue;
          const host = tab.target.kind === "scoped" ? tab.target.serverId : serverId;
          represented.add(JSON.stringify([host, target.agentId]));
        }
      }
      const savedRows = uniqueConversationRows(
        Object.values(entries ?? {})
          .filter((entry) => !entry.endedAt)
          .map((entry, index) => {
            const root = collectAllTabs(entry.layout.root).find(
              (tab) => tab.tabId === entry.rootTabId,
            );
            const target = root && conversationTarget(root.target);
            const rootServerId = root?.target.kind === "scoped" ? root.target.serverId : serverId;
            const agent =
              target?.kind === "agent"
                ? state.sessions[rootServerId]?.agents.get(target.agentId)
                : undefined;
            // Archived local agents can outlive their roster in a saved conversation layout.
            if (
              target?.kind === "agent" &&
              rootServerId === serverId &&
              agents &&
              (!agent || agent.archivedAt)
            )
              return null;
            const title = agent?.title;
            return {
              id: entry.id,
              agentId: target?.kind === "agent" ? target.agentId : undefined,
              serverId: rootServerId,
              title: title || t("conversation.untitled", { number: index + 1 }),
              ended: Boolean(entry.endedAt),
            };
          })
          .filter((row) => row !== null),
        activeId,
      );
      return appendWorkspaceAgentRows(
        savedRows,
        agents?.values() ?? [],
        serverId,
        workspaceId,
        represented,
        workspaceDirectory,
      ).map((row) => {
        // Root targets can belong to another host; agent IDs alone are not global.
        const agent = row.agentId
          ? state.sessions[row.serverId]?.agents.get(row.agentId)
          : undefined;
        return {
          id: row.id,
          serverId: row.serverId,
          agentId: row.agentId,
          title: row.title,
          ended: row.ended,
          standalone: row.standalone,
          agentWorkspaceId: row.agentWorkspaceId,
          activity:
            agent && !agent.archivedAt && !row.ended
              ? {
                  status:
                    agent.status === "idle" && agent.turn.phase === "open"
                      ? "running"
                      : agent.status,
                  fresh: freshHostIds.has(row.serverId),
                  requiresAttention: agent.requiresAttention,
                  attentionReason: agent.attentionReason,
                  pendingPermissionCount: agent.pendingPermissions.length,
                }
              : undefined,
        };
      });
    },
    equal,
  );
  return rows;
}

export function SidebarConversationList({
  serverId,
  workspaceId,
  rows,
  workspaceSelected,
  onOpenWorkspace,
}: {
  serverId: string;
  workspaceId: string;
  rows: ReturnType<typeof useSidebarConversations>;
  workspaceSelected: boolean;
  onOpenWorkspace: () => void;
}) {
  const key = `${serverId}:${workspaceId}`;
  const activeId = useWorkspaceLayoutStore((state) => state.activeConversationByWorkspace[key]);
  if (!rows.length) return null;
  return (
    <View testID={`sidebar-conversations-${key}`}>
      {rows.map((row) => (
        <ConversationRow
          key={row.id}
          workspaceKey={key}
          ownerServerId={serverId}
          workspaceId={workspaceId}
          {...row}
          selected={workspaceSelected && row.id === activeId}
          onOpenWorkspace={onOpenWorkspace}
        />
      ))}
    </View>
  );
}

function ConversationRow({
  ownerServerId,
  workspaceId,
  agentId,
  serverId,
  workspaceKey,
  id,
  title,
  ended,
  selected,
  onOpenWorkspace,
  standalone = false,
  agentWorkspaceId,
  activity,
}: {
  activity?: ComponentProps<typeof AgentStatusDot> & { fresh: boolean };
  standalone?: boolean;
  agentWorkspaceId?: string;
  ownerServerId: string;
  workspaceId: string;
  agentId?: string;
  serverId: string;
  workspaceKey: string;
  id: string;
  title: string;
  ended: boolean;
  selected: boolean;
  onOpenWorkspace: () => void;
}) {
  const client = useHostRuntimeClient(serverId);
  const ownerClient = useHostRuntimeClient(ownerServerId);
  const toast = useToast();
  const [closing, setClosing] = useState(false);
  const [editing, setEditing] = useState(false);
  const showRename = useCallback(() => setEditing(true), []);
  const closeRename = useCallback(() => setEditing(false), []);
  const saveName = useCallback(
    async (value: string) => {
      if (!client || !agentId) throw new Error("Host disconnected");
      await client.updateAgent(agentId, { name: value.trim() });
    },
    [client, agentId],
  );
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const focus = useCallback(() => setFocused(true), []);
  const blur = useCallback(() => setFocused(false), []);
  const compact = useIsCompactFormFactor();
  const showActions = hovered || focused || isNative || compact;
  const enter = useCallback(() => setHovered(true), []);
  const leave = useCallback(() => setHovered(false), []);
  const state = useMemo(() => ({ selected }), [selected]);
  const open = useCallback(() => {
    if (standalone && agentId) {
      onOpenWorkspace();
      navigateToAgent({ serverId, workspaceId: agentWorkspaceId ?? workspaceId, agentId });
      return;
    }
    const trace = agentId ? beginNavigationTrace({ serverId, agentId, workspaceId }) : undefined;
    useWorkspaceLayoutStore.getState().selectConversation(workspaceKey, id);
    onOpenWorkspace();
    navigationDispatched(trace);
  }, [
    standalone,
    agentId,
    serverId,
    workspaceId,
    workspaceKey,
    id,
    onOpenWorkspace,
    agentWorkspaceId,
  ]);
  const { t } = useTranslation();
  const close = useCallback(async () => {
    if (!ownerClient || closing) return;
    if (
      !(await confirmDialog({
        title: t("conversation.end"),
        message: t("conversation.endDescription"),
        confirmLabel: t("common.actions.confirm"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      }))
    )
      return;
    setClosing(true);
    try {
      if (standalone && agentId) {
        await ownerClient.archiveAgent(agentId);
        return;
      }
      const result = await ownerClient.workspaceTeam(workspaceId, { kind: "end" }, id);
      if (result.status !== "ended")
        throw new Error(
          Object.values(result.archiveErrors ?? {}).join("\n") || "Conversation is still ending.",
        );
      useWorkspaceLayoutStore.getState().endConversation(workspaceKey, id);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setClosing(false);
    }
  }, [ownerClient, closing, t, workspaceId, id, workspaceKey, toast, standalone, agentId]);

  return (
    <>
      <SwipeToAction
        enabled={compact}
        disabled={!ownerClient || closing || !agentId}
        label={t("conversation.end")}
        onAction={close}
        testID={`conversation-swipe-${id}`}
      >
        <Pressable
          accessible={false}
          tabIndex={-1}
          style={[
            styles.row,
            selected && styles.selected,
            !selected && hovered && styles.highlight,
          ]}
          onHoverIn={enter}
          onHoverOut={leave}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={title}
            accessibilityState={state}
            onPress={open}
            onFocus={focus}
            onBlur={blur}
            style={styles.rowMain}
            testID={`sidebar-conversation-${id}`}
          >
            <Text numberOfLines={1} style={[styles.title, ended && styles.muted]}>
              {title}
            </Text>
            {agentId && <HistoryHealthBadge serverId={serverId} agentId={agentId} />}
            {ended && <Text style={styles.muted}>{t("conversation.ended")}</Text>}
            {activity && <ConversationActivity activity={activity} />}
          </Pressable>
          {agentId && (
            <View
              style={[
                styles.actions,
                compact && styles.compactActions,
                !showActions && styles.hiddenActions,
              ]}
              pointerEvents={showActions ? "auto" : "none"}
            >
              <Button
                size="xs"
                variant="ghost"
                leftIcon={Pencil}
                onPress={showRename}
                onFocus={focus}
                onBlur={blur}
                disabled={!client}
                accessibilityLabel={t("workspace.tabs.menu.rename")}
                testID={`sidebar-conversation-rename-${id}`}
              />
              {!compact && (
                <Button
                  size="xs"
                  variant="ghost"
                  leftIcon={X}
                  onPress={close}
                  onFocus={focus}
                  onBlur={blur}
                  disabled={!ownerClient || closing}
                  accessibilityLabel={t("conversation.end")}
                  testID={`sidebar-conversation-close-${id}`}
                />
              )}
            </View>
          )}
        </Pressable>
      </SwipeToAction>
      <AdaptiveRenameModal
        visible={editing}
        title={t("workspace.tabs.menu.renameAgent")}
        initialValue={title}
        maxLength={200}
        onClose={closeRename}
        onSubmit={saveName}
        testID="sidebar-conversation-rename-modal"
      />
    </>
  );
}
function ConversationActivity({
  activity,
}: {
  activity: ComponentProps<typeof AgentStatusDot> & { fresh: boolean };
}) {
  const { t } = useTranslation();
  if (activity.fresh) return <AgentStatusDot {...activity} showInactive />;
  return <View accessibilityLabel={t("homeOverview.state.unknown")} style={styles.unknownStatus} />;
}

const styles = StyleSheet.create((theme) => ({
  unknownStatus: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundExtraMuted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: density.rowHeight,
    paddingHorizontal: theme.spacing[2],
    paddingLeft: theme.spacing[8],
    borderRadius: theme.borderRadius.md,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    minHeight: density.rowHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  selected: { backgroundColor: theme.colors.surfaceSidebarSelected },
  highlight: { backgroundColor: theme.colors.surfaceSidebarHover },
  actions: {
    flexDirection: "row",
    width: 56,
    height: 28,
    justifyContent: "center",
  },
  compactActions: { width: 44, height: 44, alignItems: "center" },
  hiddenActions: { opacity: 0 },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    flex: 1,
  },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
