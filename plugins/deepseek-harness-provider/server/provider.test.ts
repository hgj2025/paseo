import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import type { AcpStreamMessage } from "@getpaseo/plugin/server/acp";
import { decodeArchive, readArchive } from "./history.js";
import { HarnessBridge } from "./bridge.js";
import { parseHarnessMessage } from "./connection.js";

const nativeId = "session-fixture";
function fixture() {
  return (
    [
      { type: "session", version: 4, id: nativeId, cwd: "/project", createdAt: 1000 },
      {
        type: "system/message",
        seq: 0,
        time: 1001,
        data: { message: { content: [{ type: "text", text: "private system" }] } },
      },
      {
        type: "user/message",
        seq: 1,
        time: 1002,
        data: { content: [{ type: "text", text: "fix issue" }] },
      },
      {
        type: "assistant/message",
        seq: 2,
        time: 1003,
        data: {
          message: {
            content: [
              { type: "reasoning", text: "think" },
              { type: "text", text: "checking" },
            ],
          },
        },
      },
      {
        type: "tool/call",
        seq: 3,
        time: 1004,
        data: { callId: "tool1", name: "bash", arguments: "{}" },
      },
      {
        type: "tool/result",
        seq: 4,
        time: 1005,
        data: { message: { toolCallId: "tool1", content: [{ type: "text", text: "passed" }] } },
      },
      { type: "session/title", seq: 5, time: 1006, data: { title: "Fix issue" } },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n") + "\n"
  );
}
function harness() {
  const emitted: AcpStreamMessage[] = [];
  const sent: AcpStreamMessage[] = [];
  const bridge = new HarnessBridge({
    emit: (m) => emitted.push(m),
    send: async (m) => {
      sent.push(m);
    },
    readArchive: async (id) => decodeArchive(fixture(), id),
  });
  return { bridge, emitted, sent };
}
async function initialize(h: ReturnType<typeof harness>, resume = true) {
  await h.bridge.receiveClient({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await h.bridge.receiveHarness({
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: 1,
      agentCapabilities: { sessionCapabilities: resume ? { resume: {}, list: {} } : {} },
    },
  });
}
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { force: true, recursive: true })));
});

describe("Harness v4 archives", () => {
  it("replays messages, thoughts and tools without leaking system records", () => {
    const archive = decodeArchive(fixture(), nativeId);
    expect(archive.title).toBe("Fix issue");
    expect(archive.updates).toHaveLength(5);
    const raw = JSON.stringify(archive.updates);
    expect(raw).not.toContain("private system");
    expect(raw).toContain("reasoning");
    expect(raw).toContain("tool_call");
    expect(raw).toContain("passed");
  });
  it("rejects unsupported, corrupt and wrong-identity logs", () => {
    expect(() =>
      decodeArchive(fixture().replace('"version":4', '"version":5'), nativeId),
    ).toThrow();
    expect(() => decodeArchive(fixture() + "{broken", nativeId)).toThrow();
    expect(() => decodeArchive(fixture(), "session-other")).toThrow(/identity/);
  });
  it("reads zstd archives and prevents traversal and symlink escapes", async () => {
    const home = await mkdtemp(join(tmpdir(), "paseo-dsh-"));
    roots.push(home);
    const dir = join(home, "sessions", "project", nativeId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "session.v4.jsonl.zstd"), zstdCompressSync(Buffer.from(fixture())));
    const lines = fixture().split("\n");
    const multiFrame = Buffer.concat([
      zstdCompressSync(Buffer.from(lines[0] + "\n")),
      zstdCompressSync(Buffer.from(lines.slice(1).join("\n"))),
    ]);
    await writeFile(join(dir, "session.v4.jsonl.zstd"), multiFrame);
    expect((await readArchive(home, nativeId)).updates).toHaveLength(5);
    expect((await readArchive(home, nativeId)).title).toBe("Fix issue");
    await expect(readArchive(home, "../../credentials")).rejects.toThrow(/Invalid/);
    const outside = join(home, "outside");
    await mkdir(outside);
    await writeFile(
      join(outside, "session.v4.jsonl.zstd"),
      zstdCompressSync(Buffer.from(fixture())),
    );
    await symlink(outside, join(home, "sessions", "project", "session-escape"));
    await expect(readArchive(home, "session-escape")).rejects.toThrow(/escapes/);
  });
});

