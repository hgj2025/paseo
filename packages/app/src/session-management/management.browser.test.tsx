import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { within } from "@testing-library/dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { HistoryManagementToolbar } from "./toolbar";
import { ArchiveRuleSheet } from "./rule-sheet";
const fake = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn() }));
vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({
    entries: [
      { provider: "custom-source", label: "Custom Source", enabled: true, status: "ready" },
    ],
    isLoading: false,
  }),
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    value,
    onValueChange,
    accessibilityLabel,
    disabled,
  }: {
    value: boolean;
    onValueChange: (value: boolean) => void;
    accessibilityLabel: string;
    disabled: boolean;
  }) =>
    React.createElement("input", {
      type: "checkbox",
      role: "switch",
      checked: value,
      "aria-label": accessibilityLabel,
      disabled,
      onChange: () => onValueChange(!value),
    }),
}));
vi.mock("@/components/ui/combobox", () => ({ Combobox: () => null, ComboboxItem: () => null }));
vi.mock("./runtime", () => ({ getProtectedAgentIds: () => new Set() }));
vi.mock("./service", () => ({ loadHostHistory: (...args: unknown[]) => fake.load(...args) }));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ getClient: () => ({}) }),
}));
vi.mock("./store", () => ({
  useArchiveRules: Object.assign((select: (s: unknown) => unknown) => select({ reports: {} }), {
    getState: () => ({ rules: {}, setRule: fake.save }),
  }),
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
let root: Root, container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("React", React);
  await i18n.changeLanguage("zh-CN");
  fake.save.mockClear();
  fake.load.mockReset().mockResolvedValue([]);
  container = document.createElement("div");
  container.style.cssText = "width:390px;background:#262624;padding:16px";
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
it("offers explicit loaded-result selection and state filtering", () => {
  const setFilter = vi.fn(),
    select = vi.fn();
  act(() =>
    root.render(
      <HistoryManagementToolbar
        managing
        hostRequired={false}
        filter="all"
        setFilter={setFilter}
        provider=""
        setProvider={vi.fn()}
        directory=""
        setDirectory={vi.fn()}
        selected={0}
        busy={false}
        message=""
        selectLoaded={select}
        clear={vi.fn()}
        archive={vi.fn()}
        restore={vi.fn()}
      />,
    ),
  );
  act(() => within(container).getByRole("button", { name: "选择已加载" }).click());
  expect(select).toHaveBeenCalledOnce();
  act(() => within(container).getByRole("button", { name: "已归档" }).click());
  expect(setFilter).toHaveBeenCalledWith("archived");
  expect(container.textContent).toContain("选择范围是已加载的结果");
});
it("opens the actual rule sheet disabled by default and saves the host-scoped rule", () => {
  const close = vi.fn();
  act(() => root.render(<ArchiveRuleSheet serverId="home" hostName="home" onClose={close} />));
  expect(document.body.textContent).toContain("定期归档 · home");
  expect(document.body.textContent).not.toContain("Provider ID");
  expect(document.body.textContent).toContain("App 打开时执行");
  expect(document.body.textContent).not.toContain("包含子目录");
  act(() => within(document.body).getByRole("button", { name: "归档范围" }).click());
  expect(document.body.textContent).toContain("规则仅保存在当前设备");
  expect(document.body.textContent).toContain("包含子目录");
  act(() => within(document.body).getByRole("button", { name: "保存规则" }).click());
  expect(fake.save).toHaveBeenCalledWith("home", {
    enabled: false,
    olderThanDays: 30,
    provider: "",
    directory: "",
  });
  expect(close).toHaveBeenCalledOnce();
});
