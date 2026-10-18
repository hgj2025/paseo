import { prepareSidebarConversationWorkspace } from "./sidebar-project-conversation";
import { describe, expect, it, vi } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import {
  buildSidebarProjectRowModel,
  resolveSidebarProjectIconTarget,
  resolveSidebarProjectIconTargets,
  resolveSidebarProjectLocalPath,
} from "./sidebar-project-row-model";

function workspace(overrides: Partial<SidebarWorkspaceEntry> = {}): SidebarWorkspaceEntry {
  return {
    workspaceKey: "srv:ws-root",
    serverId: "srv",
    workspaceId: "ws-root",
    projectViewKey: "project-1",
    projectName: "paseo",
    workspaceDirectory: "/repo",
    workspaceDirectoryLabel: "/repo",
    projectKind: "git",
    workspaceKind: "checkout",
    name: "paseo",
    title: null,
    currentBranch: null,
    statusBucket: "done",
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    statusEnteredAt: null,
    ...overrides,
    archivingAt: overrides.archivingAt ?? null,
  };
}

type ProjectOverrides = Omit<Partial<SidebarProjectEntry>, "hosts"> & {
  hosts?: Array<Omit<SidebarProjectEntry["hosts"][number], "projectId"> & { projectId?: string }>;
};

function project(overrides: ProjectOverrides = {}): SidebarProjectEntry {
  const projectKind = overrides.projectKind ?? "git";
  const hosts = Array.from(
    overrides.hosts ?? [
      {
        serverId: "srv",
        iconWorkingDir: "/repo",
        worktreeSupport: projectKind === "git" ? "supported" : "unsupported",
      },
    ],
    (host) => Object.assign({}, host, { projectId: host.projectId ?? `project-${host.serverId}` }),
  );
  return {
    viewKey: "project-1",
    projectName: "paseo",
    projectKind,
    iconWorkingDir: "/repo",
    workspaces: [workspace()],
    ...overrides,
    hosts,
  };
}

