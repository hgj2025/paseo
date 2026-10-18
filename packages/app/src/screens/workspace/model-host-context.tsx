import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { TeamMember } from "@getpaseo/protocol/workspace-team";
import type { WorkspaceTeamContextValue } from "./workspace-team-context";
export interface ModelHostAnchor {
  ownerKey: string;
  paneId: string;
  serverId: string;
  member?: TeamMember;
  teamContext: WorkspaceTeamContextValue | null;
}
export interface ExecutionScope {
  serverId: string;
  workspaceId: string;
  directory: string;
}
export interface ModelHostContextValue extends ModelHostAnchor {
  candidate: ExecutionScope | null;
  switching: boolean;
  setSwitching(value: boolean): void;
  selectCandidate(scope: ExecutionScope | null): void;
}
const Context = createContext<ModelHostContextValue | null>(null);
export const useModelHostContext = () => useContext(Context);
export function ModelHostProvider({
  value,
  children,
}: {
  value: ModelHostAnchor | null;
  children: ReactNode;
}) {
  const [candidate, selectCandidate] = useState<ExecutionScope | null>(null);
  const [switching, setSwitching] = useState(false);
  useEffect(() => selectCandidate(null), [value?.member?.execution?.operationId]);
  const context = useMemo(
    () => (value ? { ...value, candidate, selectCandidate, switching, setSwitching } : null),
    [value, candidate, switching],
  );
  return <Context.Provider value={context}>{children}</Context.Provider>;
}
