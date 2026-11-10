import { SessionFilesTabs, SessionFilesView } from "../panels/session-files-view";
import { ExecutionContextView } from "./execution-context-view";
import { executionDirectories } from "./execution-context-model";
import { i18n } from "@/i18n/i18next";
import { page } from "vitest/browser";
import type { StreamItem } from "@/types/stream";
import React, { act, useCallback, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Pressable, Text } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { ComposerTrackPill, ComposerTrackRow, type ComposerTrackPillSegment } from "./tracks";

vi.mock("react-native-unistyles", async () => {
  const base =
    await vi.importActual<typeof import("../../test-stubs/react-native-unistyles")>(
      "react-native-unistyles",
    );
  const { darkClaudeTheme } = await import("@/styles/theme");
  const theme = {
    ...darkClaudeTheme,
    colors: { ...darkClaudeTheme.colors, statusDotRunning: "#268ae0", statusDotDanger: "#f12e2f" },
  };
  return {
    ...base,
    StyleSheet: {
      create: (styles: unknown) => (typeof styles === "function" ? styles(theme) : styles),
    },
    useUnistyles: () => ({ theme, rt: {}, breakpoint: "md" }),
  };
});

const SUBAGENT_SEGMENTS: ComposerTrackPillSegment[] = [{ bucket: null, text: "3 subagents" }];

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

/**
 * The real menu engine, in a real browser, because both things under test only exist there: the
 * panel's dismissal runs through `selectItem`, and the running mark is a Web Animations rotation
 * that jsdom cannot report.
 */

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}

const mounted: Mounted[] = [];

function mount(node: ReactNode): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted.push({ root, container });
  return container;
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function click(element: Element): void {
  act(() => {
    (element as HTMLElement).click();
  });
}

function pill(): HTMLElement {
  const trigger = document.querySelector('[data-testid="pill"]');
  if (!(trigger instanceof HTMLElement)) {
    throw new Error("track pill did not render");
  }
  return trigger;
}

function openPanel(): void {
  click(pill());
}

function row(testID: string): Element | null {
  return document.querySelector(`[data-testid="${testID}"]`);
}

function isPanelOpen(): boolean {
  return pill().getAttribute("aria-expanded") === "true";
}

describe("composer track panel", () => {
  it("dismisses itself when a row is chosen", () => {
    const onPress = vi.fn();
    mount(
      <ComposerTrackPill testID="pill" segments={SUBAGENT_SEGMENTS} panelTitle="Subagents">
        <ComposerTrackRow accessibilityLabel="Subagent one" testID="row" onPress={onPress}>
          <Text>Subagent one</Text>
        </ComposerTrackRow>
      </ComposerTrackPill>,
    );

    openPanel();
    const target = row("row");
    expect(target).not.toBeNull();

    click(target as Element);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(isPanelOpen()).toBe(false);
    expect(row("row")).toBeNull();
  });

  it("stays open for a row whose result lands in the panel", () => {
    const onPress = vi.fn();
    mount(
      <ComposerTrackPill testID="pill" segments={SUBAGENT_SEGMENTS} panelTitle="Subagents">
        <ComposerTrackRow
          accessibilityLabel="Archive finished"
          testID="row"
          closeOnSelect={false}
          onPress={onPress}
        >
          <Text>Archive finished</Text>
        </ComposerTrackRow>
      </ComposerTrackPill>,
    );

    openPanel();
    click(row("row") as Element);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(isPanelOpen()).toBe(true);
    expect(row("row")).not.toBeNull();
  });

  it("closes for good when the panel it belongs to leaves the screen", () => {
    const onPress = vi.fn();
    function Harness() {
      const [active, setActive] = useState(true);
      const hide = useCallback(() => setActive(false), []);
      const show = useCallback(() => setActive(true), []);
      return (
        <>
          <Pressable accessibilityRole="button" testID="hide" onPress={hide} />
          <Pressable accessibilityRole="button" testID="show" onPress={show} />
          <RetainedPanelActivity active={active}>
            <ComposerTrackPill testID="pill" segments={SUBAGENT_SEGMENTS} panelTitle="Subagents">
              <ComposerTrackRow
                accessibilityLabel="Subagent one"
                testID="row"
                closeOnSelect={false}
                onPress={onPress}
              >
                <Text>Subagent one</Text>
              </ComposerTrackRow>
            </ComposerTrackPill>
          </RetainedPanelActivity>
        </>
      );
    }
    mount(<Harness />);

    openPanel();
    expect(isPanelOpen()).toBe(true);

    click(row("hide") as Element);
    click(row("show") as Element);

    expect(isPanelOpen()).toBe(false);
    expect(row("row")).toBeNull();
  });

  it("leaves the panel alone when a row's own action button is pressed", () => {
    const onPress = vi.fn();
    const onAction = vi.fn();
    mount(
      <ComposerTrackPill testID="pill" segments={SUBAGENT_SEGMENTS} panelTitle="Subagents">
        <ComposerTrackRow accessibilityLabel="Subagent one" testID="row" onPress={onPress}>
          <Text>Subagent one</Text>
          <Pressable accessibilityRole="button" testID="row-archive" onPress={onAction}>
            <Text>Archive</Text>
          </Pressable>
        </ComposerTrackRow>
      </ComposerTrackPill>,
    );

    openPanel();
    click(row("row-archive") as Element);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
    expect(isPanelOpen()).toBe(true);
  });
});

