import { useRef } from "react";
import type { TeamMember } from "@getpaseo/protocol/workspace-team";
import { useWorkspaceTeamState } from "./use-workspace-team";
import {
  collectAllPanes,
  useWorkspaceLayoutStore,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { deriveWorkspacePaneState } from "./workspace-pane-state";

export function selectVisibleAgentIds(input: {
  layout: WorkspaceLayout | null;
  tabs: WorkspaceTab[];
  /** The workspace sheet's tab, shown over the panes. */
  sheetTab?: WorkspaceTab | null;
  routeFocused: boolean;
  focusedPaneOnly: boolean;
  /** Execution-bound panes register their actual target separately. */
  executionMembers?: readonly Pick<TeamMember, "serverId" | "agentId" | "execution">[];
  serverId?: string;
}): string[] {
  if (!input.routeFocused || !input.layout) {
    return [];
  }
  const panes = input.focusedPaneOnly
    ? collectAllPanes(input.layout.root).filter((pane) => pane.id === input.layout?.focusedPaneId)
    : collectAllPanes(input.layout.root);

  const targets = panes.flatMap((pane) => {
    const target = deriveWorkspacePaneState({ pane, tabs: input.tabs }).activeTab?.descriptor
      .target;
    return target ? [target] : [];
  });
  if (input.sheetTab) targets.push(input.sheetTab.target);
  return [
    ...new Set(
      targets.flatMap((target) => {
        if (target.kind !== "agent") return [];
        const member = input.executionMembers?.find(
          (entry) => entry.serverId === input.serverId && entry.agentId === target.agentId,
        );
        // The pane owns the execution host subscription, even when it is on this host.
        return member?.execution ? [] : [target.agentId];
      }),
    ),
  ].sort();
}

export function useVisibleAgentIds(input: {
  serverId: string;
  workspaceId: string;
  layout: WorkspaceLayout | null;
  tabs: WorkspaceTab[];
  sheetTab: WorkspaceTab | null;
  routeFocused: boolean;
  focusedPaneOnly: boolean;
}): string[] {
  const { context, supported } = useWorkspaceTeamState(
    input.serverId,
    input.workspaceId,
    input.routeFocused,
  );
  const hasConversation = useWorkspaceLayoutStore((state) =>
    Boolean(state.activeConversationByWorkspace[`${input.serverId}:${input.workspaceId}`]),
  );
  const waitingForBindings =
    hasConversation && supported && context?.supportsExecution && !context.team;
  const nextAgentIds = waitingForBindings
    ? []
    : selectVisibleAgentIds({
        ...input,
        executionMembers: context?.team?.members,
      });
  const stableAgentIds = useRef<string[]>([]);
  if (
    stableAgentIds.current.length !== nextAgentIds.length ||
    stableAgentIds.current.some((agentId, index) => agentId !== nextAgentIds[index])
  ) {
    stableAgentIds.current = nextAgentIds;
  }
  return stableAgentIds.current;
}
