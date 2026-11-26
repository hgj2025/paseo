import { afterEach, expect, it, vi } from "vitest";
import { createNavigationRecorder } from "./recorder";

afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers();
  let now = 0;
  let frameId = 0;
  const frames = new Map<number, () => void>();
  const logs: Record<string, unknown>[] = [];
  const recorder = createNavigationRecorder({
    now: () => now,
    write: (record) => logs.push(JSON.parse(JSON.stringify(record))),
    frame: (callback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelFrame: (id) => {
      frames.delete(id);
    },
    timer: setTimeout,
    cancelTimer: clearTimeout,
  });
  return {
    recorder,
    logs,
    advance: (ms: number) => {
      now += ms;
      vi.advanceTimersByTime(ms);
    },
    frame: () => {
      const next = frames.entries().next().value;
      if (next) {
        frames.delete(next[0]);
        next[1]();
      }
    },
  };
}
const target = { serverId: "host", agentId: "agent", workspaceId: "workspace" };
it("correlates commit, readiness and two frame opportunities, ignoring unrelated panels", () => {
  const f = fixture();
  const id = f.recorder.begin(target, 80);
  f.advance(20);
  f.recorder.dispatched(id);
  f.recorder.mark("workspace-commit", { serverId: "other", workspaceId: "workspace" });
  f.recorder.mark("workspace-commit", target);
  f.advance(50);
  f.recorder.longTask(10, 60);
  f.recorder.mark("content-ready", { ...target, agentId: "other" });
  f.recorder.mark("content-ready", target, { rows: 40 });
  f.recorder.mark("content-ready", target, { rows: 50 });
  f.frame();
  expect(f.logs.at(-1)?.stage).toBe("content-ready");
  f.frame();
  expect(f.logs.at(-1)).toMatchObject({
    id,
    stage: "finish",
    outcome: "frame-opportunity",
    elapsedMs: 70,
    stages: { "workspace-commit": 20, "content-ready": 70 },
    longTasks: [{ startMs: 10, durationMs: 60 }],
  });
  f.advance(5000);
  expect(f.logs.filter((x) => x.stage === "finish")).toHaveLength(1);
});
it("times out stalled navigation and bounds collected long tasks", () => {
  const f = fixture();
  f.recorder.begin(target);
  for (let i = 0; i < 100; i++) f.recorder.longTask(i, 60);
  f.advance(5000);
  expect(f.logs.at(-1)).toMatchObject({ outcome: "timeout", elapsedMs: 5000 });
  expect(f.logs.at(-1)?.longTasks).toHaveLength(12);
});
it("marks superseded clicks and cancels old completion callbacks", () => {
  const f = fixture();
  const first = f.recorder.begin(target);
  f.recorder.mark("content-ready", target);
  f.frame();
  const second = f.recorder.begin({ ...target, agentId: "next" });
  f.recorder.dispatched(first);
  f.frame();
  expect(f.logs.filter((x) => x.stage === "finish")).toEqual([
    expect.objectContaining({ id: first, outcome: "superseded" }),
  ]);
  f.recorder.failed(second);
  expect(f.logs.at(-1)).toMatchObject({ id: second, outcome: "failed" });
  f.advance(5000);
  expect(f.logs.filter((x) => x.stage === "finish")).toHaveLength(2);
});
it("logging failures never prevent navigation or cleanup", () => {
  vi.useFakeTimers();
  const recorder = createNavigationRecorder({
    now: () => 0,
    write: () => {
      throw new Error("disk");
    },
    frame: () => 1,
    cancelFrame: vi.fn(),
    timer: setTimeout,
    cancelTimer: clearTimeout,
  });
  expect(() => {
    recorder.begin(target);
    recorder.stop();
  }).not.toThrow();
  expect(vi.getTimerCount()).toBe(0);
});

it("captures delayed history work after the first frame, bounded to five seconds", () => {
  const f = fixture();
  f.recorder.begin(target);
  f.recorder.mark("content-ready", target);
  f.frame();
  f.frame();
  f.advance(500);
  f.recorder.longTask(450, 2200);
  f.recorder.work(target, "presentation", 2100, 15772);
  expect(f.logs.at(-1)).toMatchObject({
    stage: "stream-work",
    phase: "presentation",
    durationMs: 2100,
    rows: 15772,
  });
  expect(f.logs.filter((x) => x.stage === "post-frame-long-task")).toHaveLength(1);
  f.advance(5001);
  const count = f.logs.length;
  f.recorder.longTask(5501, 100);
  f.recorder.work(target, "presentation", 100, 16000);
  expect(f.logs).toHaveLength(count);
});
it("does not attribute delayed work to a different host or agent", () => {
  const f = fixture();
  f.recorder.begin(target);
  f.recorder.work({ ...target, serverId: "other" }, "presentation", 100, 1);
  f.recorder.work({ ...target, agentId: "other" }, "presentation", 100, 1);
  expect(f.logs).toHaveLength(1);
});
