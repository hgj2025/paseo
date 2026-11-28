import { ConnectionGraph } from "./graph";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { fireEvent, within } from "@testing-library/dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { HostConnectionView, type Probe } from "./view";
vi.mock("react-native-svg", async () => {
  const { createElement } = await import("react");
  const element = (tag: string) => (props: Record<string, unknown>) => {
    const { children, onPress, testID, uniProps: _themeMapping, ...attributes } = props;
    return createElement(
      tag,
      { ...attributes, onClick: onPress, "data-testid": testID },
      children as React.ReactNode,
    );
  };
  return {
    default: element("svg"),
    G: element("g"),
    Path: element("path"),
    Rect: element("rect"),
    Text: element("text"),
    Circle: element("circle"),
    Defs: element("defs"),
    Marker: element("marker"),
  };
});
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("React", React);
  await i18n.changeLanguage("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const probe = {
  checkedAt: new Date().toISOString(),
  latencyMs: 12,
  error: false,
  supported: true,
  report: {
    routes: [
      {
        hostId: "devbox",
        label: "devbox",
        transport: "ssh",
        status: "error",
        latencyMs: null,
        error: "disconnected",
      },
    ],
  },
} as Probe;
it("keeps a verified App hop separate from a failed collaboration hop", async () => {
  await act(async () =>
    root.render(
      <HostConnectionView
        label="hgj"
        bordered={false}
        labels={[]}
        snapshot={null}
        online
        probe={probe}
        checking={false}
      />,
    ),
  );
  const view = within(container);
  expect(view.getByText("此 Mac App → hgj daemon")).toBeTruthy();
  expect(view.getByText("hgj → devbox")).toBeTruthy();
  expect(container.textContent).toContain("已验证");
  expect(container.textContent).toContain("检测失败");
  expect(container.textContent).toContain("目标 daemon 已断开");
});
it("does not retain green verification when checking or disconnected", async () => {
  await act(async () =>
    root.render(
      <HostConnectionView
        label="hgj"
        bordered={false}
        labels={[]}
        snapshot={null}
        online
        probe={probe}
        checking
      />,
    ),
  );
  expect(container.textContent).not.toContain("已验证");
  await act(async () =>
    root.render(
      <HostConnectionView
        label="hgj"
        bordered={false}
        labels={[]}
        snapshot={null}
        online={false}
        probe={probe}
        checking={false}
      />,
    ),
  );
  expect(container.textContent).toContain("已断开");
  expect(container.textContent).not.toContain("hgj → devbox");
});

it("renders the real Mac relay hop and selects nodes for details", async () => {
  const select = vi.fn();
  const graphProbe = {
    ...probe,
    report: {
      ...probe.report,
      routes: [
        {
          hostId: "devbox",
          label: "devbox",
          transport: "mac",
          status: "ok",
          latencyMs: 100,
          error: null,
        },
        {
          hostId: "dev1",
          label: "dev1",
          transport: "ssh",
          status: "error",
          latencyMs: null,
          error: "disconnected",
        },
      ],
    },
  } as Probe;
  const graphStates = Object.fromEntries([
    ["hgj", { serverId: "hgj", label: "hgj", online: true, checking: false, probe: graphProbe }],
  ]);
  const palette = Object.freeze({
    ink: "black",
    muted: "gray",
    surface: "white",
    border: "gray",
    ok: "green",
    error: "red",
    unchecked: "gray",
  });
  await act(async () =>
    root.render(
      <ConnectionGraph
        palette={palette}
        hosts={[
          { serverId: "hgj", label: "hgj" },
          { serverId: "devbox", label: "devbox" },
        ]}
        states={graphStates}
        selected="hgj"
        onSelect={select}
      />,
    ),
  );
  const view = within(container);
  expect(view.getByText("当前 Mac App")).toBeTruthy();
  expect(view.getByText("请求 → Mac → 目标")).toBeTruthy();
  expect(view.getByText("dev1")).toBeTruthy();
  await act(async () => fireEvent.click(view.getByTestId("connection-node-hgj")));
  expect(select).toHaveBeenCalledWith("hgj");
});
