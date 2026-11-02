import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";

test("lifecycle: automatic durable capture, duplicate delivery, startup recall, and fail-open", async () => {
  const state = mkdtempSync(path.join(tmpdir(), "paseo-memory-test-"));
  let submissions = 0,
    outage = false;
  const http = createServer(async (req, res) => {
    const pieces = [];
    for await (const chunk of req) pieces.push(chunk);
    const body = pieces.length ? JSON.parse(Buffer.concat(pieces).toString()) : {};
    res.setHeader("Content-Type", "application/json");
    if (outage) {
      res.statusCode = 503;
      return res.end("{}");
    }
    if (req.url.endsWith("/memories/recall"))
      return res.end(
        JSON.stringify({
          results: [{ id: "synthetic-evidence", text: "Synthetic project color: amber" }],
        }),
      );
    if (req.url.endsWith("/memories")) {
      submissions++;
      assert.equal(body.async, true);
      assert.ok(body.operation_id);
      assert.ok(!body.items[0].content.includes("PRIVATE_REASONING"));
      return res.end(JSON.stringify({ operation_id: body.operation_id }));
    }
    res.end(JSON.stringify({ status: "completed" }));
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  process.env.PASEO_MEMORY_STATE_DIR = state;
  process.env.PASEO_MEMORY_API_URL = "http://127.0.0.1:" + http.address().port;
  writeFileSync(
    path.join(state, "config.json"),
    JSON.stringify({ projects: [{ root: state, bank: "synthetic-only" }] }),
  );
  const { default: contribute } = await import("./index.server.ts");
  let cleanup;
  const install = () => {
    const handlers = {};
    cleanup = contribute({
      on(name, fn) {
        handlers[name] = fn;
        return () => {};
      },
      before(name, fn) {
        handlers[name] = fn;
        return () => {};
      },
    });
    return handlers;
  };
  try {
    let handlers = install();
    const request = {
      config: { cwd: state, provider: "synthetic", systemPrompt: "Original rules" },
    };
    const enriched = await handlers["agent.create"]({ request });
    assert.ok(enriched.config.systemPrompt.startsWith("Original rules"));
    assert.ok(enriched.config.systemPrompt.includes("Synthetic project color: amber"));
    outage = true;
    assert.deepEqual(await handlers["agent.create"]({ request }), request);
    const event = {
      agent: { id: "synthetic-agent", cwd: state },
      turnId: "turn-1",
      outcome: { kind: "completed" },
      timeline: [
        { type: "user_message", text: "Synthetic color is amber", messageId: "message-1" },
        { type: "reasoning", text: "PRIVATE_REASONING" },
        { type: "assistant_message", text: "Acknowledged" },
      ],
    };
    handlers["agent.turn_ended"](event);
    handlers["agent.turn_ended"](event);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await cleanup();
    const pending = JSON.parse(readFileSync(path.join(state, "status.json")));
    assert.equal(
      pending.jobs.reduce((sum, row) => sum + row.count, 0),
      1,
    );
    assert.equal(pending.checkpoints.length, 1);
    outage = false;
    handlers = install();
    let done = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const status = JSON.parse(readFileSync(path.join(state, "status.json")));
      if (status.jobs.some((row) => row.status === "done")) {
        done = true;
        break;
      }
    }
    assert.equal(done, true, "queued operation should recover after plugin restart");
    assert.equal(submissions, 1, "repeated delivery must not enqueue duplicate retains");
    const inspection = new DatabaseSync(path.join(state, "state.sqlite"), { readOnly: true });
    assert.equal(
      inspection.prepare("SELECT body FROM jobs").get().body,
      "{}",
      "successful queue records must not retain raw conversation copies",
    );
    inspection.close();
  } finally {
    if (cleanup) await cleanup();
    await new Promise((resolve) => http.close(resolve));
    rmSync(state, { recursive: true });
  }
});
