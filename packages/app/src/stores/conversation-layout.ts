import { useSessionStore } from "./session-store";
import { memberExecutions, type WorkspaceTeam } from "@getpaseo/protocol/workspace-team";
import { v4 as uuid } from "uuid";
import type { WorkspaceLayoutStore } from "./workspace-layout-store";
import {
  collectAllTabs,
  collectAllPanes,
  closeTabInLayout,
  createWorkspaceLayoutWithExplorerSidebar,
  createTabInLayout,
  findPaneContainingTab,
  findPaneById,
  EXPLORER_SIDEBAR_PANE_ID,
  splitPaneEmptyInLayout,
  replaceTabTargetInLayout,
  type WorkspaceLayout,
} from "./workspace-layout-actions";
import { buildDeterministicWorkspaceTabId } from "@/workspace-tabs/identity";
import type { WorkspaceTab, WorkspaceTabTarget, WorkspaceScope } from "@/workspace-tabs/model";
import { generateDraftId } from "./draft-keys";

export interface ConversationLayout {
  id: string;
  createdAt: number;
  rootTabId: string;
  layout: WorkspaceLayout;
  endedAt?: string;
}
export interface ConversationState {
  conversationsByWorkspace: Record<string, Record<string, ConversationLayout>>;
  activeConversationByWorkspace: Record<string, string>;
  legacyConversationLayouts: Record<string, WorkspaceLayout>;
  restoreConversations(key: string, teams: WorkspaceTeam[]): void;
  enableConversations(key: string): void;
  newConversation(key: string, target?: WorkspaceTabTarget): string;
  selectConversation(key: string, id: string): void;
  endConversation(key: string, id?: string): void;
  resetConversationMemberScope(
    key: string,
    team: WorkspaceTeam,
    paneId: string,
    scope: WorkspaceScope,
  ): string | null;
  addConversationMember(
    key: string,
    scope?: WorkspaceScope,
    placement?: {
      targetPaneId: string;
      position: "left" | "right" | "top" | "bottom";
    },
  ): string | null;
}
export function conversationTarget(target: WorkspaceTabTarget) {
  const local = target.kind === "scoped" ? target.target : target;
  return local.kind === "agent" || local.kind === "draft" ? local : null;
}
export function selectMemberDraftTemplate<
  T extends { workspaceId?: string | null; archivedAt?: Date | null; updatedAt: Date },
