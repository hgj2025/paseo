import { useWorkspaceTeamState } from "./use-workspace-team";
import { WorkspaceTeamProvider } from "./workspace-team-context";
import { TeamMemberCard } from "./team-member-card";

export function usePaneHeaderMember(serverId: string, workspaceId: string, paneId?: string) {
  const { context } = useWorkspaceTeamState(serverId, workspaceId, Boolean(paneId));
  const member = context?.team?.sessionId
    ? context.team.members.find((entry) => entry.paneId === paneId)
    : undefined;
  return { member, context };
}
export function PaneMemberHeader({
  serverId,
  workspaceId,
  paneId,
}: {
  serverId: string;
  workspaceId: string;
  paneId?: string;
}) {
  const { member, context } = usePaneHeaderMember(serverId, workspaceId, paneId);
  if (!member || !context) return null;
  return (
    <WorkspaceTeamProvider value={context}>
      <TeamMemberCard member={member} iconOnly />
    </WorkspaceTeamProvider>
  );
}
