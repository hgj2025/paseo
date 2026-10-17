import { useState } from "react";
import type { TeamMember } from "@getpaseo/protocol/workspace-team";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { scopeWorkspaceTabTarget } from "@/workspace-tabs/scope";
import { TeamDashboard } from "./team-dashboard";
import { useWorkspaceTeamState } from "./use-workspace-team";
import { WorkspaceTeamProvider } from "./workspace-team-context";

/** Keep the dialog outside the dropdown so closing the menu does not unmount it. */
export function useWorkspaceTeamMenu(serverId = "", workspaceId = "") {
  const [open, setOpen] = useState(false);
  const { context, supported } = useWorkspaceTeamState(serverId, workspaceId, open);
  const show = useStableEvent(() => setOpen(true));
  const hide = useStableEvent(() => setOpen(false));
  const openMember = useStableEvent((member: TeamMember) => {
    const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
    if (!workspaceKey) return;
    useWorkspaceLayoutStore.getState().openTab({
      workspaceKey,
      target: scopeWorkspaceTabTarget({ kind: "agent", agentId: member.agentId }, member),
      intent: "reveal",
    });
  });
  const content = open && context && (
    <WorkspaceTeamProvider value={context}>
      <TeamDashboard onClose={hide} onOpenMember={openMember} />
    </WorkspaceTeamProvider>
  );
  return { supported, show, content };
}
