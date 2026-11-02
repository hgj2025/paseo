import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  projectFor,
  lastTurn,
  memoryBlock,
  checkpoint,
  operationId,
  redact,
} from "./server/core.mjs";

test("project isolation respects real paths, nested scope, and prefix boundaries", () => {
  const root = mkdtempSync(path.join(tmpdir(), "memory-scope-"));
  try {
    mkdirSync(root + "/project");
    mkdirSync(root + "/project/sub");
    mkdirSync(root + "/project-other");
    symlinkSync(root + "/project", root + "/alias");
    const projects = [{ root: root + "/project", bank: "one" }];
    assert.equal(projectFor(root + "/alias/sub", projects).bank, "one");
    assert.equal(projectFor(root + "/project-other", projects), null);
  } finally {
    rmSync(root, { recursive: true });
  }
});
test("only the latest public conversation turn is retained, without tools or reasoning", () => {
  const turn = lastTurn([
    { type: "user_message", text: "old" },
    { type: "assistant_message", text: "old answer" },
    { type: "user_message", text: "new", messageId: "m1" },
    { type: "reasoning", text: "private thoughts" },
    { type: "tool_call", text: "raw log" },
    { type: "assistant_message", text: "new answer" },
  ]);
  assert.deepEqual(JSON.parse(turn.material), { user: "new", assistantReport: "new answer" });
  assert.equal(
    lastTurn([
      { type: "user_message", text: "/compact" },
      { type: "assistant_message", text: "done" },
    ]),
    null,
  );
});
test("dedup identity survives redelivery but distinguishes repeated text with different message IDs", () => {
  const timeline = (id) => [
    { type: "user_message", text: "same", messageId: id },
    { type: "assistant_message", text: "same" },
  ];
  assert.equal(lastTurn(timeline("one")).digest, lastTurn(timeline("one")).digest);
  assert.notEqual(lastTurn(timeline("one")).digest, lastTurn(timeline("two")).digest);
  assert.match(operationId("one"), /^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-a[\da-f]{3}-[\da-f]{12}$/);
});
test("memory and checkpoint growth are bounded; basic secrets are redacted", () => {
  assert.ok(memoryBlock([{ text: "x".repeat(10000), id: "evidence" }]).length < 4000);
  assert.ok(!redact("api_key=private-value sk-abcdefghijklmnop").includes("private-value"));
  let saved;
  for (let i = 0; i < 20; i++)
    saved = checkpoint({ prompt: "goal", output: "x".repeat(4000) }, saved, {
      turnId: i,
      outcome: { kind: "completed" },
    });
  assert.ok(saved.length <= 16000);
  assert.ok(JSON.parse(saved).length <= 8);
});
