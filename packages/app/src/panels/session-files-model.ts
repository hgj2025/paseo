import { memberExecutions, type WorkspaceTeam } from "@getpaseo/protocol/workspace-team";
import type { WorkspaceScope, WorkspaceTabTarget } from "@/workspace-tabs/model";
import { resolveWorkspaceTabScope } from "@/workspace-tabs/scope";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

type Client = Pick<DaemonClient, "fetchAgentTimeline">;
type Page = Awaited<ReturnType<Client["fetchAgentTimeline"]>>;
type Item = Page["entries"][number]["item"];
export function conversationFileSources(
  tabs: readonly { target: WorkspaceTabTarget }[],
  owner: WorkspaceScope,
  team?: WorkspaceTeam | null,
) {
  const unique = new Map<string, WorkspaceScope & { agentId: string }>();
  for (const member of [...(team?.members ?? []), ...(team?.retiredMembers ?? [])]) {
    for (const execution of memberExecutions(member))
      unique.set(`${execution.serverId}:${execution.agentId}`, {
        serverId: execution.serverId,
        workspaceId: execution.workspaceId,
        agentId: execution.agentId,
      });
  }
  for (const tab of tabs) {
    const resolved = resolveWorkspaceTabScope(tab.target, owner);
    if (resolved.target.kind !== "agent") continue;
    unique.set(`${resolved.scope.serverId}:${resolved.target.agentId}`, {
      ...resolved.scope,
      agentId: resolved.target.agentId,
    });
  }
  return Array.from(unique.values());
}
export interface SessionPath {
  path: string;
  edited: boolean;
}
export function normalizeSessionPath(path: string, cwd: string): string {
  const absolute = path.startsWith("/") ? path : `${cwd}/${path}`;
  const parts: string[] = [];
  for (const part of absolute.replaceAll("\\", "/").split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return `/${parts.join("/")}`;
}
export function sessionPaths(items: readonly Item[], cwd: string): SessionPath[] {
  const paths = new Map<string, boolean>();
  if (cwd) paths.set(normalizeSessionPath(cwd, cwd), false);
  for (const item of items) {
    if (item.type !== "tool_call" || item.status !== "completed") continue;
    const detail = item.detail;
    if (detail.type === "edit" || detail.type === "write") {
      if (detail.filePath && (cwd || detail.filePath.startsWith("/")))
        paths.set(normalizeSessionPath(detail.filePath, cwd), true);
    } else if (detail.type === "shell" && detail.cwd) {
      const path = normalizeSessionPath(detail.cwd, cwd);
      if (!paths.has(path)) paths.set(path, false);
    }
  }
  return Array.from(paths, ([path, edited]) => ({ path, edited }));
}
export function parentDirectory(path: string): string {
  return path.slice(0, path.lastIndexOf("/")) || "/";
}

function applyToolEvidence(next: Map<string, { item: Item; seq: number }>, page: Page) {
  for (const entry of page.entries) {
    if (entry.item.type !== "tool_call") continue;
    if ((next.get(entry.item.callId)?.seq ?? -1) > entry.seqEnd) continue;
    const detail = entry.item.detail;
    const cwd = page.agent?.cwd;
    const absolute = (path: string) => (cwd ? normalizeSessionPath(path, cwd) : path);
    let compact = detail;
    if (detail.type === "shell") compact = { type: "shell", command: "", cwd: detail.cwd };
    else if (detail.type === "edit")
      compact = { type: "edit", filePath: absolute(detail.filePath) };
    else if (detail.type === "write")
      compact = { type: "write", filePath: absolute(detail.filePath) };
    else continue;
    next.set(entry.item.callId, {
      item: { ...entry.item, detail: compact, metadata: undefined, agentMessage: undefined },
      seq: entry.seqEnd,
    });
  }
}
function validateHistoryPage(
  following: Page,
  previous: Page,
  at: NonNullable<Page["endCursor"]>,
  initial: boolean,
) {
  const advanced = initial ? following.startCursor : following.endCursor;
  if (!advanced || (advanced.seq === at.seq && advanced.epoch === at.epoch))
    throw new Error("Timeline pagination did not advance");
  if (following.reset || following.staleCursor || following.epoch !== previous.epoch)
    throw new Error("Timeline changed while loading; retry");
}
function publishEvidence(
  next: Map<string, { item: Item; seq: number }>,
  enabled: boolean,
  onProgress?: (items: Item[]) => void,
) {
  if (enabled) onProgress?.(Array.from(next.values(), (value) => value.item));
}
// Keep compact tool evidence, not a second copy of the conversation text.
export function createSessionHistoryReader() {
  let cursor: Page["endCursor"] = null;
  let tools = new Map<string, { item: Item; seq: number }>();
  let previousClient: Client | null = null;
  let previousAgent = "";
  return async (
    client: Client,
    agentId: string,
    onProgress?: (items: Item[]) => void,
  ): Promise<Item[]> => {
    if (client !== previousClient || agentId !== previousAgent) {
      cursor = null;
      tools = new Map();
      previousClient = client;
      previousAgent = agentId;
    }
    const fetch = (direction: "tail" | "before" | "after", at?: NonNullable<Page["endCursor"]>) =>
      client.fetchAgentTimeline(agentId, {
        direction,
        cursor: at,
        limit: 500,
        projection: "canonical",
      });
    let page = await fetch(cursor ? "after" : "tail", cursor ?? undefined);
    if (cursor && (page.reset || page.staleCursor || page.epoch !== cursor.epoch)) {
      cursor = null;
      page = await fetch("tail");
    }
    const initial = !cursor;
    const next = initial ? new Map<string, { item: Item; seq: number }>() : new Map(tools);
    const newest = page.endCursor ?? cursor;
    applyToolEvidence(next, page);
    publishEvidence(next, initial, onProgress);
    let end = newest;
    while (initial ? page.hasOlder : page.hasNewer) {
      const at = initial ? page.startCursor : page.endCursor;
      if (!at) throw new Error("Timeline cursor missing");
      const following = await fetch(initial ? "before" : "after", at);
      validateHistoryPage(following, page, at, initial);
      page = following;
      applyToolEvidence(next, page);
      publishEvidence(next, initial, onProgress);
      if (!initial) end = page.endCursor ?? end;
    }
    tools = next;
    cursor = end;
    return Array.from(tools.values(), (value) => value.item);
  };
}

const historyReaders = new WeakMap<
  Client,
  Map<string, ReturnType<typeof createSessionHistoryReader>>
>();
export function fetchSessionFileHistory(
  client: Client,
  agentId: string,
  onProgress?: (items: Item[]) => void,
) {
  let agents = historyReaders.get(client);
  if (!agents) {
    agents = new Map();
    historyReaders.set(client, agents);
  }
  let reader = agents.get(agentId);
  if (!reader) {
    reader = createSessionHistoryReader();
    agents.set(agentId, reader);
  }
  return reader(client, agentId, onProgress);
}