describe("Harness ACP bridge", () => {
  it("retains native error responses at the JSON-RPC boundary", () => {
    const error = { jsonrpc: "2.0", id: 2, error: { code: -32000, message: "session occupied" } };
    expect(parseHarnessMessage(error)).toEqual(error);
    expect(() => parseHarnessMessage({ jsonrpc: "2.0", id: 2 })).toThrow();
  });
  it("advertises load only when native resume exists", async () => {
    const h = harness();
    await initialize(h);
    expect(h.emitted[0]).toMatchObject({ result: { agentCapabilities: { loadSession: true } } });
    const unsupported = harness();
    await initialize(unsupported, false);
    expect(JSON.stringify(unsupported.emitted)).not.toContain("loadSession");
  });
  it("restores the original ID before replaying and never sends a prompt", async () => {
    const h = harness();
    await initialize(h);
    await h.bridge.receiveClient({
      jsonrpc: "2.0",
      id: 2,
      method: "session/load",
      params: { sessionId: nativeId, cwd: "/project", mcpServers: [] },
    });
    expect(h.sent.at(-1)).toMatchObject({
      id: 2,
      method: "session/resume",
      params: { sessionId: nativeId },
    });
    expect(h.emitted).toHaveLength(1);
    await h.bridge.receiveHarness({ jsonrpc: "2.0", id: 2, result: {} });
    expect(h.emitted).toHaveLength(7);
    expect(h.emitted[1]).toMatchObject({ id: 2, result: {} });
    expect(h.sent.some((m) => "method" in m && m.method === "session/prompt")).toBe(false);
  });
  it("preserves busy-session refusal without replaying or creating a replacement", async () => {
    const h = harness();
    await initialize(h);
    await h.bridge.receiveClient({
      jsonrpc: "2.0",
      id: 2,
      method: "session/load",
      params: { sessionId: nativeId, cwd: "/project" },
    });
    const error: AcpStreamMessage = {
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32000, message: "session occupied" },
    };
    await h.bridge.receiveHarness(error);
    expect(h.emitted).toHaveLength(2);
    expect(h.emitted[1]).toEqual(error);
    expect(h.sent).toHaveLength(2);
  });
  it("surfaces native write-lock details hidden behind Internal error", async () => {
    const h = harness();
    await initialize(h);
    await h.bridge.receiveClient({
      jsonrpc: "2.0",
      id: 2,
      method: "session/load",
      params: { sessionId: nativeId, cwd: "/project" },
    });
    await h.bridge.receiveHarness({
      jsonrpc: "2.0",
      id: 2,
      error: {
        code: -32603,
        message: "Internal error",
        data: { details: 'session "session-fixture" is already owned by an active write handle' },
      },
    });
    expect(h.emitted.at(-1)).toMatchObject({
      error: { message: expect.stringContaining("其他进程占用") },
    });
    expect(h.emitted).toHaveLength(2);
    expect(h.sent).toHaveLength(2);
  });
  it("rejects cwd mismatch before attempting restoration", async () => {
    const h = harness();
    await initialize(h);
    await h.bridge.receiveClient({
      jsonrpc: "2.0",
      id: 2,
      method: "session/load",
      params: { sessionId: nativeId, cwd: "/wrong" },
    });
    expect(h.sent).toHaveLength(1);
    expect(h.emitted.at(-1)).toMatchObject({
      error: { message: "Harness session working directory mismatch" },
    });
  });
  it("enriches listing and transparently forwards native permission requests", async () => {
    const h = harness();
    await initialize(h);
    await h.bridge.receiveClient({ jsonrpc: "2.0", id: 3, method: "session/list", params: {} });
    await h.bridge.receiveHarness({
      jsonrpc: "2.0",
      id: 3,
      result: { sessions: [{ sessionId: nativeId, cwd: "/project" }], nextCursor: "next" },
    });
    expect(h.emitted.at(-1)).toMatchObject({
      result: { sessions: [{ title: "Fix issue" }], nextCursor: "next" },
    });
    const permission: AcpStreamMessage = {
      jsonrpc: "2.0",
      id: "p1",
      method: "session/request_permission",
      params: { sessionId: nativeId },
    };
    await h.bridge.receiveHarness(permission);
    expect(h.emitted.at(-1)).toEqual(permission);
    const answer: AcpStreamMessage = { jsonrpc: "2.0", id: "p1", result: { outcome: "cancelled" } };
    await h.bridge.receiveClient(answer);
    expect(h.sent.at(-1)).toEqual(answer);
  });
});

