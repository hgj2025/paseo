import { appendWorkspaceAgentRows, uniqueConversationRows } from "./unique-conversation-rows";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useToast } from "@/contexts/toast-api-context";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { Button } from "@/components/ui/button";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useCallback, useMemo, useState } from "react";
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
  const key = `${serverId}:${workspaceId}`;
  const entries = useWorkspaceLayoutStore((state) => state.conversationsByWorkspace[key]);
  const activeId = useWorkspaceLayoutStore((state) => state.activeConversationByWorkspace[key]);
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
      );
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
}: {
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
    useWorkspaceLayoutStore.getState().selectConversation(workspaceKey, id);
    onOpenWorkspace();
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
      <Pressable
        accessible={false}
        tabIndex={-1}
        style={[styles.row, selected && styles.selected, !selected && hovered && styles.highlight]}
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
          {ended && <Text style={styles.muted}>{t("conversation.ended")}</Text>}
        </Pressable>
        {agentId && (
          <View
            style={[styles.actions, !showActions && styles.hiddenActions]}
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
          </View>
        )}
      </Pressable>
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
const styles = StyleSheet.create((theme) => ({
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
  hiddenActions: { opacity: 0 },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    flex: 1,
  },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