>(agents: readonly T[], workspaceId: string): T | undefined {
  return agents
    .filter((a) => a.workspaceId === workspaceId)
    .sort(
      (a, b) =>
        Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)) ||
        b.updatedAt.getTime() - a.updatedAt.getTime(),
    )[0];
}
function memberDraft(key: string, scope?: WorkspaceScope): WorkspaceTabTarget {
  const separator = key.indexOf(":");
  const serverId = scope?.serverId ?? key.slice(0, separator),
    workspaceId = scope?.workspaceId ?? key.slice(separator + 1);
  const session = useSessionStore.getState().sessions[serverId];
  const template = selectMemberDraftTemplate(
    Array.from(session?.agents.values() ?? []),
    workspaceId,
  );
  const target = {
    kind: "draft" as const,
    draftId: generateDraftId(),
    ...(template
      ? {
          setup: {
            provider: template.provider,
            cwd: template.cwd,
            model: template.model,
            modeId: template.currentModeId,
            thinkingOptionId: template.thinkingOptionId ?? null,
            featureValues: {},
          },
        }
      : {}),
  };
  return scope ? { kind: "scoped", ...scope, target } : target;
}
function makeConversation(target: WorkspaceTabTarget): ConversationLayout {
  const id = uuid();
  const result = createTabInLayout({
    layout: createWorkspaceLayoutWithExplorerSidebar(),
    explorerSidebarPaneId: EXPLORER_SIDEBAR_PANE_ID,
    target,
    now: Date.now(),
    createTabId: () => buildDeterministicWorkspaceTabId(target),
    placement: { mode: "focused" },
  });
  if (!result) throw new Error("Could not create conversation layout.");
  return {
    id,
    createdAt: Date.now(),
    rootTabId: result.tabId,
    layout: result.layout,
  };
}
// Membership may change on another client while this client keeps its layout.
function reconcileMemberPanes(
  key: string,
  team: WorkspaceTeam,
  initial: WorkspaceLayout,
  hadSavedLayout: boolean,
): WorkspaceLayout {
  let layout = initial;
  for (const retired of team.retiredMembers ?? []) {
    const retiredTab = collectAllTabs(layout.root).find((tab) => {
      const target = conversationTarget(tab.target);
      const host =
        tab.target.kind === "scoped" ? tab.target.serverId : key.slice(0, key.indexOf(":"));
      return (
        host === retired.serverId && target?.kind === "agent" && target.agentId === retired.agentId
      );
    });
    if (retiredTab)
      layout =
        closeTabInLayout({
          layout,
          tabId: retiredTab.tabId,
          explorerSidebarPaneId: EXPLORER_SIDEBAR_PANE_ID,
        }) ?? layout;
  }
  const anchors = collectAllPanes(layout.root).filter(
    (pane) => pane.id !== EXPLORER_SIDEBAR_PANE_ID && !pane.hidden,
  );
  let addedCount = 0;
  for (const member of team.members.filter((m) => m.id !== team.captainId)) {
    const present = collectAllTabs(layout.root).some((tab) => {
      const target = conversationTarget(tab.target);
      const host =
        tab.target.kind === "scoped" ? tab.target.serverId : key.slice(0, key.indexOf(":"));
      return (
        host === member.serverId && target?.kind === "agent" && target.agentId === member.agentId
      );
    });
    if (present) continue;
    const anchor = anchors[addedCount % anchors.length];
    const split = splitPaneEmptyInLayout({
      layout,
      targetPaneId: anchor?.id ?? layout.focusedPaneId!,
      position: hadSavedLayout ? "bottom" : "right",
      maxTreeDepth: 32,
      createNodeId: (prefix) =>
        prefix === "pane" && member.paneId ? member.paneId : `${prefix}_${uuid()}`,
    });
    if (!split) continue;
    const target: WorkspaceTabTarget = {
      kind: "scoped",
      serverId: member.serverId,
      workspaceId: member.workspaceId,
      target: { kind: "agent", agentId: member.agentId },
    };
    const added = createTabInLayout({
      layout: split.layout,
      explorerSidebarPaneId: EXPLORER_SIDEBAR_PANE_ID,
      target,
      placement: { mode: "pane", paneId: split.paneId },
      now: Date.now(),
      createTabId: () => buildDeterministicWorkspaceTabId(target),
    });
    if (added) {
      layout = added.layout;
      addedCount++;
    }
  }
  return layout;
}
function removeDuplicateMemberConversations(
  key: string,
  teams: WorkspaceTeam[],
  entries: Record<string, ConversationLayout>,
): void {
  // A local singleton tab for an imported member is a duplicate view, not another team.
  const backedIds = new Set(teams.filter((team) => team.captainId).map((team) => team.sessionId));
  const memberOwner = new Map<string, string>();
  for (const team of teams.filter((candidate) => candidate.status !== "ended")) {
    for (const member of team.members)
      for (const execution of memberExecutions(member))
        memberOwner.set(`${execution.serverId}:${execution.agentId}`, team.sessionId!);
  }
  for (const [id, entry] of Object.entries(entries)) {
    if (backedIds.has(id)) continue;
    const tabs = collectAllTabs(entry.layout.root).filter(
      (tab) => findPaneContainingTab(entry.layout.root, tab.tabId)?.id !== EXPLORER_SIDEBAR_PANE_ID,
    );
    const tab = tabs[0];
    const target = tab && conversationTarget(tab.target);
    if (tabs.length !== 1 || target?.kind !== "agent") continue;
    const host =
      tab.target.kind === "scoped" ? tab.target.serverId : key.slice(0, key.indexOf(":"));
    const owner = memberOwner.get(`${host}:${target.agentId}`);
    if (owner && owner !== id) delete entries[id];
  }
}
export function activeConversation(
  state: Pick<WorkspaceLayoutStore, "conversationsByWorkspace" | "activeConversationByWorkspace">,
  key: string,
) {
  return state.conversationsByWorkspace[key]?.[state.activeConversationByWorkspace[key] ?? ""];
}
function savedConversations(state: WorkspaceLayoutStore, key: string) {
  const entries = { ...state.conversationsByWorkspace[key] };
  const current = activeConversation(state, key);
  if (current && state.layoutByWorkspace[key])
    entries[current.id] = { ...current, layout: state.layoutByWorkspace[key] };
  return entries;
}
export function conversationActions(
  set: (
    value:
      | Partial<WorkspaceLayoutStore>
      | ((state: WorkspaceLayoutStore) => Partial<WorkspaceLayoutStore>),
  ) => void,
  get: () => WorkspaceLayoutStore,
): ConversationState {
  function select(key: string, id: string) {
    const state = get();
    const entries = savedConversations(state, key);
    const next = entries[id];
    if (!next) return;
    set({
      conversationsByWorkspace: {
        ...state.conversationsByWorkspace,
        [key]: entries,
      },
      activeConversationByWorkspace: {
        ...state.activeConversationByWorkspace,
        [key]: id,
      },
      layoutByWorkspace: { ...state.layoutByWorkspace, [key]: next.layout },
      sheetsByWorkspace: { ...state.sheetsByWorkspace, [key]: [] },
      focusRestorationByWorkspace: Object.fromEntries(
        Object.entries(state.focusRestorationByWorkspace).filter(([entry]) => entry !== key),
      ),
      sidePaneIdByWorkspace: { ...state.sidePaneIdByWorkspace, [key]: null },
      explorerSidebarPaneIdByWorkspace: {
        ...state.explorerSidebarPaneIdByWorkspace,
        [key]: EXPLORER_SIDEBAR_PANE_ID,
      },
    });
  }
  return {
    conversationsByWorkspace: {},
    activeConversationByWorkspace: {},
    legacyConversationLayouts: {},
    restoreConversations(key, teams) {
      const state = get(),
        entries = savedConversations(state, key);
      for (const team of teams) {
        if (!team.sessionId || !team.captainId) continue;
        const saved = entries[team.sessionId];
        const captain = team.members.find((m) => m.id === team.captainId);
        if (!captain) continue;
        const captainTarget: WorkspaceTabTarget =
          `${captain.serverId}:${captain.workspaceId}` === key
            ? { kind: "agent", agentId: captain.agentId }
            : {
                kind: "scoped",
                serverId: captain.serverId,
                workspaceId: captain.workspaceId,
                target: { kind: "agent", agentId: captain.agentId },
              };
        const record = makeConversation(captainTarget);
        let layout = saved?.layout ?? record.layout;
        layout = reconcileMemberPanes(key, team, layout, Boolean(saved));
        entries[team.sessionId] = {
          ...(saved ?? record),
          id: team.sessionId,
          layout,
          ...(team.endedAt ? { endedAt: team.endedAt } : {}),
        };
      }
      removeDuplicateMemberConversations(key, teams, entries);
      const activeId = state.activeConversationByWorkspace[key];
      set({
        conversationsByWorkspace: {
          ...state.conversationsByWorkspace,
          [key]: entries,
        },
        ...(activeId && entries[activeId]
          ? {
              layoutByWorkspace: {
                ...state.layoutByWorkspace,
                [key]: entries[activeId].layout,
              },
            }
          : {}),
      });
      const current = state.activeConversationByWorkspace[key];
      const selected = current && entries[current] ? current : Object.keys(entries)[0];
      if (selected) select(key, selected);
    },
    enableConversations(key) {
      if (get().activeConversationByWorkspace[key]) return;
      const state = get();
      const original = state.layoutByWorkspace[key];
      // Old layouts were workspace-wide. Keep their exact snapshot, but never infer that
      // two previously visible agents belonged to the same conversation/team.
      const targets = original
        ? collectAllTabs(original.root)
            .filter((t) => t.target.kind !== "scoped" && conversationTarget(t.target))
            .map((t) => t.target)
        : [];
      const entries = (targets.length ? targets : [memberDraft(key)]).map(makeConversation);
      set({
        conversationsByWorkspace: {
          ...state.conversationsByWorkspace,
          [key]: Object.fromEntries(entries.map((c) => [c.id, c])),
        },
        legacyConversationLayouts: original
          ? { ...state.legacyConversationLayouts, [key]: original }
          : state.legacyConversationLayouts,
      });
      select(key, entries[0]!.id);
    },
    newConversation(key, target = memberDraft(key)) {
      const state = get(),
        next = makeConversation(target);
      set({
        conversationsByWorkspace: {
          ...state.conversationsByWorkspace,
          [key]: { ...savedConversations(state, key), [next.id]: next },
        },
      });
      select(key, next.id);
      return next.rootTabId;
    },
    selectConversation: select,
    endConversation(key, id) {
      const state = get(),
        current = id ? state.conversationsByWorkspace[key]?.[id] : activeConversation(state, key);
      if (!current) return;
      const entries = savedConversations(state, key);
      entries[current.id] = {
        ...entries[current.id]!,
        endedAt: new Date().toISOString(),
      };
      set({
        conversationsByWorkspace: {
          ...state.conversationsByWorkspace,
          [key]: entries,
        },
      });
    },
    resetConversationMemberScope(key, team, paneId, scope) {
      const state = get();
      const conversation = activeConversation(state, key);
      if (
        !conversation ||
        conversation.id !== team.sessionId ||
        conversation.endedAt ||
        team.status !== "active"
      )
        return null;
      // Only a server-confirmed retirement unlocks an occupied member pane.
      if (team.members.some((m) => m.paneId === paneId)) return null;
      const layout = state.layoutByWorkspace[key];
      const pane = layout && findPaneById(layout.root, paneId);
      const retired = team.retiredMembers?.findLast((m) => m.paneId === paneId);
      const tab =
        pane &&
        collectAllTabs(layout.root).find((t) => {
          if (findPaneContainingTab(layout.root, t.tabId)?.id !== paneId) return false;
          const target = conversationTarget(t.target);
          const host =
            t.target.kind === "scoped" ? t.target.serverId : key.slice(0, key.indexOf(":"));
          return (
            target?.kind === "agent" &&
            target.agentId === retired?.agentId &&
            host === retired.serverId
          );
        });
      if (!tab || tab.tabId === conversation.rootTabId) return null;
      const result = replaceTabTargetInLayout({
        layout,
        tabId: tab.tabId,
        target: memberDraft(key, scope),
        createTabId: () => uuid(),
      });
      if (!result) return null;
      set({
        layoutByWorkspace: { ...state.layoutByWorkspace, [key]: result.layout },
        conversationsByWorkspace: {
          ...state.conversationsByWorkspace,
          [key]: {
            ...state.conversationsByWorkspace[key],
            [conversation.id]: { ...conversation, layout: result.layout },
          },
        },
      });
      return result.tabId;
    },
    addConversationMember(key, scope, placement) {
      const state = get(),
        current = activeConversation(state, key),
        layout = state.layoutByWorkspace[key];
      if (!current || current.endedAt || !layout) return null;
      const targetPaneId =
        placement?.targetPaneId ?? findPaneContainingTab(layout.root, current.rootTabId)?.id;
      if (!targetPaneId) return null;
      const paneId = state.splitPaneEmpty(key, {
        targetPaneId,
        position: placement?.position ?? "right",
      });
      if (!paneId) return null;
      const target = memberDraft(key, scope);
      get().openTab({
        workspaceKey: key,
        target,
        intent: "new",
        placement: { mode: "pane", paneId },
      });
      return paneId;
    },
  };
}
/** Resolve member tabs to their fixed pane. Generic agent navigation opens a top-level
 * conversation; it cannot silently add a second agent to an occupied member pane. */