describe("composer track pill status mark", () => {
  /** The mark is the glyph itself: the dot for a still state, the ring's carrier for running. */
  function mountMark(bucket: "running" | "failed"): { mark: HTMLElement; body: HTMLElement } {
    const container = mount(
      <ComposerTrackPill
        testID="pill"
        segments={[{ bucket, text: "3 subagents" }]}
        panelTitle="Subagents"
      >
        <Text>rows</Text>
      </ComposerTrackPill>,
    );
    const segment = container.querySelector('[data-testid="pill-segment-0"]');
    const body = container.querySelector('[data-testid="pill"]');
    if (!(segment?.firstElementChild instanceof HTMLElement) || !(body instanceof HTMLElement)) {
      throw new Error("pill did not render a status mark");
    }
    return { mark: segment.firstElementChild, body };
  }

  it("spins the shared ring while a child is running", () => {
    const { mark } = mountMark("running");
    const animated = [...mark.querySelectorAll("*")].filter(
      (element) => element.getAnimations().length > 0,
    );

    expect(animated).toHaveLength(1);
    // The rotation is on the carrier; the quarter arc it turns is the coloured top border inside.
    const arc = animated[0]?.firstElementChild as HTMLElement;
    const arcStyle = getComputedStyle(arc);
    expect(arcStyle.borderTopColor).toBe("rgb(38, 138, 224)");
    expect(arcStyle.borderLeftColor).toBe("rgba(0, 0, 0, 0)");
  });

  it("draws a still dot for every other state", () => {
    const { mark } = mountMark("failed");
    const animated = [...mark.querySelectorAll("*")].filter(
      (element) => element.getAnimations().length > 0,
    );

    expect(animated).toHaveLength(0);
    expect(getComputedStyle(mark).backgroundColor).toBe("rgb(241, 46, 47)");
  });

  it("starts the circle you can see on the pill's own padding, whatever the state", () => {
    // The inset the eye compares a leading mark against is the label's trailing one, and that one
    // is the pill's padding. A mark boxed wider than its glyph sits further in than that while
    // looking correctly centred in the box nobody can see.
    for (const bucket of ["running", "failed"] as const) {
      const { mark, body } = mountMark(bucket);
      // The dot is its own box; the ring is drawn by the rotator inside the frame's halo.
      const glyph = bucket === "failed" ? mark : mark.firstElementChild?.firstElementChild;
      if (!(glyph instanceof HTMLElement)) {
        throw new Error(`${bucket} mark did not render a glyph`);
      }

      const style = getComputedStyle(body);
      const edge = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.borderLeftWidth);
      const inset = glyph.getBoundingClientRect().left - body.getBoundingClientRect().left;

      expect(inset).toBeCloseTo(edge, 1);
    }
  });

  it("draws every state it is given, so a running child survives a failed sibling", () => {
    const container = mount(
      <ComposerTrackPill
        testID="pill"
        segments={[
          { bucket: "failed", text: "1 failed" },
          { bucket: "running", text: "1 working" },
        ]}
        panelTitle="Subagents"
      >
        <Text>rows</Text>
      </ComposerTrackPill>,
    );

    const segments = [...container.querySelectorAll('[data-testid^="pill-segment-"]')];
    expect(segments.map((segment) => segment.textContent)).toEqual(["1 failed", "1 working"]);
    // The ring is the only mark that animates, so its presence proves the second state survived.
    const animated = segments[1]?.querySelectorAll("*") ?? [];
    expect([...animated].filter((element) => element.getAnimations().length > 0)).toHaveLength(1);
  });
});

