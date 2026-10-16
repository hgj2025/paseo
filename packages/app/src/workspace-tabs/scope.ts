import type { LocalWorkspaceTabTarget, WorkspaceScope, WorkspaceTabTarget } from "./model";

/** Layout ownership stays with the window; resource ownership travels with the tab. */
export function resolveWorkspaceTabScope(
  target: WorkspaceTabTarget,
  owner: WorkspaceScope,
): {
  scope: WorkspaceScope;
  target: LocalWorkspaceTabTarget;
} {
  return target.kind === "scoped"
    ? {
        scope: { serverId: target.serverId, workspaceId: target.workspaceId },
        target: target.target,
      }
    : { scope: owner, target };
}

export function scopeWorkspaceTabTarget(
  target: WorkspaceTabTarget,
  scope: WorkspaceScope,
): WorkspaceTabTarget {
  return target.kind === "scoped"
    ? target
    : { kind: "scoped", serverId: scope.serverId, workspaceId: scope.workspaceId, target };
}
