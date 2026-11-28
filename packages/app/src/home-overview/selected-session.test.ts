import { describe, expect, it } from "vitest";
import { createDefaultLayout, createTabInLayout } from "@/stores/workspace-layout-actions";
import { selectedSessionKey } from "./selected-session";

const empty = {
  conversationsByWorkspace: {},
  activeConversationByWorkspace: {},
  layoutByWorkspace: {},
};
function layout(agentId: string) {
  const result = createTabInLayout({
    layout: createDefaultLayout(),
    target: { kind: "agent", agentId },
    now: 1,
    placement: { mode: "focused" },
    explorerSidebarPaneId: null,
    createTabId: () => "root-tab",
  });
  if (!result) throw new Error("Unable to prepare layout");
  return result.layout;
}
describe("selected active session", () => {
  it("highlights direct agent routes without a conversation record", () => {
    expect(selectedSessionKey("/h/devbox/agent/first", empty, [])).toBe(
      JSON.stringify(["devbox", "first"]),
    );
    expect(selectedSessionKey("/home", empty, [])).toBeUndefined();
  });
  it("uses the current focused layout for hosts without team records", () => {
    expect(
      selectedSessionKey(
        "/h/devbox/workspace/work",
        { ...empty, layoutByWorkspace: { "devbox:work": layout("first") } },
        [],
      ),
    ).toBe(JSON.stringify(["devbox", "first"]));
  });
  it("reads the live root tab rather than a stale saved draft layout", () => {
    const state = {
      layoutByWorkspace: { "devbox:work": layout("first") },
      activeConversationByWorkspace: { "devbox:work": "conversation" },
      conversationsByWorkspace: {
        "devbox:work": {
          conversation: {
            id: "conversation",
            createdAt: 1,
            rootTabId: "root-tab",
            layout: createDefaultLayout(),
          },
        },
      },
    };
    expect(selectedSessionKey("/h/devbox/workspace/work", state, [])).toBe(
      JSON.stringify(["devbox", "first"]),
    );
  });
  it("maps a cross-host executor back to the single visible conversation", () => {
    const root = { serverId: "mac", agentId: "captain" };
    const groups = [
      {
        root,
        members: [
          {
            serverId: "mac",
            agentId: "member",
            execution: { serverId: "devbox", agentId: "runner" },
          },
        ],
      },
    ];
    expect(selectedSessionKey("/h/devbox/agent/runner", empty, groups)).toBe(
      JSON.stringify(["mac", "captain"]),
    );
  });
});