const copyExecutionPath = vi.fn(async (_path: string) => {});
describe("composer execution context", () => {
  it("finds edits outside the launch directory and ignores failed tools and read-only paths", () => {
    const tool = (detail: object, status = "completed") =>
      ({ kind: "tool_call", payload: { source: "agent", data: { detail, status } } }) as StreamItem;
    expect(
      executionDirectories("/projects/chat", [
        tool({ type: "edit", filePath: "/projects/paseo/src/app.ts" }),
        tool({ type: "write", filePath: "readme.md" }),
        tool({ type: "read", filePath: "/secret/read.txt" }),
        tool({ type: "edit", filePath: "/failed/a.ts" }, "failed"),
        tool({ type: "shell", cwd: "/projects/paseo", command: "git status" }),
      ]),
    ).toEqual([
      { path: "/projects/chat", edited: true },
      { path: "/projects/paseo/src", edited: true },
      { path: "/projects/paseo", edited: false },
    ]);
  });
  it("shows full directory, real repository roots, branch changes and offline status at desktop and narrow widths", async () => {
    await i18n.changeLanguage("zh-CN");
    const container = mount(
      <ExecutionContextView
        onCopy={copyExecutionPath}
        cwd="/Users/bytedance/Documents/ChatGPT/ccproxy 2"
        connected
        loading={false}
        failed={false}
        repositories={[
          {
            root: "/Users/bytedance/code/github/paseo",
            branch: "codex/execution-context",
            dirty: true,
            edited: true,
            previousBranch: "main",
          },
          {
            root: "/Users/bytedance/Documents/ChatGPT/ccproxy 2",
            branch: "main",
            dirty: false,
            edited: false,
          },
          { root: "/home/research/projects/backend", branch: null, dirty: true, edited: true },
        ]}
      />,
    );
    await page.viewport(1100, 320);
    container.style.cssText = "width: 1000px; background: #272727; padding: 16px";
    expect(container.textContent).toContain("codex/execution-context");
    expect(container.textContent).toContain("已切换");
    expect(container.textContent).not.toContain("/Users/bytedance/code/github/paseo");
    expect(container.textContent).not.toContain("/home/research/projects/backend");
    const collapsedHeight = container.getBoundingClientRect().height;
    const toggle = container.querySelector('[data-testid="execution-context-toggle"]')!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const summaryCopy = Array.from(container.querySelectorAll('[role="button"]')).find(
      (node) => node.textContent === "codex/execution-context",
    )!;
    await act(async () => {
      (summaryCopy as HTMLElement).click();
    });
    expect(copyExecutionPath).toHaveBeenLastCalledWith("codex/execution-context");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const branchCopy = Array.from(container.querySelectorAll('[role="button"]')).find(
      (node) => node.textContent === "codex/execution-context",
    );
    expect(branchCopy).toBeDefined();
    await act(async () => {
      (branchCopy as HTMLElement).click();
    });
    expect(copyExecutionPath).toHaveBeenLastCalledWith("codex/execution-context");
    expect(container.textContent).toContain("游离 HEAD");
    expect(container.textContent).toContain("已从 main 切换");
    expect(container.textContent).toContain("/Users/bytedance/code/github/paseo");
    expect(container.getBoundingClientRect().height).toBeGreaterThan(collapsedHeight);
    await page.screenshot({ path: "/private/tmp/paseo-execution-context-desktop.png" });
    await page.viewport(400, 450);
    container.style.width = "340px";
    await page.screenshot({ path: "/private/tmp/paseo-execution-context-narrow.png" });
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
    click(toggle);
    expect(container.textContent).not.toContain("/home/research/projects/backend");
    expect(container.getBoundingClientRect().height).toBeLessThan(80);
    await page.screenshot({ path: "/private/tmp/paseo-execution-context-collapsed.png" });
    const entry = mounted[mounted.length - 1]!;
    act(() =>
      entry.root.render(
        <ExecutionContextView
          onCopy={copyExecutionPath}
          cwd="/repo"
          connected={false}
          loading={false}
          failed={false}
          repositories={[]}
        />,
      ),
    );
    expect(container.textContent).toContain("离线");
  });
});

