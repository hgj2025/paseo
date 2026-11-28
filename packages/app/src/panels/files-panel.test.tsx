// @vitest-environment jsdom
import React, { useCallback, useEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { filesPanelRegistration } from "./files-panel";

const activity = vi.hoisted(() => ({ polls: vi.fn(), mounts: vi.fn(), releases: vi.fn() }));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: (component: unknown) => component,
}));
vi.mock("@/panels/pane-context", () => ({
  usePaneContext: () => ({
    serverId: "host",
    workspaceId: "workspace",
    target: { kind: "files" },
    openPreferredTarget: vi.fn(),
  }),
}));
vi.mock("@/panels/use-add-file-to-chat", () => ({
  useAddFileToChat: () => ({ addFile: vi.fn(), canAddToChat: false }),
}));
vi.mock("@/stores/session-store-hooks", () => ({ useWorkspaceDirectory: () => "/repo" }));
vi.mock("./session-files-view", () => ({
  sessionFilesStyles: {},
  SessionFilesTabs: ({ onChange }: { onChange: (mode: string) => void }) => {
    const handleClick = useCallback(() => onChange("directory"), [onChange]);
    return (
      <button type="button" onClick={handleClick}>
        Tree
      </button>
    );
  },
}));
vi.mock("./session-files", () => ({
  SessionFiles: ({ onBrowse }: { onBrowse: (scope: object, path: string) => void }) => {
    useEffect(() => {
      activity.mounts();
      const timer = setInterval(activity.polls, 10_000);
      return () => {
        clearInterval(timer);
        activity.releases();
      };
    }, []);
    const handleBrowse = useCallback(
      () => onBrowse({ serverId: "remote", workspaceId: "other" }, "/browse"),
      [onBrowse],
    );
    return (
      <button type="button" onClick={handleBrowse}>
        Browse
      </button>
    );
  },
}));
vi.mock("@/components/file-explorer-pane", () => ({
  FileExplorerPane: ({ workspaceRoot }: { workspaceRoot: string }) => (
    <div>Directory:{workspaceRoot}</div>
  ),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});
const FilesPanel = filesPanelRegistration.component;
const panel = (workspaceActive: boolean, tabActive = true) => (
  <RetainedPanelActivity active={workspaceActive}>
    <RetainedPanelActivity active={tabActive}>
      <FilesPanel />
    </RetainedPanelActivity>
  </RetainedPanelActivity>
);
it("does not start hidden content and stops polling when a retained tab becomes hidden", () => {
  vi.useFakeTimers();
  const view = render(panel(true, false));
  act(() => vi.advanceTimersByTime(30_000));
  expect(activity.mounts).not.toHaveBeenCalled();
  view.rerender(panel(true));
  act(() => vi.advanceTimersByTime(10_000));
  expect(activity.polls).toHaveBeenCalledTimes(1);
  view.rerender(panel(true, false));
  expect(activity.releases).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(30_000));
  expect(activity.polls).toHaveBeenCalledTimes(1);
  view.rerender(panel(true));
  expect(activity.mounts).toHaveBeenCalledTimes(2);
});
it("releases directory content with a hidden workspace and restores its browse location", () => {
  const view = render(panel(true));
  fireEvent.click(screen.getByText("Browse"));
  expect(screen.getByText("Directory:/browse")).toBeTruthy();
  view.rerender(panel(false));
  expect(screen.queryByText("Directory:/browse")).toBeNull();
  view.rerender(panel(true));
  expect(screen.getByText("Directory:/browse")).toBeTruthy();
  expect(activity.mounts).toHaveBeenCalledTimes(1);
});
