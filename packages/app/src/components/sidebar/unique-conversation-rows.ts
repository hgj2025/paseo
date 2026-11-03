/** Agent IDs are host-local. Preserve independent drafts and prefer the selected duplicate. */
export function uniqueConversationRows<
  T extends { id: string; serverId: string; agentId?: string },
>(rows: readonly T[], activeId?: string): T[] {
  const result: T[] = [];
  const indices = new Map<string, number>();
  for (const row of rows) {
    if (!row.agentId) {
      result.push(row);
      continue;
    }
    const identity = JSON.stringify([row.serverId, row.agentId]);
    const index = indices.get(identity);
    if (index === undefined) {
      indices.set(identity, result.length);
      result.push(row);
    } else if (row.id === activeId) {
      result[index] = row;
    }
  }
  return result;
}

export interface SidebarConversationRow {
  id: string;
  serverId: string;
  agentId?: string;
  title: string;
  ended: boolean;
  standalone?: boolean;
  agentWorkspaceId?: string;
}

interface WorkspaceAgentRow {
  cwd?: string;
  id: string;
  serverId: string;
  workspaceId?: string;
  title: string | null;
  provider: string;
  archivedAt?: Date | null;
  parentAgentId: string | null;
  labels: Record<string, string>;
}

/** Host-created sessions have no client layout until they are first opened. */
export function appendWorkspaceAgentRows(
  rows: SidebarConversationRow[],
  agents: Iterable<WorkspaceAgentRow>,
  serverId: string,
  workspaceId: string,
  represented: ReadonlySet<string>,
  workspaceDirectory?: string,
): SidebarConversationRow[] {
  const seen = new Set(rows.map((row) => JSON.stringify([row.serverId, row.agentId])));
  const result = [...rows];
  for (const agent of agents) {
    const key = JSON.stringify([agent.serverId, agent.id]);
    if (
      agent.serverId !== serverId ||
      (agent.workspaceId !== workspaceId &&
        (!workspaceDirectory || agent.cwd !== workspaceDirectory)) ||
      agent.archivedAt ||
      agent.parentAgentId ||
      agent.labels["paseo.conversation.executor"] ||
      represented.has(key) ||
      seen.has(key)
    )
      continue;
    seen.add(key);
    result.push({
      id: `agent:${agent.id}`,
      serverId,
      agentId: agent.id,
      title: agent.title || agent.provider,
      ended: false,
      standalone: true,
      agentWorkspaceId: agent.workspaceId,
    });
  }
  return result;
}
