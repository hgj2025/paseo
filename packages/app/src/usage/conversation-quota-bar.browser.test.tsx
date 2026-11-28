import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { within } from "@testing-library/dom";
import { page } from "vitest/browser";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { AgentUsageView } from "./model";
import { ConversationQuotaBar } from "./conversation-quota-bar";
const state = vi.hoisted(() => ({ view: { kind: "none" } as AgentUsageView, usage: vi.fn() }));
vi.mock("./queries", () => ({
  useAgentUsage: (...args: unknown[]) => {
    state.usage(...args);
    return state.view;
  },
}));
vi.mock("./agent-usage", () => ({ AgentUsage: () => <div>Account usage details</div> }));
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
// The shared test stub hides SVGs; render real browser SVG primitives for the visual check.
vi.mock("react-native-svg", () => ({
  default: ({
    accessibilityElementsHidden: _hidden,
    importantForAccessibility: _importance,
    ...props
  }: Record<string, unknown>) => React.createElement("svg", props),
  Circle: (props: Record<string, unknown>) => React.createElement("circle", props),
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("React", React);
  await i18n.changeLanguage("zh-CN");
  container = document.createElement("div");
  container.style.cssText = "width:380px;padding:16px;background:#262624;color:white";
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  state.usage.mockClear();
});
it("shows a compact unnamed meter and sends the actual host and agent to the scoped query", async () => {
  state.view = {
    kind: "ready",
    reports: [
      {
        id: "claude:account",
        sourceId: "claude",
        sourceLabel: "Claude",
        account: {},
        fetchedAt: new Date().toISOString(),
        report: {
          status: "available",
          windows: [
            {
              id: "five_hour",
              label: "Session",
              usedPct: 72,
              resetsAt: new Date(Date.now() + 38 * 60_000).toISOString(),
            },
          ],
        },
      },
    ],
  };
  act(() => root.render(<ConversationQuotaBar serverId="devbox" agentId="captain" />));
  expect(container.textContent).toBe("5");
  expect(container.querySelectorAll("circle")).toHaveLength(2);
  expect(within(container).getByRole("button").getAttribute("aria-label")).toContain("72%");
  expect(within(container).getByRole("button").getAttribute("aria-label")).toContain("分钟后恢复");
  expect(container.textContent).not.toContain("Claude");
  expect(state.usage).toHaveBeenCalledWith("devbox", "captain", { active: true, poll: true });
  await page.screenshot({ path: "/private/tmp/paseo-conversation-quota-ring.png" });
  act(() =>
    within(container)
      .getByRole("button", { name: /5h.*72%/ })
      .click(),
  );
  expect(document.body.textContent).toContain("Account usage details");
});
it("shows an unavailable state rather than a misleading zero", () => {
  state.view = { kind: "error", message: "offline" };
  act(() => root.render(<ConversationQuotaBar serverId="home" agentId="other" />));
  expect(within(container).getByRole("button").getAttribute("aria-label")).toContain(
    "额度暂不可用",
  );
  expect(container.textContent).not.toContain("0%");
});
