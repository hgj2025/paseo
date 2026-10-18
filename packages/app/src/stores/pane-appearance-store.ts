import type { TeamMember } from "@getpaseo/protocol/workspace-team";
import {
  collectAllTabs,
  findPaneContainingTab,
  type WorkspaceLayout,
} from "./workspace-layout-actions";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  assignPaneColors,
  PANE_COLOR_NAMES,
  type PaneAppearance,
  type PaneColorChoice,
} from "@/styles/pane-colors";

interface State {
  workspaces: Record<string, Record<string, PaneAppearance>>;
  syncPanes(workspace: string, paneIds: readonly string[]): void;
  setColor(workspace: string, paneId: string, choice: PaneColorChoice): void;
}

export const usePaneAppearanceStore = create<State>()(
  persist(
    (set) => ({
      workspaces: {},
      syncPanes: (workspace, paneIds) =>
        set((state) => {
          const previous = state.workspaces[workspace] ?? {};
          const next = assignPaneColors(previous, paneIds);
          if (next === previous) return state;
          return { workspaces: { ...state.workspaces, [workspace]: next } };
        }),
      setColor: (workspace, paneId, choice) =>
        set((state) => {
          const panes = state.workspaces[workspace];
          const pane = panes?.[paneId];
          if (!pane || pane.choice === choice) return state;
          return {
            workspaces: {
              ...state.workspaces,
              [workspace]: { ...panes, [paneId]: { ...pane, choice } },
            },
          };
        }),
    }),
    {
      name: "workspace-pane-appearance",
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({
          workspaces: z.record(
            z.string(),
            z.record(
              z.string(),
              z.object({
                automatic: z.enum(PANE_COLOR_NAMES),
                choice: z.enum(["auto", "theme", ...PANE_COLOR_NAMES]),
              }),
            ),
          ),
        }),
      ),
      partialize: (state) => ({ workspaces: state.workspaces }),
    },
  ),
);

/** Resolve the actual member tab, including legacy teams without persisted pane IDs. */
export function resolveTeamMemberPane(
  layout: WorkspaceLayout | undefined,
  ownerServerId: string,
  member: Pick<TeamMember, "agentId" | "serverId">,
): string | undefined {
  if (!layout) return undefined;
  const tab = collectAllTabs(layout.root).find((entry) => {
    const target = entry.target.kind === "scoped" ? entry.target.target : entry.target;
    const serverId = entry.target.kind === "scoped" ? entry.target.serverId : ownerServerId;
    return (
      target.kind === "agent" && target.agentId === member.agentId && serverId === member.serverId
    );
  });
  return tab ? findPaneContainingTab(layout.root, tab.tabId)?.id : undefined;
}
