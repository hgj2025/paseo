import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GrokBotAdapter, GrokBotApi, acquireLock } from "./grokbot-acp.mjs";

const idle = (seq = "0", entries = []) => ({
  entries,
  latestUpdatedSeq: seq,
  turn: { idle: true, inFlight: false, queued: 0 },
});
const busy = (seq) => ({
  entries: [],
  latestUpdatedSeq: seq,
  turn: { idle: false, inFlight: true, queued: 0 },
});
const delivery = (text) =>
  idle("2", [
    { kind: "send-message", text },
    { kind: "tool-call", text: "private tool output" },
  ]);
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "grokbot-acp-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [],
    events = [];
  let pages = [idle(), busy("1"), delivery("delivered reply"), idle("2")];
  const api = {
    async session(name) {
      calls.push(["session", name]);
      return { id: "remote-1", name, createdAtMs: 0, latestUpdatedSeq: "0" };
    },
    async entries(id, cursor) {
      calls.push(["entries", id, cursor]);
      return pages.shift() || idle("2");
    },
    async send(id, text, messageId) {
      calls.push(["send", id, text, messageId]);
      return { delivery: "accepted_temporal" };
    },
    async interrupt(id) {
      calls.push(["interrupt", id]);
    },
  };
  const make = (extra) =>
    new GrokBotAdapter({
      bot: "Existing Bot",
      root,
      getKey: async () => "test-key",
      makeApi: () => api,
      emit: (x) => events.push(x),
      delay: async () => {},
      ...options,
      ...extra,
    });
  const adapter = make();
  const { sessionId } = await adapter.handle("session/new");
  return {
    adapter,
    sessionId,
    api,
    calls,
    events,
    make,
    root,
    pages: (next) => {
      pages = next;
    },
  };
}
const prompt = (text) => [{ type: "text", text }];
test("catalog and new sessions do not contact or create a cloud Bot", async (t) => {
  const f = await fixture(t);
  await f.adapter.handle("initialize");
  assert.equal(f.calls.length, 0);
  assert.equal((await stat(f.adapter.path(f.sessionId))).mode & 0o777, 0o600);
});
test("sends once, waits through busy, exposes only delivered replies, and completes", async (t) => {
  const f = await fixture(t);
  const result = await f.adapter.handle("session/prompt", {
    sessionId: f.sessionId,
    prompt: prompt("hello"),
  });
  assert.equal(result.stopReason, "end_turn");
  assert.equal(f.calls.filter((c) => c[0] === "send").length, 1);
  assert.equal(
    f.events
      .filter((e) => e.params.update.sessionUpdate === "agent_message_chunk")
      .map((e) => e.params.update.content.text)
      .join(""),
    "delivered reply\n",
  );
  assert.equal((await f.adapter.state(f.sessionId)).pending, null);
});
test("refuses to send when the existing App Bot is busy", async (t) => {
  const f = await fixture(t);
  f.pages([busy("0")]);
  await assert.rejects(
    f.adapter.prompt({ sessionId: f.sessionId, prompt: prompt("hello") }),
    /busy/,
  );
  assert.equal(f.calls.filter((c) => c[0] === "send").length, 0);
});
test("detects an unexpectedly created empty Bot before sending", async (t) => {
  const f = await fixture(t);
  f.api.session = async (name) => ({
    id: "unexpected",
    name,
    createdAtMs: Date.now(),
    latestUpdatedSeq: "-1",
  });
  await assert.rejects(
    f.adapter.prompt({ sessionId: f.sessionId, prompt: prompt("hello") }),
    /created an empty Bot/,
  );
  assert.equal(f.calls.filter((c) => c[0] === "send").length, 0);
});
test("a lost send acknowledgement is never blindly retried", async (t) => {
  const f = await fixture(t);
  f.api.send = async () => {
    f.calls.push(["send"]);
    throw new Error("connection lost");
  };
  await assert.rejects(
    f.adapter.prompt({ sessionId: f.sessionId, prompt: prompt("hello") }),
    /connection lost/,
  );
  await assert.rejects(
    f.adapter.prompt({ sessionId: f.sessionId, prompt: prompt("继续") }),
    /outcome is uncertain/,
  );
  assert.equal(f.calls.filter((c) => c[0] === "send").length, 1);
});
test("long tasks resume from the persisted cursor without resending", async (t) => {
  const f = await fixture(t, { waitMs: 0 });
  f.pages([idle(), busy("1")]);
  await assert.rejects(
    f.adapter.prompt({ sessionId: f.sessionId, prompt: prompt("hello") }),
    /still running/,
  );
  const restored = f.make({ waitMs: 10000 });
  f.pages([delivery("late reply"), idle("2"), idle("2"), idle("2"), idle("2")]);
  assert.equal(
    (await restored.prompt({ sessionId: f.sessionId, prompt: prompt("继续") })).stopReason,
    "end_turn",
  );
  assert.equal(f.calls.filter((c) => c[0] === "send").length, 1);
  assert.ok(f.calls.some((c) => c[0] === "entries" && c[2] === "1"));
});
test("an idle turn with no delivered reply is not reported successful", async (t) => {
  const f = await fixture(t);
  f.pages([idle(), idle(), idle(), idle(), idle()]);
  await assert.rejects(
    f.adapter.prompt({ sessionId: f.sessionId, prompt: prompt("hello") }),
    /without delivering/,
  );
});
test("history is replayed locally without sending prior messages to the Bot", async (t) => {
  const f = await fixture(t);
  await f.adapter.prompt({ sessionId: f.sessionId, prompt: prompt("hello") });
  const before = f.calls.length;
  await f.make().handle("session/load", { sessionId: f.sessionId });
  assert.equal(f.calls.length, before);
  assert.ok(f.events.some((x) => x.params.update.sessionUpdate === "user_message_chunk"));
});
test("rejects a different Bot or changed API credential on resume", async (t) => {
  const f = await fixture(t);
  await f.adapter.prompt({ sessionId: f.sessionId, prompt: prompt("hello") });
  await assert.rejects(
    f.make({ bot: "Other Bot" }).handle("session/load", { sessionId: f.sessionId }),
    /another Bot/,
  );
  await assert.rejects(
    f
      .make({ getKey: async () => "other-key" })
      .prompt({ sessionId: f.sessionId, prompt: prompt("again") }),
    /credential changed/,
  );
});
test("text-only boundary rejects unsupported attachments without dropping them", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.adapter.prompt({ sessionId: f.sessionId, prompt: [{ type: "image", data: "example" }] }),
    /text only/,
  );
  assert.equal(f.calls.length, 0);
});
test("a process lock prevents another Paseo session using the same Bot concurrently", async (t) => {
  const f = await fixture(t);
  const release = await acquireLock(join(f.root, "test-lock"), "same-bot");
  await assert.rejects(acquireLock(join(f.root, "test-lock"), "same-bot"), /already has/);
  await release();
  const again = await acquireLock(join(f.root, "test-lock"), "same-bot");
  await again();
});
test("API authentication stays on the official endpoint and errors do not echo credentials", async () => {
  const seen = [];
  const api = new GrokBotApi("secret-key", async (url, init) => {
    seen.push([url, init]);
    return { ok: false, status: 401 };
  });
  await assert.rejects(
    api.entries("id", "0"),
    (error) => /401/.test(error.message) && !error.message.includes("secret-key"),
  );
  assert.equal(new URL(seen[0][0]).origin, "https://api.cursor.com");
  assert.equal(seen[0][1].headers.authorization, "Bearer secret-key");
});

test("cancel interrupts only the accepted task owned by this adapter", async (t) => {
  let entered;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const f = await fixture(t, {
    delay: async (_, __, { signal }) => {
      entered();
      await new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      );
    },
  });
  f.pages([idle(), busy("1")]);
  const turn = f.adapter.prompt({ sessionId: f.sessionId, prompt: prompt("hello") });
  await waiting;
  await f.adapter.handle("session/cancel", { sessionId: f.sessionId });
  assert.equal((await turn).stopReason, "cancelled");
  assert.equal(f.calls.filter((x) => x[0] === "interrupt").length, 1);
  assert.equal((await f.adapter.state(f.sessionId)).pending, null);
});

test("cancel before acceptance does not stop an unrelated App turn", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  f.adapter.active.set(f.sessionId, { controller, api: f.api, accepted: false });
  await f.adapter.handle("session/cancel", { sessionId: f.sessionId });
  assert.equal(controller.signal.aborted, true);
  assert.equal(f.calls.filter((x) => x[0] === "interrupt").length, 0);
});
