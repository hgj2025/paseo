import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useWorkspaceTeamState } from "./use-workspace-team";
import { WorkspaceTeamProvider } from "./workspace-team-context";
import { TeamMemberCard } from "./team-member-card";
import { HostStatusDotSlot } from "@/components/hosts/host-picker";
import { useHosts } from "@/runtime/host-runtime";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
  const hosts = useHosts();
  if (!member || !context) return null;
  const label =
    hosts.find((host) => host.serverId === (member.execution?.serverId ?? member.serverId))
      ?.label ||
    (member.execution?.serverId ?? member.serverId);
  return (
    <WorkspaceTeamProvider value={context}>
      <View style={styles.row} testID={`pane-member-header-${paneId}`}>
        <TeamMemberCard member={member} iconOnly />
        <Tooltip>
          <TooltipTrigger asChild>
            <View style={styles.host}>
              <HostStatusDotSlot serverId={member.execution?.serverId ?? member.serverId} />
              <Text numberOfLines={1} style={styles.label}>
                {label}
              </Text>
            </View>
          </TooltipTrigger>
          <TooltipContent>
            <Text>{label}</Text>
          </TooltipContent>
        </Tooltip>
      </View>
    </WorkspaceTeamProvider>
  );
}
const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 200,
  },
  host: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1, minWidth: 0 },
  label: { color: theme.colors.foregroundMuted, fontSize: 12, flexShrink: 1 },
}));
