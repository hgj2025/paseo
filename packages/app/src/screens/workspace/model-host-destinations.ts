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
  const byDirectory = new Map<string, ModelHostDestination>();
  for (const destination of destinations) {
    const existing = byDirectory.get(destination.label);
    if (!existing || (existing.kind !== "workspace" && destination.kind === "workspace")) {
      byDirectory.set(destination.label, destination);
    }
  }
  return [...byDirectory.values()];
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

/** Reuse the same project's host-local directory instead of comparing cross-host paths. */
export function resolveModelHostDestination(
  destinations: readonly ModelHostDestination[],
  directory: string | undefined,
  projectDirectory: string | undefined,
): ModelHostDestination | undefined {
  const exact = destinations.find(
    (entry) => entry.kind === "workspace" && entry.scope.directory === directory,
  );
  if (exact) return exact;
  if (!projectDirectory) return undefined;
  return (
    destinations.find(
      (entry) => entry.kind === "workspace" && entry.scope.directory === projectDirectory,
    ) ??
    destinations.find((entry) => entry.kind === "project" && entry.directory === projectDirectory)
  );
}

export function parentModelHostDirectory(directory: string): string {
  const path = directory.replace(/\/+$/, "");
  return path.slice(0, path.lastIndexOf("/")) || "/";
}

/** List the chosen host's filesystem, not its registered projects. */
export async function browseModelHostDirectory(
  client: Pick<DaemonClient, "listDirectory">,
  directory: string,
): Promise<ModelHostDestination[]> {
  const listing = await client.listDirectory(directory, ".");
  return listing.entries
    .filter((entry) => entry.kind === "directory")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const path = `${directory.replace(/\/+$/, "")}/${entry.name}`;
      return { kind: "directory", id: path, label: entry.name, directory: path };
    });
}
