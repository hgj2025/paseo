import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
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
  previewHost: string | null;
  selectHost(serverId: string): void;
  scopeRequested: boolean;
  requestScope(): Promise<ExecutionScope | null>;
  cancelScopeRequest(): void;
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
  const [candidate, setCandidate] = useState<ExecutionScope | null>(null);
  const [previewHost, setPreviewHost] = useState<string | null>(null);
  const [scopeRequested, setScopeRequested] = useState(false);
  const pendingScope = useRef<((scope: ExecutionScope | null) => void) | null>(null);
  const cancelScopeRequest = useCallback(() => {
    pendingScope.current?.(null);
    pendingScope.current = null;
    setScopeRequested(false);
  }, []);
  const selectCandidate = useCallback((scope: ExecutionScope | null) => {
    setCandidate(scope);
    setPreviewHost(scope?.serverId ?? null);
    pendingScope.current?.(scope);
    pendingScope.current = null;
    setScopeRequested(false);
  }, []);
  const selectHost = useCallback(
    (serverId: string) => {
      cancelScopeRequest();
      setCandidate(null);
      setPreviewHost(serverId);
    },
    [cancelScopeRequest],
  );
  const requestScope = useCallback(() => {
    cancelScopeRequest();
    setScopeRequested(true);
    return new Promise<ExecutionScope | null>((resolve) => {
      pendingScope.current = resolve;
    });
  }, [cancelScopeRequest]);
  useEffect(
    () => () => {
      pendingScope.current?.(null);
    },
    [],
  );
  const [switching, setSwitching] = useState(false);
  useEffect(() => selectCandidate(null), [value?.member?.execution?.operationId, selectCandidate]);
  const context = useMemo(
    () =>
      value
        ? {
            ...value,
            candidate,
            previewHost,
            selectHost,
            scopeRequested,
            requestScope,
            cancelScopeRequest,
            selectCandidate,
            switching,
            setSwitching,
          }
        : null,
    [
      value,
      candidate,
      previewHost,
      selectHost,
      scopeRequested,
      requestScope,
      cancelScopeRequest,
      selectCandidate,
      switching,
    ],
  );
  return <Context.Provider value={context}>{children}</Context.Provider>;
}
