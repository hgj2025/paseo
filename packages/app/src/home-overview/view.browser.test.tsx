import { SidebarRailContext } from "@/components/sidebar/sidebar-rail-context";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { ActiveSessionSidebarView } from "./sidebar-view";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { within } from "@testing-library/dom";
import { page } from "vitest/browser";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { buildHomeSessions } from "./model";
import { HomeOverviewView } from "./view";
import { NavigationRailView } from "./navigation-rail-view";
beforeEach(async () => {
  vi.stubGlobal("React", React);
  await i18n.changeLanguage("zh-CN");
});
const noop = () => {};
const workspaceFill = { flex: 1 };
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
});
function agent(input: Partial<AggregatedAgent>): AggregatedAgent {
  return {
    id: "same",
    serverId: "mac",
    serverLabel: "Mac",
    title: "Mac task",
    provider: "codex",
    status: "running",
    turn: { phase: "idle", cancellationRequestId: null },
    cwd: "/repo",
    createdAt: new Date(0),
    lastActivityAt: new Date(1000),
    requiresAttention: false,
    attentionReason: null,
    labels: {},
    ...input,
  };
}
it("defaults to live sessions on every host, exposes unread completion and navigates with the real host", async () => {
  const hosts = [
    { serverId: "mac", label: "Mac", connected: true, fresh: true },
    { serverId: "vm", label: "devbox", connected: true, fresh: true },
    { serverId: "sg", label: "sg", connected: false, fresh: false },
  ];
  const sessions = buildHomeSessions(
    [
      agent({}),
      agent({
        serverId: "vm",
        serverLabel: "devbox",
        title: "VM finished",
        status: "idle",
        requiresAttention: true,
        attentionReason: "finished",
      }),
      agent({ id: "idle", title: "Old idle", status: "idle" }),
      agent({
        serverId: "sg",
        serverLabel: "sg",
        title: "Offline finished",
        status: "idle",
        attentionReason: "finished",
        requiresAttention: true,
      }),
    ],
    hosts,
  );
  const open = vi.fn();
  container = document.createElement("div");
  container.style.cssText = "display:flex;width:min(100vw,1000px);height:700px";
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <>
        <NavigationRailView
          home
          projects={false}
          settings={false}
          attention={1}
          onHome={noop}
          onProjects={noop}
          onNew={noop}
          onHistory={noop}
          onSearch={noop}
          onSchedules={noop}
          onMore={noop}
          onSettings={noop}
        />
        <HomeOverviewView
          hosts={hosts}
          sessions={sessions}
          loading={false}
          openSession={open}
          refresh={noop}
        />
      </>,
    ),
  );
  const ui = within(container);
  expect(ui.queryByText("Old idle")).toBeNull();
  expect(ui.getByRole("button", { name: "devbox · VM finished · 已完成" })).toBeTruthy();
  expect(ui.getByRole("button", { name: "sg · Offline finished · 状态未确认" })).toBeTruthy();
  act(() => ui.getByRole("button", { name: "devbox · VM finished · 已完成" }).click());
  expect(open).toHaveBeenCalledWith("vm", "same");
  await page.screenshot({ path: "/private/tmp/paseo-home-overview.png" });
  act(() => ui.getByRole("button", { name: "所有未归档会话" }).click());
  expect(ui.getByText("Old idle")).toBeTruthy();
  act(() => ui.getByRole("button", { name: /^devbox$/ }).click());
  expect(ui.queryByText("Mac task")).toBeNull();
  expect(ui.getByText("VM finished")).toBeTruthy();
});

