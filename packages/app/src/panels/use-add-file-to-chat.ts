import { useCallback, useMemo } from "react";
import { createWorkspaceFileAttachment } from "@/attachments/workspace-file";
import { resolveFocusedChatTarget } from "@/composer/focused-chat-target";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey, type WorkspaceScope } from "@/workspace-tabs/model";

export function useAddFileToChat(input: {
  serverId: string;
  workspaceId?: string | null;
  layoutOwner?: WorkspaceScope;
}) {
  const owner = input.layoutOwner ?? input;
  const workspaceKey = owner.workspaceId
    ? buildWorkspaceTabPersistenceKey({ serverId: owner.serverId, workspaceId: owner.workspaceId })
    : null;
  const layout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined,
  );
  const focusTab = useWorkspaceLayoutStore((state) => state.focusTab);
  const focusedChat = useMemo(
    () =>
      resolveFocusedChatTarget({
        serverId: input.serverId,
        workspaceId: input.workspaceId,
        layoutOwner: input.layoutOwner,
        layout,
      }),
    [input.serverId, input.workspaceId, input.layoutOwner, layout],
  );
  const addFile = useCallback(
    async (filePath: string) => {
      if (!focusedChat || !workspaceKey) {
        return;
      }
      await useDraftStore.getState().attachWorkspaceFile({
        draftKey: focusedChat.draftKey,
        attachment: createWorkspaceFileAttachment({ path: filePath }),
      });
      focusTab(workspaceKey, focusedChat.tabId);
    },
    [focusTab, focusedChat, workspaceKey],
  );
  return { addFile, canAddToChat: focusedChat !== null };
}
