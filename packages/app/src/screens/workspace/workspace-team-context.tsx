import { createContext, useContext, type ReactNode } from "react";
import type { TeamAction, WorkspaceTeam } from "@getpaseo/protocol/workspace-team";

export interface WorkspaceTeamContextValue {
  team: WorkspaceTeam | null;
  supportsGroups: boolean;
  supportsExecution?: boolean;
  ownerServerId: string;
  workspaceId: string;
  error: string | null;
  execute(action: TeamAction): Promise<WorkspaceTeam>;
}
const Context = createContext<WorkspaceTeamContextValue | null>(null);
export const useWorkspaceTeam = () => useContext(Context);
export function WorkspaceTeamProvider({
  value,
  children,
}: {
  value: WorkspaceTeamContextValue | null;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
