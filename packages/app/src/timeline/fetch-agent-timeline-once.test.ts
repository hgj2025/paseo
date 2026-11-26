import { expect, test } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { fetchAgentTimelineOnce } from "./fetch-agent-timeline-once";

type TimelinePage = Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>>;

test("concurrent identical timeline reads share one request", async () => {
  let resolvePage: (page: TimelinePage) => void = () => {};
  const page = new Promise<TimelinePage>((resolve) => {
    resolvePage = resolve;
  });
  const requests: Array<{ agentId: string; direction: string }> = [];
  const client = {
    fetchAgentTimeline: async (
      agentId: string,
      request: Parameters<DaemonClient["fetchAgentTimeline"]>[1],
    ) => {
      requests.push({ agentId, direction: request?.direction ?? "tail" });
      return page;
    },
  };
  const request = { direction: "tail" as const, limit: 100, projection: "projected" as const };

  const first = fetchAgentTimelineOnce(client, "agent", request);
  const second = fetchAgentTimelineOnce(client, "agent", request);
  resolvePage({ hasNewer: false } as TimelinePage);

  await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  expect(requests).toEqual([{ agentId: "agent", direction: "tail" }]);
});

test("session repository history includes older pages, keeps final tool state and incrementally refreshes", async () => {
  const { createSessionHistoryReader, sessionPaths } =
    await import("../panels/session-files-model");
  const tool = (id: string, path: string, status = "completed") => ({
    type: "tool_call",
    callId: id,
    name: "edit",
    detail: { type: "edit", filePath: path },
    status,
    error: null,
  });
  const entry = (seq: number, item: unknown) => ({ seqStart: seq, seqEnd: seq, item });
  const cursor = (seq: number, epoch = "one") => ({ seq, epoch });
  const page = (entries: unknown[], older = false, epoch = "one") =>
    ({
      entries,
      epoch,
      reset: false,
      staleCursor: false,
      hasOlder: older,
      hasNewer: false,
      startCursor: cursor((entries[0] as { seqStart: number })?.seqStart ?? 0, epoch),
      endCursor: cursor((entries.at(-1) as { seqEnd: number })?.seqEnd ?? 0, epoch),
    }) as TimelinePage;
  const pages = [
    page([entry(6, tool("new", "/work/new.ts"))], true),
    page([
      entry(1, tool("old", "/work/old.ts", "running")),
      entry(2, tool("old", "/work/old.ts")),
      entry(3, tool("new", "/work/new.ts", "running")),
    ]),
    page([entry(7, tool("extra", "/other/new.ts"))]),
    { ...page([], false, "two"), reset: true },
    page([entry(1, tool("replacement", "/new-history/only.ts"))], false, "two"),
  ];
  const requests: Parameters<DaemonClient["fetchAgentTimeline"]>[1][] = [];
  const client = {
    fetchAgentTimeline: async (
      _id: string,
      request: Parameters<DaemonClient["fetchAgentTimeline"]>[1],
    ) => {
      requests.push(request);
      return pages.shift()!;
    },
  };
  const read = createSessionHistoryReader();
  expect(
    sessionPaths(await read(client, "agent"), "/work")
      .filter((p) => p.edited)
      .map((p) => p.path)
      .sort(),
  ).toEqual(["/work/new.ts", "/work/old.ts"]);
  expect((await read(client, "agent")).length).toBe(3);
  expect(requests[1]?.direction).toBe("before");
  expect(requests[2]).toMatchObject({ direction: "after", cursor: cursor(6) });
  expect(
    sessionPaths(await read(client, "agent"), "/work")
      .filter((p) => p.edited)
      .map((p) => p.path),
  ).toEqual(["/new-history/only.ts"]);
});

test("session history rejects a stuck cursor without caching partial results", async () => {
  const { createSessionHistoryReader } = await import("../panels/session-files-model");
  const page = {
    projection: "canonical",
    requestId: "request",
    agentId: "agent",
    agent: null,
    direction: "tail",
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 3, maxSeq: 3, nextSeq: 4 },
    error: null,
    entries: [],
    epoch: "one",
    hasOlder: true,
    hasNewer: false,
    startCursor: { epoch: "one", seq: 3 },
    endCursor: { epoch: "one", seq: 3 },
  } as TimelinePage;
  const read = createSessionHistoryReader();
  await expect(read({ fetchAgentTimeline: async () => page }, "agent")).rejects.toThrow(
    "did not advance",
  );
});

test("long session indexing publishes recent edits before the oldest page finishes", async () => {
  const { createSessionHistoryReader } = await import("../panels/session-files-model");
  let finish: (page: TimelinePage) => void = () => {};
  const older = new Promise<TimelinePage>((resolve) => {
    finish = resolve;
  });
  const recent = {
    entries: [
      {
        seqStart: 9,
        seqEnd: 9,
        item: {
          type: "tool_call",
          callId: "edit",
          name: "edit",
          status: "completed",
          error: null,
          detail: { type: "edit", filePath: "/repo/recent.ts" },
        },
      },
    ],
    epoch: "one",
    hasOlder: true,
    hasNewer: false,
    startCursor: { epoch: "one", seq: 9 },
    endCursor: { epoch: "one", seq: 9 },
  } as unknown as TimelinePage;
  let calls = 0;
  const progress: string[][] = [];
  const pending = createSessionHistoryReader()(
    { fetchAgentTimeline: async () => (++calls === 1 ? recent : older) },
    "agent",
    (items) =>
      progress.push(
        items.map((item) =>
          item.type === "tool_call" && item.detail.type === "edit" ? item.detail.filePath : "",
        ),
      ),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(progress).toEqual([["/repo/recent.ts"]]);
  finish({
    ...recent,
    entries: [],
    hasOlder: false,
    startCursor: { epoch: "one", seq: 1 },
    endCursor: { epoch: "one", seq: 1 },
  });
  await expect(pending).resolves.toHaveLength(1);
});
