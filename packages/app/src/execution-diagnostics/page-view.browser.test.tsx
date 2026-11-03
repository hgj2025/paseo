import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { within } from "@testing-library/dom";
import { page } from "vitest/browser";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { ExecutionDiagnosticPageView, type DiagnosticSessionRow } from "./page-view";
import type { SessionDiagnostic } from "./cache";

beforeEach(async () => {
  vi.stubGlobal("React", React);
  await i18n.changeLanguage("zh-CN");
});
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
});
const loaded = vi.fn();
function Harness() {
  const [host, setHost] = useState("mac");
  const [selected, setSelected] = useState<DiagnosticSessionRow | null>(null);
  const [search, setSearch] = useState("");
  const [record, setRecord] = useState<SessionDiagnostic | undefined>();
  const records = (serverId: string, id: string) =>
    record?.serverId === serverId && record.agentId === id ? record : undefined;
  return (
    <ExecutionDiagnosticPageView
      hosts={[
        { serverId: "mac", label: "Mac" },
        { serverId: "vm", label: "devbox" },
      ]}
      serverId={host}
      selectHost={(id) => {
        setHost(id);
        setSelected(null);
      }}
      search={search}
      setSearch={setSearch}
      sessions={[{ serverId: host, id: "same-id", title: "Captain", provider: "codex" }]}
      selected={selected}
      selectSession={setSelected}
      records={records}
      revision={record ? 1 : 0}
      loading={false}
      listFailed={false}
      hasMore={false}
      loadMore={() => {}}
      refresh={() => {}}
      connected
      loadingHistory={false}
      historyFailed={false}
      hasOlder={false}
      clear={() => setRecord(undefined)}
      loadHistory={() => {
        loaded();
        setRecord({
          serverId: host,
          agentId: "same-id",
          analyzedAt: Date.now(),
          source: "history",
          rows: [
            {
              id: "call-1",
              command: "go test ./repo",
              evidence: "--- FAIL: TestExternal",
              status: "failed",
              category: "test",
              timing: "unknown",
              slow: false,
            },
          ],
        });
      }}
    />
  );
}
it("keeps diagnosis in settings, distinguishes unread sessions and isolates hosts", async () => {
  container = document.createElement("div");
  container.style.width = "min(760px, calc(100vw - 40px))";
  container.style.padding = "20px";
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<Harness />));
  const ui = within(container);
  expect(ui.queryByTestId("execution-diagnostics-toggle")).toBeNull();
  expect(ui.getByText("未分析，选中会话后可读取历史。")).toBeTruthy();
  expect(loaded).not.toHaveBeenCalled();
  act(() => ui.getByRole("button", { name: /Captain.*未分析/ }).click());
  act(() => ui.getByRole("button", { name: "读取／刷新历史" }).click());
  expect(loaded).toHaveBeenCalledOnce();
  expect(ui.getAllByText(/待处理 1/).length).toBeGreaterThan(0);
  act(() => ui.getByRole("button", { name: /待确认.*go test/ }).click());
  expect(ui.getByText("--- FAIL: TestExternal")).toBeTruthy();
  await page.screenshot({ path: "/private/tmp/paseo-diagnostic-settings.png" });
  act(() => ui.getByRole("button", { name: "devbox" }).click());
  expect(ui.queryByText("--- FAIL: TestExternal")).toBeNull();
  expect(ui.getByText("未分析，选中会话后可读取历史。")).toBeTruthy();
  expect(loaded).toHaveBeenCalledOnce();
  act(() => ui.getByRole("button", { name: "清空本机诊断缓存" }).click());
  act(() => ui.getByRole("button", { name: /^Mac$/ }).click());
  expect(ui.getByText("未分析，选中会话后可读取历史。")).toBeTruthy();
});
