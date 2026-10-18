import { AdaptiveRenameModal } from "@/components/rename-modal";
import { Button } from "@/components/ui/button";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { MessageSquare, Pencil } from "lucide-react-native";
import { DensityIcon } from "@/components/ui/density-icon";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useWorkspaceLayoutStore, collectAllTabs } from "@/stores/workspace-layout-store";
import { conversationTarget } from "@/stores/conversation-layout";
import { useSessionStore } from "@/stores/session-store";

export function SidebarConversationList({
  serverId,
  workspaceId,
  workspaceSelected,
  onOpenWorkspace,
}: {
  serverId: string;
  workspaceId: string;
  workspaceSelected: boolean;
  onOpenWorkspace: () => void;
}) {
  const key = `${serverId}:${workspaceId}`;
  const entries = useWorkspaceLayoutStore((state) => state.conversationsByWorkspace[key]);
  const activeId = useWorkspaceLayoutStore((state) => state.activeConversationByWorkspace[key]);
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents);
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      Object.values(entries ?? {})
        .filter((entry) => !entry.endedAt)
        .map((entry, index) => {
          const root = collectAllTabs(entry.layout.root).find(
            (tab) => tab.tabId === entry.rootTabId,
          );
          const target = root && conversationTarget(root.target);
          const rootServerId = root?.target.kind === "scoped" ? root.target.serverId : serverId;
          const agent = target?.kind === "agent" ? agents?.get(target.agentId) : undefined;
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
    [entries, agents, t, serverId],
  );
  if (!rows.length) return null;
  return (
    <View style={styles.list} testID={`sidebar-conversations-${key}`}>
      {rows.map((row) => (
        <ConversationRow
          key={row.id}
          workspaceKey={key}
          {...row}
          selected={workspaceSelected && row.id === activeId}
          onOpenWorkspace={onOpenWorkspace}
        />
      ))}
    </View>
  );
}

function ConversationRow({
  agentId,
  serverId,
  workspaceKey,
  id,
  title,
  ended,
  selected,
  onOpenWorkspace,
}: {
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
  const enter = useCallback(() => setHovered(true), []);
  const leave = useCallback(() => setHovered(false), []);
  const state = useMemo(() => ({ selected }), [selected]);
  const open = useCallback(() => {
    useWorkspaceLayoutStore.getState().selectConversation(workspaceKey, id);
    onOpenWorkspace();
  }, [workspaceKey, id, onOpenWorkspace]);
  const { t } = useTranslation();
  return (
    <>
      <View
        style={[styles.row, (selected || hovered) && styles.highlight]}
        onPointerEnter={enter}
        onPointerLeave={leave}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={state}
          onPress={open}
          style={styles.rowMain}
          testID={`sidebar-conversation-${id}`}
        >
          <DensityIcon
            icon={MessageSquare}
            size="xs"
            color={selected ? "foreground" : "foregroundMuted"}
          />
          <Text numberOfLines={1} style={[styles.title, ended && styles.muted]}>
            {title}
          </Text>
          {ended && <Text style={styles.muted}>{t("conversation.ended")}</Text>}
        </Pressable>
        {agentId && (selected || hovered) && (
          <Button
            size="xs"
            variant="ghost"
            leftIcon={Pencil}
            onPress={showRename}
            disabled={!client}
            accessibilityLabel={t("workspace.tabs.menu.rename")}
            testID={`sidebar-conversation-rename-${id}`}
          />
        )}
      </View>
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
  list: { paddingLeft: 24, paddingRight: 4, paddingTop: 2, paddingBottom: 6, gap: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    minHeight: 30,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 4,
  },
  highlight: { backgroundColor: theme.colors.surface2 },
  title: { color: theme.colors.foreground, fontSize: 13, flex: 1 },
  muted: { color: theme.colors.foregroundMuted, fontSize: 11 },
}));
