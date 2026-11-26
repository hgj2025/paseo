import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { FileObserverCallback, FileObserver } from "../file-observer/index.js";
import { PersistedHistoryObserver } from "./persisted-history-observer.js";

let root: string;
let path: string;
let callback: FileObserverCallback;
let busy: boolean;
let synchronize: ReturnType<typeof vi.fn>;
let unsubscribe: ReturnType<typeof vi.fn>;
let subject: PersistedHistoryObserver;
let releases: (() => Promise<void>)[];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "paseo-history-observer-"));
  path = join(root, "session.jsonl");
  await writeFile(path, "original");
  busy = false;
  synchronize = vi.fn(async () => undefined);
  unsubscribe = vi.fn(async () => undefined);
  const observer: FileObserver = {
    subscribe: vi.fn(async (_root, cb) => {
      callback = cb;
      return { unsubscribe, updateIgnore: async () => undefined };
    }),
    getDiagnostics: vi.fn(),
    close: vi.fn(),
  };
  subject = new PersistedHistoryObserver({
    observer,
    synchronize,
    isBusy: () => busy,
    onError: vi.fn(),
  });
  releases = [];
});
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(releases.map((release) => release()));
  await rm(root, { recursive: true, force: true });
});
async function view() {
  const handle = subject.observe("agent", path);
  releases.push(handle.release);
  await handle.ready;
  return handle;
}

test("opening and reconnecting checks for changes without replaying unchanged history", async () => {
  const first = await view();
  expect(synchronize).toHaveBeenCalledTimes(1);
  await subject.check("agent");
  await first.release();
  const second = await view();
  expect(synchronize).toHaveBeenCalledTimes(1);
  await second.release();
  await writeFile(path, "finished while disconnected");
  await view();
  expect(synchronize).toHaveBeenCalledTimes(2);
});

test("a burst of transcript changes aligns once after it settles", async () => {
  vi.useFakeTimers();
  await view();
  await writeFile(path, "external tool completed");
  callback(null, [{ path, type: "update" }]);
  callback(null, [{ path, type: "update" }]);
  await vi.advanceTimersByTimeAsync(999);
  expect(synchronize).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await subject.check("agent");
  expect(synchronize).toHaveBeenCalledTimes(2);
});

test("defers replay during an owned turn and checks again after settlement", async () => {
  busy = true;
  await view();
  expect(synchronize).not.toHaveBeenCalled();
  await writeFile(path, "completed turn");
  await subject.check("agent");
  expect(synchronize).not.toHaveBeenCalled();
  busy = false;
  await subject.check("agent");
  expect(synchronize).toHaveBeenCalledTimes(1);
});

test("all clients share one alignment and the last viewer releases the watcher", async () => {
  const first = await view();
  const second = await view();
  expect(synchronize).toHaveBeenCalledTimes(1);
  await first.release();
  expect(unsubscribe).not.toHaveBeenCalled();
  await second.release();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test("closing a view cancels its pending alignment", async () => {
  vi.useFakeTimers();
  const handle = await view();
  await writeFile(path, "external update");
  callback(null, [{ path, type: "update" }]);
  await handle.release();
  await vi.advanceTimersByTimeAsync(2000);
  await subject.check("agent");
  expect(synchronize).toHaveBeenCalledTimes(1);
});

test("failed replay is retried instead of marking the transcript as aligned", async () => {
  await view();
  await writeFile(path, "new final reply");
  synchronize.mockRejectedValueOnce(new Error("read failed"));
  await expect(subject.check("agent")).rejects.toThrow("read failed");
  await subject.check("agent");
  expect(synchronize).toHaveBeenCalledTimes(3);
});

test("unrelated transcript edits do not trigger a replay", async () => {
  vi.useFakeTimers();
  await view();
  await writeFile(path, "changed but no matching notification");
  callback(null, [{ path: join(root, "another.jsonl"), type: "update" }]);
  await vi.advanceTimersByTimeAsync(2000);
  expect(synchronize).toHaveBeenCalledTimes(1);
});

test("native filesystem changes reach a viewed transcript without a manual request", async () => {
  subject = new PersistedHistoryObserver({
    synchronize,
    isBusy: () => false,
    onError: (error) => {
      throw error;
    },
  });
  await view();
  await writeFile(path, "external final result on disk");
  await vi.waitFor(() => expect(synchronize).toHaveBeenCalledTimes(2), { timeout: 5000 });
});
