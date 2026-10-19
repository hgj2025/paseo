// @vitest-environment jsdom
import React, { useEffect, useState, type ReactNode } from "react";
import { act, cleanup, renderHook, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelHostProvider, useModelHostContext, type ModelHostAnchor } from "./model-host-context";
import {
  loadModelHostDestinations,
  browseModelHostDirectory,
  parentModelHostDirectory,
  searchModelHostDirectories,
  resolveModelHostDestination,
} from "./model-host-destinations";

const anchor: ModelHostAnchor = {
  ownerKey: "mac:work",
  paneId: "right",
  serverId: "devbox",
  member: {
    id: "member",
    alias: "Claude",
    agentId: "conversation",
    provider: "claude",
    serverId: "devbox",
    workspaceId: "work",
    role: "",
    skills: [],
  },
  teamContext: null,
};
const switchedAnchor = {
  ...anchor,
  member: {
    ...anchor.member!,
    execution: {
      serverId: "mac",
      workspaceId: "work",
      agentId: "new-runner",
      provider: "codex",
      operationId: "new-operation",
    },
  },
};

afterEach(cleanup);
describe("model panel host candidate", () => {
  it("stages a host without replacing the conversation or its member", () => {
    const { result } = renderHook(useModelHostContext, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ModelHostProvider value={anchor}>{children}</ModelHostProvider>
      ),
    });
    act(() =>
      result.current!.selectCandidate({ serverId: "mac", workspaceId: "work", directory: "/code" }),
    );
    expect(result.current!.candidate?.serverId).toBe("mac");
    expect(result.current!.member).toBe(anchor.member);
    expect(result.current!.serverId).toBe("devbox");
    act(() => result.current!.selectCandidate(null));
    expect(result.current!.candidate).toBeNull();
  });
  it("previews remote models without requiring an execution directory", async () => {
    const { result } = renderHook(useModelHostContext, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ModelHostProvider value={anchor}>{children}</ModelHostProvider>
      ),
    });
    act(() => result.current!.selectHost("mac"));
    expect(result.current!.previewHost).toBe("mac");
    expect(result.current!.candidate).toBeNull();
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current!.requestScope();
    });
    expect(result.current!.scopeRequested).toBe(true);
    const scope = { serverId: "mac", workspaceId: "work", directory: "/code" };
    act(() => result.current!.selectCandidate(scope));
    await expect(pending).resolves.toEqual(scope);
    expect(result.current!.scopeRequested).toBe(false);
  });
  it("cancels directory selection without losing the preview host", async () => {
    const { result } = renderHook(useModelHostContext, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ModelHostProvider value={anchor}>{children}</ModelHostProvider>
      ),
    });
    act(() => result.current!.selectHost("mac"));
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current!.requestScope();
    });
    act(() => result.current!.cancelScopeRequest());
    await expect(pending).resolves.toBeNull();
    expect(result.current!.previewHost).toBe("mac");
    expect(result.current!.candidate).toBeNull();
  });
  it("clears the candidate when a new execution binding commits, keeping the same anchor", () => {
    let value = anchor;
    const { result, rerender } = renderHook(useModelHostContext, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ModelHostProvider value={value}>{children}</ModelHostProvider>
      ),
    });
    act(() =>
      result.current!.selectCandidate({ serverId: "mac", workspaceId: "work", directory: "/code" }),
    );
    value = {
      ...anchor,
      member: {
        ...anchor.member!,
        execution: {
          serverId: "mac",
          workspaceId: "work",
          agentId: "runner",
          provider: "codex",
          operationId: "operation",
        },
      },
    };
    rerender();
    expect(result.current!.candidate).toBeNull();
    expect(result.current!.member?.id).toBe("member");
    expect(result.current!.member?.agentId).toBe("conversation");
  });
  it("keeps the mounted pane state while its native executor changes", () => {
    let mounts = 0;
    function PaneProbe() {
      const [draft] = useState("unsent draft");
      const context = useModelHostContext();
      useEffect(() => {
        mounts += 1;
      }, []);
      return (
        <div>
          {draft}:{context?.member?.execution?.agentId ?? context?.member?.agentId}
        </div>
      );
    }
    const { rerender } = render(
      <ModelHostProvider value={anchor}>
        <PaneProbe />
      </ModelHostProvider>,
    );
    rerender(
      <ModelHostProvider value={switchedAnchor}>
        <PaneProbe />
      </ModelHostProvider>,
    );
    expect(screen.getByText("unsent draft:new-runner")).toBeTruthy();
    expect(mounts).toBe(1);
  });
});

