import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ExecutionScope } from "./model-host-context";

export type ModelHostDestination =
  | { kind: "workspace"; id: string; label: string; scope: ExecutionScope }
  | { kind: "project"; id: string; label: string; projectId: string; directory: string }
  | { kind: "directory"; id: string; label: string; directory: string };

export async function loadModelHostDestinations(
  client: Pick<DaemonClient, "fetchWorkspaces">,
  serverId: string,
): Promise<ModelHostDestination[]> {
  const destinations: ModelHostDestination[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.fetchWorkspaces({
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    for (const workspace of page.entries) {
      if (workspace.archivingAt) continue;
      destinations.push({
        kind: "workspace",
        id: workspace.id,
        label: workspace.workspaceDirectory,
        scope: { serverId, workspaceId: workspace.id, directory: workspace.workspaceDirectory },
      });
    }
    if (!cursor) {
      for (const project of page.emptyProjects ?? []) {
        destinations.push({
          kind: "project",
          id: `project:${project.projectId}`,
          label: project.projectRootPath,
          projectId: project.projectId,
          directory: project.projectRootPath,
        });
      }
    }
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);
  return destinations;
}

export async function searchModelHostDirectories(
  client: Pick<DaemonClient, "getDirectorySuggestions">,
  query: string,
): Promise<ModelHostDestination[]> {
  const payload = await client.getDirectorySuggestions({
    query,
    includeDirectories: true,
    includeFiles: false,
    limit: 30,
  });
  return (payload.entries ?? []).flatMap((entry) =>
    entry.kind === "directory"
      ? [
          {
            kind: "directory" as const,
            id: `directory:${entry.path}`,
            label: entry.path,
            directory: entry.path,
          },
        ]
      : [],
  );
}
