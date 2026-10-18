import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { v4 as uuid } from "uuid";
import type { SidebarWorkspacePlacement } from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarProjectHostTarget } from "./sidebar-project-row-model";

/** Reuse the directory's workspace; another chat does not need another workspace. */
export async function prepareSidebarConversationWorkspace(
  client: Pick<DaemonClient, "createWorkspace">,
  target: SidebarProjectHostTarget,
  workspaces: readonly SidebarWorkspacePlacement[],
) {
  const existing = workspaces.find(
    (workspace) =>
      workspace.serverId === target.serverId &&
      workspace.workspaceDirectory === target.iconWorkingDir,
  );
  if (existing) return { workspaceId: existing.workspaceId, workspace: null };
  const created = await client.createWorkspace({
    idempotencyKey: uuid(),
    source: { kind: "directory", path: target.iconWorkingDir, projectId: target.projectId },
  });
  if (created.error || !created.workspace)
    throw new Error(created.error ?? "Unable to open directory");
  return { workspaceId: created.workspace.id, workspace: created.workspace };
}