describe("model host destinations", () => {
  it("offers registered projects when the remote host has no active workspaces", async () => {
    const client = {
      fetchWorkspaces: vi.fn().mockResolvedValue({
        entries: [],
        emptyProjects: [{ projectId: "video", projectRootPath: "/home/research/code/aigcvideo" }],
        pageInfo: { hasMore: false, nextCursor: null },
      }),
    };
    expect(await loadModelHostDestinations(client, "devbox")).toEqual([
      {
        kind: "project",
        id: "project:video",
        label: "/home/research/code/aigcvideo",
        projectId: "video",
        directory: "/home/research/code/aigcvideo",
      },
    ]);
  });

  it("shows each remote directory once even when multiple workspaces use it", async () => {
    const client = {
      fetchWorkspaces: vi.fn().mockResolvedValue({
        entries: [
          { id: "one", workspaceDirectory: "/code/video" },
          { id: "two", workspaceDirectory: "/code/video" },
        ],
        emptyProjects: [],
        pageInfo: { hasMore: false, nextCursor: null },
      }),
    };
    const choices = await loadModelHostDestinations(client, "devbox");
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({ kind: "workspace", id: "one", label: "/code/video" });
  });

  it("loads all workspace pages and excludes workspaces being archived", async () => {
    const client = {
      fetchWorkspaces: vi
        .fn()
        .mockResolvedValueOnce({
          entries: [{ id: "old", archivingAt: "now" }],
          emptyProjects: [],
          pageInfo: { hasMore: true, nextCursor: "page2" },
        })
        .mockResolvedValueOnce({
          entries: [{ id: "active", workspaceDirectory: "/code" }],
          emptyProjects: [],
          pageInfo: { hasMore: false, nextCursor: null },
        }),
    };
    expect(await loadModelHostDestinations(client, "devbox")).toEqual([
      {
        kind: "workspace",
        id: "active",
        label: "/code",
        scope: { serverId: "devbox", workspaceId: "active", directory: "/code" },
      },
    ]);
    expect(client.fetchWorkspaces).toHaveBeenNthCalledWith(2, {
      page: { limit: 200, cursor: "page2" },
    });
  });

  it("propagates connection failures instead of displaying an empty directory", async () => {
    const client = { fetchWorkspaces: vi.fn().mockRejectedValue(new Error("Host disconnected")) };
    await expect(loadModelHostDestinations(client, "devbox")).rejects.toThrow("Host disconnected");
  });
});

describe("remote directory selection", () => {
  it("finds existing directories even when they are not registered projects", async () => {
    const client = {
      getDirectorySuggestions: vi.fn().mockResolvedValue({
        entries: [
          { path: "/home/research/code/rea", kind: "directory" },
          { path: "/home/research/code/rea/README.md", kind: "file" },
        ],
      }),
    };
    expect(await searchModelHostDirectories(client, "rea")).toEqual([
      {
        kind: "directory",
        id: "directory:/home/research/code/rea",
        label: "/home/research/code/rea",
        directory: "/home/research/code/rea",
      },
    ]);
    expect(client.getDirectorySuggestions).toHaveBeenCalledWith({
      query: "rea",
      includeDirectories: true,
      includeFiles: false,
      limit: 30,
    });
  });
});

describe("project directory continuity", () => {
  const source = "/Users/bytedance/vmcode/aigcvideo";
  const target = "/home/research/code/aigcvideo";
  const choices = [
    {
      kind: "workspace" as const,
      id: "rea",
      label: "/home/research/code/rea",
      scope: { serverId: "devbox", workspaceId: "rea", directory: "/home/research/code/rea" },
    },
    {
      kind: "workspace" as const,
      id: "video",
      label: target,
      scope: { serverId: "devbox", workspaceId: "video", directory: target },
    },
  ];
  it("selects the same project on another host without asking for a directory", () => {
    expect(resolveModelHostDestination(choices, source, target)).toBe(choices[1]);
  });
  it("keeps an exact current workspace instead of falling back to its project root", () => {
    expect(resolveModelHostDestination(choices, choices[0]!.label, target)).toBe(choices[0]);
  });
  it("prepares an empty same-project directory when there is no active workspace", () => {
    const project = {
      kind: "project" as const,
      id: "project:video",
      label: target,
      projectId: "video",
      directory: target,
    };
    expect(resolveModelHostDestination([choices[0]!, project], source, target)).toBe(project);
  });
  it("does not guess a different project when the selected host has no mapping", () => {
    expect(resolveModelHostDestination(choices, source, undefined)).toBeUndefined();
  });
});

describe("host filesystem browser", () => {
  it("lists unregistered directories using the target host filesystem", async () => {
    const client = {
      listDirectory: vi.fn().mockResolvedValue({
        path: ".",
        entries: [
          { name: "rea", path: "rea", kind: "directory" },
          { name: "README.md", path: "README.md", kind: "file" },
          { name: "ip", path: "ip", kind: "directory" },
        ],
      }),
    };
    expect(await browseModelHostDirectory(client, "/home/research/code/")).toEqual([
      {
        kind: "directory",
        id: "/home/research/code/ip",
        label: "ip",
        directory: "/home/research/code/ip",
      },
      {
        kind: "directory",
        id: "/home/research/code/rea",
        label: "rea",
        directory: "/home/research/code/rea",
      },
    ]);
    expect(client.listDirectory).toHaveBeenCalledWith("/home/research/code/", ".");
  });
  it("navigates up without passing the filesystem root", () => {
    expect(parentModelHostDirectory("/home/research/code/")).toBe("/home/research");
    expect(parentModelHostDirectory("/home")).toBe("/");
    expect(parentModelHostDirectory("/")).toBe("/");
  });
  it("keeps filesystem permission errors visible to the caller", async () => {
    const client = { listDirectory: vi.fn().mockRejectedValue(new Error("Permission denied")) };
    await expect(browseModelHostDirectory(client, "/private")).rejects.toThrow("Permission denied");
  });
});