describe("session repository sidebar", () => {
  it("groups edited files, collapses repositories and opens file and directory actions", async () => {
    await i18n.changeLanguage("zh-CN");
    const open = vi.fn(),
      browse = vi.fn(),
      refresh = vi.fn();
    const container = mount(
      <>
        <SessionFilesTabs mode="session" onChange={vi.fn()} />
        <SessionFilesView
          loading={false}
          failed={false}
          offline={false}
          onRetry={refresh}
          repositories={[
            {
              key: "main",
              host: "hgj",
              root: "/Users/bytedance/vmcode/mock2.0/mock_platform",
              git: true,
              pending: false,
              branch: "feature/venv-boe-support",
              files: [
                { path: "/Users/bytedance/vmcode/mock2.0/mock_platform/src/server.ts", open },
                { path: "/Users/bytedance/vmcode/mock2.0/mock_platform/src/handler.ts", open },
              ],
              directories: ["/Users/bytedance/vmcode/mock2.0/mock_platform"],
              browse,
            },
            {
              key: "worktree",
              host: "hgj",
              root: "/Users/bytedance/vmcode/mock2.0/wt-platform-tcc-mock",
              git: true,
              pending: false,
              branch: "research/tcc-mock-20261102",
              files: [
                {
                  path: "/Users/bytedance/vmcode/mock2.0/wt-platform-tcc-mock/config/routes.json",
                  open,
                },
              ],
              directories: [],
              browse,
            },
          ]}
        />
      </>,
    );
    container.style.cssText =
      "width:360px;height:760px;background:#272727;padding:0;display:flex;flex-direction:column";
    await page.viewport(380, 800);
    expect(container.textContent).toContain("2 个仓库 / 目录 · 3 个文件");
    const find = (text: string) =>
      Array.from(container.querySelectorAll('[role="button"]')).find(
        (node) => node.textContent === text,
      )!;
    const toggle = Array.from(container.querySelectorAll('[role="button"]')).find((node) =>
      node.textContent?.includes("mock_platform"),
    )!;
    expect(container.textContent).not.toContain("server.ts");
    expect(container.textContent).not.toContain("/Users/bytedance/vmcode");
    expect(container.textContent).not.toContain("浏览文件");
    expect(container.textContent).toContain("feature/venv-boe-support");
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
    await page.screenshot({ path: "/private/tmp/paseo-session-repositories-collapsed.png" });
    click(toggle);
    expect(container.textContent).toContain("/Users/bytedance/vmcode");
    click(find("server.ts"));
    expect(open).toHaveBeenCalledOnce();
    click(find("浏览文件"));
    expect(browse).toHaveBeenCalledOnce();
    click(find("刷新"));
    expect(refresh).toHaveBeenCalledOnce();
    click(toggle);
    expect(container.textContent).not.toContain("server.ts");
    expect(container.textContent).not.toContain("/Users/bytedance/vmcode");
    expect(container.textContent).toContain("feature/venv-boe-support");
  });
});

const mobileComposerFrameStyle = {
  height: 224,
  width: 360,
  display: "flex",
  flexDirection: "column" as const,
  overflow: "hidden" as const,
};
const mobileInputReserveStyle = { height: 104, flexShrink: 0 };
it("bounds expanded mobile branch details while preserving the input and send row", async () => {
  const copy = vi.fn(async () => {});
  const container = mount(
    <div style={mobileComposerFrameStyle}>
      <ExecutionContextView
        compact
        cwd="/work/project"
        connected
        loading={false}
        failed={false}
        onCopy={copy}
        repositories={Array.from({ length: 12 }, (_, i) => ({
          root: `/work/repository-${i}`,
          branch: `feature/branch-${i}`,
          dirty: true,
          edited: true,
        }))}
      />
      <div data-testid="input-reserve" style={mobileInputReserveStyle}>
        Message input and send
      </div>
    </div>,
  );
  const toggle = container.querySelector('[data-testid="execution-context-toggle"]')!;
  const input = container.querySelector('[data-testid="input-reserve"]')!;
  const original = input.getBoundingClientRect();
  click(toggle);
  const branch = container.querySelector('[data-testid="composer-execution-context"]')!;
  const details = container.querySelector('[data-testid="execution-context-details"]')!;
  expect(branch.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    input.getBoundingClientRect().top + 1,
  );
  expect(input.getBoundingClientRect().height).toBe(original.height);
  expect(input.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    container.firstElementChild!.getBoundingClientRect().bottom + 1,
  );
  expect(details.scrollHeight).toBeGreaterThan(details.clientHeight);
  await page.viewport(400, 320);
  await page.screenshot({ path: "/private/tmp/paseo-mobile-branch-bounded.png" });
  click(toggle);
  expect(container.querySelector('[data-testid="execution-context-details"]')).toBeNull();
});
