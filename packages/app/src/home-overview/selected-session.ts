import {
  collectAllTabs,
  findPaneById,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import type { WorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import {
  parseHostAgentRouteFromPathname,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";
import type { ConversationGroup } from "./model";

type SelectionState = Pick<
  WorkspaceLayoutStore,
  "conversationsByWorkspace" | "activeConversationByWorkspace" | "layoutByWorkspace"
>;

function workspaceAgent(state: SelectionState, scope: { serverId: string; workspaceId: string }) {
  const key = `${scope.serverId}:${scope.workspaceId}`;
  const conversation =
    state.conversationsByWorkspace[key]?.[state.activeConversationByWorkspace[key] ?? ""];
  const layout: WorkspaceLayout | undefined = state.layoutByWorkspace[key] ?? conversation?.layout;
  if (!layout) return null;
  const tabs = collectAllTabs(layout.root);
  const focused = findPaneById(layout.root, layout.focusedPaneId)?.focusedTabId;
  const tab = tabs.find((entry) => entry.tabId === (conversation?.rootTabId ?? focused));
  if (!tab) return null;
  const target = tab.target.kind === "scoped" ? tab.target.target : tab.target;
  return target.kind === "agent"
    ? {
        serverId: tab.target.kind === "scoped" ? tab.target.serverId : scope.serverId,
        agentId: target.agentId,
      }
    : null;
}

export function selectedSessionKey(
  pathname: string,
  state: SelectionState,
  groups: readonly ConversationGroup[],
): string | undefined {
  const scope = parseHostWorkspaceRouteFromPathname(pathname);
  const agent =
    parseHostAgentRouteFromPathname(pathname) ?? (scope ? workspaceAgent(state, scope) : null);
  if (!agent) return undefined;
  const group = groups.find((entry) =>
    entry.members.some(
      (member) =>
        (member.serverId === agent.serverId && member.agentId === agent.agentId) ||
        (member.execution?.serverId === agent.serverId &&
          member.execution.agentId === agent.agentId),
    ),
  );
  const root = group?.root ?? agent;
  return JSON.stringify([root.serverId, root.agentId]);
}
