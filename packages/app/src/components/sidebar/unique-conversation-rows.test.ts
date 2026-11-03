import { describe, expect, it } from "vitest";
import { appendWorkspaceAgentRows, uniqueConversationRows } from "./unique-conversation-rows";

describe("uniqueConversationRows", () => {
  it("shows one row for an agent and retains the selected conversation ID", () => {
    const a = { id: "old", serverId: "mac", agentId: "captain" };
    const b = { ...a, id: "selected" };
    expect(uniqueConversationRows([a, b], b.id)).toEqual([b]);
    expect(uniqueConversationRows([b, a], b.id)).toEqual([b]);
  });
  it("keeps different hosts, distinct agents with the same title, and independent drafts", () => {
    const rows = [
      { id: "a", serverId: "mac", agentId: "1", title: "Captain" },
      { id: "b", serverId: "vm", agentId: "1", title: "Captain" },
      { id: "c", serverId: "mac", agentId: "2", title: "Captain" },
      { id: "d", serverId: "mac" },
      { id: "e", serverId: "mac" },
    ];
    expect(uniqueConversationRows(rows)).toEqual(rows);
  });
});

describe("host-created workspace sessions", () => {
  const agent = {
    id: "new-devbox",
    serverId: "devbox",
    workspaceId: "ip",
    title: "Review robot",
    provider: "claude",
    parentAgentId: null,
    labels: {},
  };
  it("lists a new host session before it has a saved client conversation", () => {
    expect(appendWorkspaceAgentRows([], [agent], "devbox", "ip", new Set())).toEqual([
      {
        id: "agent:new-devbox",
        serverId: "devbox",
        agentId: "new-devbox",
        title: "Review robot",
        ended: false,
        standalone: true,
        agentWorkspaceId: "ip",
      },
    ]);
  });
  it("does not duplicate saved roots, peers, ended conversations or execution agents", () => {
    const represented = new Set([JSON.stringify(["devbox", agent.id])]);
    expect(appendWorkspaceAgentRows([], [agent], "devbox", "ip", represented)).toEqual([]);
    const saved = {
      id: "conversation",
      serverId: "devbox",
      agentId: agent.id,
      title: "Review robot",
      ended: false,
    };
    expect(appendWorkspaceAgentRows([saved], [agent], "devbox", "ip", new Set())).toEqual([saved]);
    expect(
      appendWorkspaceAgentRows(
        [],
        [
          { ...agent, archivedAt: new Date() },
          { ...agent, parentAgentId: "captain" },
          { ...agent, labels: { "paseo.conversation.executor": "member" } },
          { ...agent, workspaceId: "other" },
          { ...agent, serverId: "other" },
        ],
        "devbox",
        "ip",
        new Set(),
      ),
    ).toEqual([]);
  });
});

it("groups a session from a second workspace for the same directory without changing its destination", () => {
  const rows = appendWorkspaceAgentRows(
    [],
    [
      {
        id: "new-devbox",
        serverId: "devbox",
        workspaceId: "new-ip-workspace",
        cwd: "/home/research/code/ip",
        title: "Review robot",
        provider: "claude",
        parentAgentId: null,
        labels: {},
      },
    ],
    "devbox",
    "old-ip-workspace",
    new Set(),
    "/home/research/code/ip",
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.agentWorkspaceId).toBe("new-ip-workspace");
  expect(
    appendWorkspaceAgentRows(
      [],
      [
        {
          id: "other",
          serverId: "devbox",
          workspaceId: "elsewhere",
          cwd: "/home/research/code/ip-copy",
          title: "Other",
          provider: "claude",
          parentAgentId: null,
          labels: {},
        },
      ],
      "devbox",
      "old-ip-workspace",
      new Set(),
      "/home/research/code/ip",
    ),
  ).toEqual([]);
});