describe("buildSidebarProjectRowModel", () => {
  it("renders a non-git single-workspace project as an expandable section", () => {
    const result = buildSidebarProjectRowModel({
      project: project({
        projectKind: "directory",
        workspaces: [workspace({ workspaceId: "ws-non-git", workspaceKind: "checkout" })],
      }),
      collapsed: false,
    });

    expect(result).toEqual({
      kind: "project_section",
      chevron: "collapse",
      trailingAction: { kind: "none" },
    });
  });

  it("renders a single-workspace git project as an expandable section with the new workspace action", () => {
    const result = buildSidebarProjectRowModel({
      project: project({
        projectKind: "git",
        workspaces: [workspace({ workspaceId: "ws-main", workspaceKind: "checkout" })],
      }),
      collapsed: true,
    });

    expect(result).toEqual({
      kind: "project_section",
      chevron: "expand",
      trailingAction: {
        kind: "new_workspace",
        target: { serverId: "srv", projectId: "project-srv", iconWorkingDir: "/repo" },
      },
    });
  });

  it("shows the new workspace action for a non-git project when the host supports workspace multiplicity", () => {
    const result = buildSidebarProjectRowModel({
      project: project({ projectKind: "directory", workspaces: [] }),
      collapsed: false,
      supportsMultiplicityByServerId: new Map([["srv", true]]),
    });

    expect(result.trailingAction).toEqual({
      kind: "new_workspace",
      target: { serverId: "srv", projectId: "project-srv", iconWorkingDir: "/repo" },
    });
  });

  it("hides the new workspace action for a non-git project when the host lacks workspace multiplicity", () => {
    const result = buildSidebarProjectRowModel({
      project: project({ projectKind: "directory", workspaces: [] }),
      collapsed: false,
      supportsMultiplicityByServerId: new Map([["srv", false]]),
    });

    expect(result.trailingAction).toEqual({ kind: "none" });
  });

  it("still shows the new workspace action for a git project regardless of multiplicity", () => {
    const result = buildSidebarProjectRowModel({
      project: project({ projectKind: "git" }),
      collapsed: false,
      supportsMultiplicityByServerId: new Map([["srv", false]]),
    });

    expect(result.trailingAction).toEqual({
      kind: "new_workspace",
      target: { serverId: "srv", projectId: "project-srv", iconWorkingDir: "/repo" },
    });
  });

  it("targets the project host, not route state, for new workspace actions", () => {
    const result = buildSidebarProjectRowModel({
      project: project({
        hosts: [
          {
            serverId: "host-a",
            iconWorkingDir: "/repo/a",
            worktreeSupport: "unsupported" as const,
          },
          { serverId: "host-b", iconWorkingDir: "/repo/b", worktreeSupport: "supported" as const },
        ],
      }),
      collapsed: false,
    });

    expect(result).toMatchObject({
      trailingAction: {
        kind: "new_workspace",
        target: { serverId: "host-b", iconWorkingDir: "/repo/b" },
      },
    });
  });

  it("targets the first multiplicity-capable host for a non-git project", () => {
    const result = buildSidebarProjectRowModel({
      project: project({
        projectKind: "directory",
        hosts: [
          {
            serverId: "host-a",
            iconWorkingDir: "/repo/a",
            worktreeSupport: "unsupported" as const,
          },
          {
            serverId: "host-b",
            iconWorkingDir: "/repo/b",
            worktreeSupport: "unsupported" as const,
          },
        ],
      }),
      collapsed: false,
      supportsMultiplicityByServerId: new Map([["host-b", true]]),
    });

    expect(result).toMatchObject({
      trailingAction: {
        kind: "new_workspace",
        target: { serverId: "host-b", iconWorkingDir: "/repo/b" },
      },
    });
  });

  it("renders a multi-workspace git project as an expandable section with a new workspace action", () => {
    const result = buildSidebarProjectRowModel({
      project: project({
        projectKind: "git",
        workspaces: [
          workspace({ workspaceId: "ws-main", workspaceKind: "checkout" }),
          workspace({ workspaceId: "ws-feature", workspaceKind: "worktree" }),
        ],
      }),
      collapsed: true,
    });

    expect(result).toEqual({
      kind: "project_section",
      chevron: "expand",
      trailingAction: {
        kind: "new_workspace",
        target: { serverId: "srv", projectId: "project-srv", iconWorkingDir: "/repo" },
      },
    });
  });

  it("resolves project icons from the project host, not the focused host", () => {
    const iconTarget = resolveSidebarProjectIconTarget(
      project({
        hosts: [
          { serverId: "host-b", iconWorkingDir: "/repo/b", worktreeSupport: "supported" as const },
          { serverId: "host-a", iconWorkingDir: "/repo/a", worktreeSupport: "supported" as const },
        ],
      }),
    );

    expect(iconTarget).toEqual({
      serverId: "host-b",
      projectId: "project-host-b",
      iconWorkingDir: "/repo/b",
    });
  });

  it("keys project icon results by the rendered project view", () => {
    const [iconTarget] = resolveSidebarProjectIconTargets([
      project({
        viewKey: '["placement","host-b","project-b"]',
        hosts: [
          {
            serverId: "host-b",
            iconWorkingDir: "/repo/b",
            worktreeSupport: "supported" as const,
            iconRevision: "effective-revision",
          },
        ],
      }),
    ]);

    expect(iconTarget).toEqual({
      projectViewKey: '["placement","host-b","project-b"]',
      serverId: "host-b",
      projectId: "project-host-b",
      iconWorkingDir: "/repo/b",
      iconRevision: "effective-revision",
    });
  });

  it("resolves desktop file actions from the local project placement", () => {
    const groupedProject = project({
      iconWorkingDir: "/remote/repo",
      hosts: [
        {
          serverId: "remote",
          iconWorkingDir: "/remote/repo",
          worktreeSupport: "supported" as const,
        },
        { serverId: "local", iconWorkingDir: "/local/repo", worktreeSupport: "supported" as const },
      ],
    });

    expect(resolveSidebarProjectLocalPath(groupedProject, "local")).toBe("/local/repo");
    expect(resolveSidebarProjectLocalPath(groupedProject, "missing")).toBe("");
  });

  it("renders an empty project as an expandable section", () => {
    const result = buildSidebarProjectRowModel({
      project: project({ projectKind: "git", workspaces: [] }),
      collapsed: false,
    });

    expect(result).toEqual({
      kind: "project_section",
      chevron: "collapse",
      trailingAction: {
        kind: "new_workspace",
        target: { serverId: "srv", projectId: "project-srv", iconWorkingDir: "/repo" },
      },
    });
  });
});

describe("project new conversation", () => {
  const target = { serverId: "srv", projectId: "rea", iconWorkingDir: "/repo" };
  it("reuses the directory workspace without creating another workspace", async () => {
    const client = { createWorkspace: vi.fn() };
    const existing = workspace();
    expect(await prepareSidebarConversationWorkspace(client, target, [existing])).toEqual({
      workspaceId: existing.workspaceId,
      workspace: null,
    });
    expect(client.createWorkspace).not.toHaveBeenCalled();
  });
  it("creates a directory workspace only when the project has none", async () => {
    const client = {
      createWorkspace: vi.fn().mockResolvedValue({ workspace: { id: "rea-work" } }),
    };
    expect(await prepareSidebarConversationWorkspace(client, target, [])).toEqual({
      workspaceId: "rea-work",
      workspace: { id: "rea-work" },
    });
    expect(client.createWorkspace).toHaveBeenCalledWith({
      idempotencyKey: expect.any(String),
      source: { kind: "directory", path: "/repo", projectId: "rea" },
    });
  });
  it("does not use a workspace on another host even if its path matches", async () => {
    const client = { createWorkspace: vi.fn().mockResolvedValue({ workspace: { id: "remote" } }) };
    expect(
      (
        await prepareSidebarConversationWorkspace(client, target, [
          workspace({ serverId: "other" }),
        ])
      ).workspaceId,
    ).toBe("remote");
    expect(client.createWorkspace).toHaveBeenCalledTimes(1);
  });
});
