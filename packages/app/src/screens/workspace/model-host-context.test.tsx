// @vitest-environment jsdom
import React, { useEffect, useState, type ReactNode } from "react";
import { act, cleanup, renderHook, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelHostProvider, useModelHostContext, type ModelHostAnchor } from "./model-host-context";
import { loadModelHostDestinations, searchModelHostDirectories } from "./model-host-destinations";

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
