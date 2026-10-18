import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useWorkspaceLayoutStore, type SplitNode } from "@/stores/workspace-layout-store";

const WorkspaceFilePanelToggleContext = createContext<{ toggle: ReactNode; paneId: string | null }>(
  { toggle: null, paneId: null },
);

// Follow the rightmost column, then its topmost visible conversation pane.
function topRightPane(node: SplitNode): string | null {
  if (node.kind === "pane")
    return node.pane.hidden || node.pane.id === "explorer" ? null : node.pane.id;
  const children =
    node.group.direction === "horizontal" ? node.group.children.toReversed() : node.group.children;
  for (const child of children) {
    const id = topRightPane(child);
    if (id) return id;
  }
  return null;
}
export function WorkspaceFilePanelToggleProvider({
  value,
  workspaceKey,
  children,
}: {
  value: ReactNode;
  workspaceKey: string | null;
  children: ReactNode;
}) {
  const root = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.layoutByWorkspace[workspaceKey]?.root : undefined,
  );
  const context = useMemo(
    () => ({ toggle: value, paneId: root ? topRightPane(root) : null }),
    [value, root],
  );
  return (
    <WorkspaceFilePanelToggleContext.Provider value={context}>
      {children}
    </WorkspaceFilePanelToggleContext.Provider>
  );
}
export function useWorkspaceFilePanelToggle(paneId?: string) {
  const context = useContext(WorkspaceFilePanelToggleContext);
  return context.paneId === paneId ? context.toggle : null;
}
