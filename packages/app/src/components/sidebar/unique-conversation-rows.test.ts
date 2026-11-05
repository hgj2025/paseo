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

it("renders same-directory agents only in their owning workspace, never once per sibling", () => {
  const agents = ["first", "second", "third"].map((workspaceId) => ({
    id: `${workspaceId}-agent`,
    serverId: "sg",
    workspaceId,
    cwd: "/code/mock",
    title: "sg-boe-test",
    provider: "codex",
    parentAgentId: null,
    labels: {},
  }));
  const rows = ["first", "second", "third"].flatMap((workspaceId) =>
    appendWorkspaceAgentRows([], agents, "sg", workspaceId, new Set(), "/code/mock"),
  );
  expect(rows.map((row) => row.agentId)).toEqual(["first-agent", "second-agent", "third-agent"]);
  expect(rows.map((row) => row.agentWorkspaceId)).toEqual(["first", "second", "third"]);
});
it("uses directory fallback only for agents without a workspace identity", () => {
  const agent = {
    id: "legacy",
    serverId: "sg",
    cwd: "/code/mock",
    title: "Legacy",
    provider: "codex",
    parentAgentId: null,
    labels: {},
  };
  expect(appendWorkspaceAgentRows([], [agent], "sg", "work", new Set(), "/code/mock")).toHaveLength(
    1,
  );
  expect(appendWorkspaceAgentRows([], [agent], "sg", "work", new Set(), "/code/other")).toEqual([]);
});
