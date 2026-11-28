import { ActiveSessionSidebarView } from "@/home-overview/sidebar-view";
import { buildHomeSessions } from "@/home-overview/model";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { within } from "@testing-library/dom";
import { page } from "vitest/browser";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { HistoryHealthBadge } from "./badge";
import { historyHealthStore } from "./model";
vi.mock("lucide-react-native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("lucide-react-native")>()),
  TriangleAlert: (
    await vi.importActual<{ default: React.ComponentType<Record<string, unknown>> }>(
      "../../node_modules/lucide-react-native/dist/esm/icons/triangle-alert.mjs",
    )
  ).default,
}));
vi.mock("react-native-unistyles", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-native-unistyles")>();
  return {
    ...original,
    withUnistyles: (Component: React.ComponentType<Record<string, unknown>>) =>
      function Styled({ uniProps, ...props }: Record<string, unknown>) {
        const mapped =
          typeof uniProps === "function" ? uniProps(original.useUnistyles().theme) : {};
        return React.createElement(Component, { ...props, ...mapped });
      },
  };
});
vi.mock("react-native-svg", () => ({
  Svg: (props: Record<string, unknown>) => React.createElement("svg", props),
  default: ({
    accessibilityElementsHidden: _hidden,
    importantForAccessibility: _importance,
    ...props
  }: Record<string, unknown>) => React.createElement("svg", props),
  Path: (props: Record<string, unknown>) => React.createElement("path", props),
  Line: (props: Record<string, unknown>) => React.createElement("line", props),
  Polyline: (props: Record<string, unknown>) => React.createElement("polyline", props),
  Circle: (props: Record<string, unknown>) => React.createElement("circle", props),
}));
let root: Root, container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("React", React);
  await i18n.changeLanguage("zh-CN");
  container = document.createElement("div");
  container.style.cssText = "width:340px;background:#fafafa;color:#181818;padding:20px";
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
it("hides unassessed histories and opens details without selecting the parent session", async () => {
  const select = vi.fn();
  act(() =>
    root.render(
      <div onClick={select}>
        <HistoryHealthBadge serverId="sg-test" agentId="large" />
      </div>,
    ),
  );
  expect(within(container).queryByRole("button")).toBeNull();
  act(() =>
    historyHealthStore.observe("sg-test", "large", { rows: 15772, loadMs: 1820, processMs: 240 }),
  );
  act(() => within(container).getByRole("button", { name: "历史负载提示 · 点击查看" }).click());
  expect(select).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("15,772");
  expect(document.body.textContent).toContain("1820 ms");
  expect(document.body.textContent).toContain("与模型上下文用量无关");
  await page.screenshot({ path: "/private/tmp/paseo-history-health-details.png" });
});

it("keeps the warning in the real sidebar title row and leaves other hosts unmarked", async () => {
  const agent: AggregatedAgent = {
    id: "sidebar-large",
    serverId: "sg-sidebar",
    serverLabel: "sg",
    title: "sg-boe-test",
    provider: "codex",
    status: "idle",
    turn: { phase: "idle", cancellationRequestId: null },
    cwd: "/repo",
    createdAt: new Date(0),
    lastActivityAt: new Date(),
    requiresAttention: false,
    attentionReason: null,
    labels: {},
  };
  const sessions = buildHomeSessions(
    [agent, { ...agent, serverId: "mac-sidebar", serverLabel: "Mac", title: "普通会话" }],
    [
      { serverId: "sg-sidebar", label: "sg", fresh: true, connected: true },
      { serverId: "mac-sidebar", label: "Mac", fresh: true, connected: true },
    ],
  );
  const open = vi.fn();
  act(() => historyHealthStore.observe("sg-sidebar", agent.id, { rows: 15772 }));
  act(() =>
    root.render(
      <ActiveSessionSidebarView sessions={sessions} loading={false} openSession={open} />,
    ),
  );
  const ui = within(container);
  const warning = ui.getByRole("button", { name: "历史负载提示 · 点击查看" });
  expect(ui.getAllByRole("button", { name: "历史负载提示 · 点击查看" })).toHaveLength(1);
  const title = ui.getByText("sg-boe-test").getBoundingClientRect();
  const icon = warning.getBoundingClientRect();
  expect(Math.abs(icon.top - title.top)).toBeLessThan(16);
  expect(icon.left).toBeGreaterThanOrEqual(title.right - 1);
  await page.screenshot({ path: "/private/tmp/paseo-history-health-sidebar.png" });
  act(() => warning.click());
  expect(open).not.toHaveBeenCalled();
});