export function routeConversationTab(
  state: WorkspaceLayoutStore,
  key: string,
  target: WorkspaceTabTarget,
  paneId?: string,
): { tab?: WorkspaceTab; conversationId?: string; create: boolean } {
  const current = activeConversation(state, key);
  if (!current || !conversationTarget(target)) return { create: false };
  const canonical = (value: WorkspaceTabTarget) =>
    value.kind === "scoped" && `${value.serverId}:${value.workspaceId}` === key
      ? value.target
      : value;
  const identity = buildDeterministicWorkspaceTabId(canonical(target));
  for (const conversation of Object.values(state.conversationsByWorkspace[key] ?? {})) {
    const layout =
      conversation.id === current.id ? state.layoutByWorkspace[key] : conversation.layout;
    const tab =
      layout &&
      collectAllTabs(layout.root).find(
        (t) =>
          conversationTarget(t.target) &&
          buildDeterministicWorkspaceTabId(canonical(t.target)) === identity,
      );
    if (tab) return { tab, conversationId: conversation.id, create: false };
  }
  const layout = state.layoutByWorkspace[key];
  const pane = layout && findPaneById(layout.root, paneId ?? layout.focusedPaneId);
  const tabs = layout ? collectAllTabs(layout.root) : [];
  const occupied =
    pane && tabs.some((t) => pane.tabIds.includes(t.tabId) && conversationTarget(t.target));
  return { create: Boolean(current.endedAt || !pane || occupied) };
}
export function conversationPaneIsMain(
  state: WorkspaceLayoutStore,
  key: string,
  paneId: string,
): boolean {
  const current = activeConversation(state, key),
    layout = state.layoutByWorkspace[key];
  return Boolean(
    current && layout && findPaneContainingTab(layout.root, current.rootTabId)?.id === paneId,
  );
}
