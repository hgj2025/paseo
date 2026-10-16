import { describe, expect, it } from "vitest";
import type { WorkspaceLayout } from "@/stores/workspace-layout-store";
import { resolveFocusedChatTarget } from "./focused-chat-target";

function layoutWithTarget(
  target: import("@/workspace-tabs/model").WorkspaceTab["target"],
): WorkspaceLayout {
  return {
    root: {
      kind: "pane",
      pane: {
        id: "pane-1",
        tabIds: ["focused-tab"],
        focusedTabId: "focused-tab",
        tabs: [{ tabId: "focused-tab", target, createdAt: 1 }],
      },
    },
    focusedPaneId: "pane-1",
  } as WorkspaceLayout;
}

describe("focused chat target", () => {
  const layoutOwner = { serverId: "host", workspaceId: "host-workspace" };
  const remoteScope = { serverId: "guest", workspaceId: "guest-workspace" };

  it("attaches a remote file to a remote chat in the owner's layout", () => {
    expect(
      resolveFocusedChatTarget({
        ...remoteScope,
        layoutOwner,
        layout: layoutWithTarget({
          kind: "scoped",
          ...remoteScope,
          target: { kind: "agent", agentId: "remote-agent" },
        }),
      }),
    ).toEqual({ tabId: "focused-tab", draftKey: "agent:guest:remote-agent" });
  });

  it("does not attach a local file to a remote chat", () => {
    expect(
      resolveFocusedChatTarget({
        ...layoutOwner,
        layoutOwner,
        layout: layoutWithTarget({
          kind: "scoped",
          ...remoteScope,
          target: { kind: "agent", agentId: "remote-agent" },
        }),
      }),
    ).toBeNull();
  });

  it("does not attach a remote file to the owner or another remote workspace", () => {
    for (const target of [
      { kind: "agent", agentId: "local-agent" } as const,
      {
        kind: "scoped",
        serverId: remoteScope.serverId,
        workspaceId: "another-workspace",
        target: { kind: "draft", draftId: "other-draft" },
      } as const,
    ]) {
      expect(
        resolveFocusedChatTarget({
          ...remoteScope,
          layoutOwner,
          layout: layoutWithTarget(target),
        }),
      ).toBeNull();
    }
  });

  it("targets the focused agent draft", () => {
    expect(
      resolveFocusedChatTarget({
        serverId: "server-1",
        layout: layoutWithTarget({ kind: "agent", agentId: "agent-1" }),
      }),
    ).toEqual({ tabId: "focused-tab", draftKey: "agent:server-1:agent-1" });
  });

  it("targets the focused unsent draft", () => {
    expect(
      resolveFocusedChatTarget({
        serverId: "server-1",
        layout: layoutWithTarget({ kind: "draft", draftId: "draft-1" }),
      }),
    ).toEqual({ tabId: "focused-tab", draftKey: "draft:server-1:draft-1" });
  });

  it("does not guess when the focused tab is not a chat", () => {
    expect(
      resolveFocusedChatTarget({
        serverId: "server-1",
        layout: layoutWithTarget({ kind: "terminal", terminalId: "terminal-1" }),
      }),
    ).toBeNull();
  });

  it("targets a utility tab's parent chat", () => {
    const layout = {
      root: {
        kind: "pane",
        pane: {
          id: "pane-1",
          tabIds: ["agent-tab", "changes-tab"],
          focusedTabId: "changes-tab",
          tabs: [
            {
              tabId: "agent-tab",
              target: { kind: "agent", agentId: "agent-1" },
              createdAt: 1,
            },
            { tabId: "changes-tab", target: { kind: "working_diff" }, createdAt: 2 },
          ],
        },
      },
      focusedPaneId: "pane-1",
      parentTabIdByTabId: { "changes-tab": "agent-tab" },
    } as WorkspaceLayout;

    expect(resolveFocusedChatTarget({ serverId: "server-1", layout })).toEqual({
      tabId: "agent-tab",
      draftKey: "agent:server-1:agent-1",
    });
  });
  it("targets a chat in a neighbouring pane when the focused pane holds none", () => {
    const layout = {
      root: {
        kind: "group",
        group: {
          id: "group-1",
          direction: "horizontal",
          sizes: [0.5, 0.5],
          children: [
            {
              kind: "pane",
              pane: {
                id: "main",
                tabIds: ["agent-tab"],
                focusedTabId: "agent-tab",
                tabs: [
                  {
                    tabId: "agent-tab",
                    target: { kind: "agent", agentId: "agent-1" },
                    createdAt: 1,
                  },
                ],
              },
            },
            {
              kind: "pane",
              pane: {
                id: "explorer",
                tabIds: ["changes-tab"],
                focusedTabId: "changes-tab",
                tabs: [{ tabId: "changes-tab", target: { kind: "working_diff" }, createdAt: 2 }],
              },
            },
          ],
        },
      },
      focusedPaneId: "explorer",
    } as unknown as WorkspaceLayout;

    expect(resolveFocusedChatTarget({ serverId: "server-1", layout })).toEqual({
      tabId: "agent-tab",
      draftKey: "agent:server-1:agent-1",
    });
  });
});
