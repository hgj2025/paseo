import { createContext, useContext, type ReactNode } from "react";

// The pane owns scope and team actions; the composer owns their placement above the input.
const WorkspaceToolbarContext = createContext<ReactNode>(null);

export const WorkspaceToolbarProvider = WorkspaceToolbarContext.Provider;
export const useWorkspaceToolbar = () => useContext(WorkspaceToolbarContext);