it("shows cross-host active sessions in a narrow sidebar without idle rows and opens the exact host", async () => {
  const hosts = [
    { serverId: "mac", label: "Mac", connected: true, fresh: true },
    { serverId: "vm", label: "devbox", connected: true, fresh: true },
  ];
  const sessions = buildHomeSessions(
    [
      agent({ title: "Running", serverLabel: "Mac", lastActivityAt: new Date() }),
      agent({
        serverId: "vm",
        serverLabel: "devbox",
        title: "Finished",
        lastActivityAt: new Date(),
        status: "idle",
        attentionReason: "finished",
        requiresAttention: true,
      }),
      agent({ id: "idle", title: "Old idle", status: "idle" }),
    ],
    hosts,
  );
  const open = vi.fn();
  container = document.createElement("div");
  container.style.cssText = "width:300px;height:500px";
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <ActiveSessionSidebarView sessions={sessions} loading={false} openSession={open} />,
    ),
  );
  const ui = within(container);
  expect(ui.getByText("今日活跃")).toBeTruthy();
  expect(ui.queryByText("Old idle")).toBeNull();
  act(() => ui.getByRole("button", { name: "devbox · Finished · 已完成" }).click());
  expect(open).toHaveBeenCalledWith("vm", "same");
  expect(container.getBoundingClientRect().width).toBe(300);
  await page.screenshot({ path: "/private/tmp/paseo-active-sidebar.png" });
});

it("keeps plugin navigation clickable and labeled in the icon rail without a text row", () => {
  const open = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <SidebarRailContext.Provider value={true}>
        <SidebarHeaderRow icon={null} label="项目记忆" onPress={open} testID="memory-rail-test" />
      </SidebarRailContext.Provider>,
    ),
  );
  const ui = within(container);
  expect(ui.queryByText("项目记忆")).toBeNull();
  act(() => ui.getByRole("button", { name: "项目记忆" }).click());
  expect(open).toHaveBeenCalledOnce();
});

it("fits the shared session list on a phone and closes its panel before cross-host navigation", async () => {
  const hosts = [
    { serverId: "mac", label: "Mac", connected: true, fresh: true },
    { serverId: "vm", label: "devbox", connected: false, fresh: false },
  ];
  const sessions = buildHomeSessions(
    Array.from({ length: 20 }, (_, index) =>
      agent({
        id: `task-${index}`,
        serverId: index === 0 ? "vm" : "mac",
        serverLabel: index === 0 ? "devbox" : "Mac",
        title:
          index === 0
            ? "A long session title that must remain inside the mobile drawer"
            : `Task ${index}`,
        lastActivityAt: new Date(Date.now() - index * 1000),
      }),
    ),
    hosts,
  );
  const open = vi.fn();
  const close = vi.fn();
  container = document.createElement("div");
  container.style.cssText = "display:flex;flex-direction:column;width:320px;height:568px";
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <>
        <ActiveSessionSidebarView
          compact
          sessions={sessions}
          loading={false}
          onBeforeNavigate={close}
          openSession={open}
        />
        <div data-testid="remaining-workspaces" style={workspaceFill}>
          Workspaces
        </div>
      </>,
    ),
  );
  const ui = within(container);
  const section = ui.getByTestId("sidebar-cross-host-active");
  const row = ui.getByRole("button", { name: /devbox · A long session title.*状态未确认/ });
  expect(section.getBoundingClientRect().height).toBeLessThanOrEqual(568 * 0.4 + 1);
  expect(section.getBoundingClientRect().height).toBeGreaterThan(100);
  expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
  expect(section.scrollWidth).toBeLessThanOrEqual(320);
  expect(ui.getByTestId("remaining-workspaces").getBoundingClientRect().height).toBeGreaterThan(
    300,
  );
  await page
    .elementLocator(container)
    .screenshot({ path: "/private/tmp/paseo-mobile-active-portrait.png" });
  act(() => row.click());
  expect(open).toHaveBeenCalledWith("vm", "task-0");
  expect(close.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[0]!);

  container.style.width = "568px";
  container.style.height = "320px";
  expect(section.getBoundingClientRect().height).toBeLessThanOrEqual(320 * 0.4 + 1);
  expect(section.scrollWidth).toBeLessThanOrEqual(568);
  await page
    .elementLocator(container)
    .screenshot({ path: "/private/tmp/paseo-mobile-active-landscape.png" });
});