describe("Paseo provider integration", () => {
  it("uses the launch environment and restores history through the real ACP adapter", async () => {
    const { createHarnessProvider } = await import("../index.server.js");
    const home = await mkdtemp(join(tmpdir(), "paseo-dsh-runtime-"));
    roots.push(home);
    const dir = join(home, "sessions", "project", nativeId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "session.v4.jsonl.zstd"), zstdCompressSync(Buffer.from(fixture())));
    const cli = join(home, "fake.cjs");
    await writeFile(
      cli,
      `
const readline=require('node:readline');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line); if(r.id===undefined)return;
 let result={};
 if(r.method==='initialize') result={protocolVersion:1,agentCapabilities:{sessionCapabilities:{list:{},resume:{},close:{}}},authMethods:[]};
 if(r.method==='session/list') result={sessions:[{sessionId:'session-fixture',cwd:'/project'}]};
 if(r.method==='session/new') {console.error('Catalog must not create sessions');process.exit(9);}
 if(r.method==='session/prompt') {console.error('Unexpected prompt');process.exit(8);}
 console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,result}));
});
`,
    );
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env))
      if (typeof value === "string") env[key] = value;
    env.DSH_HOME = home;
    const connection = await createHarnessProvider().connect({
      versions: [1],
      capabilities: ["session.list", "session.persistence", "prompt.message", "permission"],
      launch: { command: process.execPath, args: [cli], env },
    });
    const events: unknown[] = [];
    connection.onEvent((event) => events.push(event));
    try {
      expect(connection.capabilities).toContain("session.persistence");
      await connection.send({ type: "catalog", requestId: "catalog" });
      expect(findEvent(events, "catalog")).toMatchObject({ catalog: { models: [] } });
      await connection.send({ type: "sessions", requestId: "list" });
      await expect
        .poll(() => findEvent(events, "sessions"))
        .toMatchObject({ sessions: [{ title: "Fix issue" }] });
      await connection.send({
        type: "session.open",
        requestId: "open",
        sessionId: "paseo-id",
        config: { cwd: "/project", env: {}, mcpServers: {}, settings: {}, persist: true },
        persistence: { version: 1, data: { sessionId: nativeId } },
        history: "replay",
      });
      await expect.poll(() => Boolean(findEvent(events, "session.ready"))).toBe(true);
      await expect.poll(() => JSON.stringify(events)).toContain("fix issue");
      expect(JSON.stringify(events)).toContain("passed");
      expect(JSON.stringify(events)).not.toContain("private system");
    } finally {
      await connection.close();
    }
  });
});

function findEvent(events: readonly unknown[], type: string) {
  return events.find(
    (event) =>
      typeof event === "object" && event !== null && "type" in event && event.type === type,
  );
}
