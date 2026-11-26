#!/usr/bin/env node
/** ACP adapter for the public Grok Bot session API, verified against @cursor/bdk 0.2.27.
 * Only delivered send-message entries are exposed; the API does not supply tool traces.
 * The existing named Bot and its account-owned conversation remain on Grok Bot.
 */
import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdir, open, rename, unlink, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";

const API = "https://api.cursor.com";
const MODEL = "grokbot-managed";
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const textBlock = (text) => ({ type: "text", text });

export async function credential(env = process.env) {
  if (env.CURSOR_API_KEY?.trim()) return env.CURSOR_API_KEY.trim();
  if (env.CURSOR_API_KEY_FILE) return (await readFile(env.CURSOR_API_KEY_FILE, "utf8")).trim();
  const dir =
    env.AGENT_SERVE_CONFIG_DIR ||
    join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "agent-serve");
  try {
    const saved = JSON.parse(await readFile(join(dir, "credentials.json"), "utf8"));
    if (saved.backendUrl?.replace(/\/$/, "") === "https://api2.cursor.sh" && saved.apiKey)
      return saved.apiKey;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  throw new Error(
    "Grok Bot API login required: run bdk login for the same account as the desktop app.",
  );
}

export class GrokBotApi {
  constructor(key, fetchImpl = fetch) {
    this.key = key;
    this.fetch = fetchImpl;
  }
  async request(method, path, body, signal) {
    const response = await this.fetch(API + path, {
      method,
      headers: {
        authorization: `Bearer ${this.key}`,
        "x-cursor-client-type": "agent-serve",
        "x-request-id": randomUUID(),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
        : AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw new Error(`Grok Bot API HTTP ${response.status}; response body omitted.`);
    return response.json();
  }
  session(name, signal) {
    return this.request("POST", "/v0/grokbot/sessions", { name }, signal);
  }
  entries(id, cursor, signal) {
    return this.request(
      "GET",
      `/v0/grokbot/sessions/${encodeURIComponent(id)}/entries?afterUpdatedSeq=${encodeURIComponent(cursor)}`,
      undefined,
      signal,
    );
  }
  send(id, text, messageId, signal) {
    return this.request(
      "POST",
      `/v0/grokbot/sessions/${encodeURIComponent(id)}/messages`,
      { text, messageId },
      signal,
    );
  }
  interrupt(id) {
    return this.request("POST", `/v0/grokbot/sessions/${encodeURIComponent(id)}/interrupt`, {
      reason: "Canceled by the Paseo task owner",
    });
  }
}

export async function acquireLock(root, name) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, `${hash(name)}.lock`);
  let file;
  try {
    file = await open(path, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const owner = JSON.parse(await readFile(path, "utf8"));
    try {
      process.kill(owner.pid, 0);
      throw new Error("This Grok Bot already has a Paseo task in progress.", { cause: error });
    } catch (failure) {
      if (failure.code !== "ESRCH") throw failure;
      await unlink(path);
      file = await open(path, "wx", 0o600);
    }
  }
  await file.writeFile(JSON.stringify({ pid: process.pid }));
  const inode = (await file.stat()).ino;
  return async () => {
    await file.close();
    try {
      if ((await stat(path)).ino === inode) await unlink(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  };
}

export class GrokBotAdapter {
  constructor({
    bot,
    root = join(homedir(), ".paseo/grokbot"),
    getKey = credential,
    makeApi = (key) => new GrokBotApi(key),
    emit = () => {},
    pollMs = 750,
    waitMs = 24 * 60 * 60 * 1000,
    delay = sleep,
  }) {
    if (!bot?.trim()) throw new Error("An exact existing Grok Bot name is required.");
    Object.assign(this, { bot, root, getKey, makeApi, emit, pollMs, waitMs, delay });
    this.sessions = new Map();
    this.active = new Map();
  }
  path(id) {
    if (!UUID.test(id)) throw new Error("Invalid ACP session ID");
    return join(this.root, "sessions", id + ".json");
  }
  async save(state) {
    const path = this.path(state.id);
    await mkdir(join(this.root, "sessions"), { recursive: true, mode: 0o700 });
    const temporary = path + "." + randomUUID() + ".tmp";
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(state));
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  }
  async state(id) {
    if (!this.sessions.has(id))
      this.sessions.set(id, JSON.parse(await readFile(this.path(id), "utf8")));
    const state = this.sessions.get(id);
    if (state.bot !== this.bot) throw new Error("The saved session belongs to another Bot.");
    return state;
  }
  update(id, update) {
    this.emit({ jsonrpc: "2.0", method: "session/update", params: { sessionId: id, update } });
  }
  modelState() {
    return {
      models: {
        currentModelId: MODEL,
        availableModels: [
          {
            modelId: MODEL,
            name: "Grok Bot 自动",
            description: `使用已有 Bot：${this.bot}；模型由 Grok Bot 管理`,
          },
        ],
      },
      modes: { currentModeId: "agent", availableModes: [{ id: "agent", name: "Bot 原有权限" }] },
    };
  }
  async handle(method, params = {}) {
    if (method === "initialize")
      return {
        protocolVersion: 1,
        agentInfo: { name: "paseo-grokbot", version: "0.1.0" },
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: false, audio: false, embeddedContext: false },
        },
        authMethods: [],
      };
    if (method === "session/new") {
      const state = { id: randomUUID(), bot: this.bot, history: [] };
      await this.save(state);
      this.sessions.set(state.id, state);
      return { sessionId: state.id, ...this.modelState() };
    }
    if (method === "session/load") {
      const state = await this.state(params.sessionId);
      for (const message of state.history)
        this.update(state.id, {
          sessionUpdate: message.role === "user" ? "user_message_chunk" : "agent_message_chunk",
          content: textBlock(message.text),
        });
      return this.modelState();
    }
    if (method === "session/set_model") {
      if (params.modelId !== MODEL) throw new Error("Grok Bot manages its own model.");
      return {};
    }
    if (method === "session/set_mode") {
      if (params.modeId !== "agent") throw new Error("Permissions remain managed by Grok Bot.");
      return {};
    }
    if (method === "session/prompt") return this.prompt(params);
    if (method === "session/cancel") {
      const active = this.active.get(params.sessionId);
      if (active) {
        // Do not cancel an unrelated App turn when this caller has not sent a message.
        if (active.accepted) {
          await active.api.interrupt(active.remoteId);
          active.interrupted = true;
        }
        active.controller.abort();
      }
      return {};
    }
    throw new Error(`Unsupported ACP method: ${method}`);
  }
  async ensureRemote(state, active, account) {
    const signal = active.controller.signal;
    const started = Date.now();
    if (!state.remoteId) {
      const remote = await active.api.session(this.bot, signal);
      if (
        typeof remote.id !== "string" ||
        remote.name !== this.bot ||
        typeof remote.latestUpdatedSeq !== "string"
      )
        throw new Error("Unexpected Grok Bot session response");
      state.remoteId = remote.id;
      state.cursor = remote.latestUpdatedSeq;
      state.account = account;
      await this.save(state);
      if (remote.latestUpdatedSeq === "-1" && remote.createdAtMs >= started - 60000) {
        state.createdUnexpectedly = true;
        await this.save(state);
        throw new Error(
          "The API created an empty Bot instead of finding the existing one. Verify the account and name before sending anything.",
        );
      }
    }
    if (state.createdUnexpectedly)
      throw new Error(
        "This Bot lookup created an empty Bot; account/name verification is required.",
      );
    active.remoteId = state.remoteId;
  }
  async prepareMessage(state, active, text) {
    const signal = active.controller.signal;
    if (!state.pending) {
      const before = await active.api.entries(state.remoteId, state.cursor, signal);
      if (!before.turn || before.turn.inFlight || before.turn.queued > 0 || !before.turn.idle)
        throw new Error("The Bot is busy with an earlier App/API task; no message was sent.");
      state.cursor = before.latestUpdatedSeq;
      state.pending = { messageId: randomUUID(), hash: hash(text), phase: "sending" };
      state.history.push({ role: "user", text });
      await this.save(state);
      // Persist before sending. An ambiguous outcome must never create a second message.
      const sent = await active.api.send(state.remoteId, text, state.pending.messageId, signal);
      if (!["accepted_temporal", "duplicate"].includes(sent.delivery))
        throw new Error("Remote message acceptance was not confirmed; no automatic resend.");
      state.pending.phase = "accepted";
      await this.save(state);
    }
    if (state.pending.phase !== "accepted")
      throw new Error(
        "Original send outcome is uncertain. Inspect the Grok Bot conversation before retrying; nothing was resent.",
      );
  }
  async consumePage(state, active) {
    const page = await active.api.entries(state.remoteId, state.cursor, active.controller.signal);
    if (!Array.isArray(page.entries) || typeof page.latestUpdatedSeq !== "string" || !page.turn)
      throw new Error("Unexpected transcript response");
    const fresh = page.entries.filter(
      (x) => x.kind === "send-message" && typeof x.text === "string",
    );
    for (const entry of fresh) {
      this.update(state.id, {
        sessionUpdate: "agent_message_chunk",
        content: textBlock(entry.text + "\n"),
      });
      state.history.push({ role: "assistant", text: entry.text });
    }
    state.cursor = page.latestUpdatedSeq;
    state.pending.deliveries = (state.pending.deliveries || 0) + fresh.length;
    await this.save(state);
    return page;
  }
  async pollReply(state, active, toolId) {
    const signal = active.controller.signal,
      sessionId = state.id;
    let sawBusy = false,
      idlePolls = 0;
    const deadline = Date.now() + this.waitMs;
    while (true) {
      const page = await this.consumePage(state, active);
      const busy = page.turn.inFlight || page.turn.queued > 0;
      sawBusy ||= busy;
      idlePolls = page.entries.length === 0 && !busy && page.turn.idle ? idlePolls + 1 : 0;
      if (idlePolls > 0 && (sawBusy || idlePolls >= 4)) {
        if (!state.pending.deliveries)
          throw new Error(
            "The Bot became idle without delivering a reply; success is unconfirmed.",
          );
        state.pending = null;
        await this.save(state);
        this.update(sessionId, {
          sessionUpdate: "tool_call_update",
          toolCallId: toolId,
          status: "completed",
        });
        return { stopReason: "end_turn" };
      }
      if (Date.now() >= deadline)
        throw new Error(
          "The remote task is still running. Send “继续” to resume checking; do not resend the task.",
        );
      await this.delay(this.pollMs, undefined, { signal });
    }
  }
  async prompt({ sessionId, prompt }) {
    if (this.active.has(sessionId))
      throw new Error("This Paseo session already has an active turn.");
    if (!Array.isArray(prompt) || prompt.some((x) => x.type !== "text"))
      throw new Error("This Grok Bot API adapter currently accepts text only.");
    const text = prompt.map((x) => x.text).join("\n");
    if (!text.trim()) throw new Error("Empty prompt");
    const state = await this.state(sessionId),
      key = await this.getKey();
    const account = hash(key);
    if (state.account && state.account !== account)
      throw new Error("API credential changed; create a new Paseo session to verify the account.");
    const release = await acquireLock(join(this.root, "locks"), account + ":" + this.bot);
    const active = {
      controller: new AbortController(),
      api: this.makeApi(key),
      accepted: false,
      interrupted: false,
    };
    this.active.set(sessionId, active);
    const toolId = randomUUID();
    let displayed = false;
    try {
      if (
        state.pending &&
        state.pending.hash !== hash(text) &&
        !/^(继续|续查|continue|check)(?:\s|$)/i.test(text.trim())
      )
        throw new Error(
          "A prior remote task is unresolved. Send “继续” to check it; no new message was sent.",
        );
      await this.ensureRemote(state, active, account);
      await this.prepareMessage(state, active, text);
      active.accepted = true;
      this.update(sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: toolId,
        title: `等待 ${this.bot} 交付回复`,
        kind: "other",
        status: "in_progress",
      });
      displayed = true;
      return await this.pollReply(state, active, toolId);
    } catch (error) {
      if (displayed)
        this.update(sessionId, {
          sessionUpdate: "tool_call_update",
          toolCallId: toolId,
          status: "failed",
        });
      if (active.interrupted) {
        state.pending = null;
        await this.save(state);
        return { stopReason: "cancelled" };
      }
      throw error;
    } finally {
      this.active.delete(sessionId);
      await release();
    }
  }
}

export function serve(adapter) {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Invalid JSON" },
        }) + "\n",
      );
      return;
    }
    void adapter.handle(message.method, message.params).then(
      (result) => {
        if ("id" in message)
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
        return null;
      },
      (error) => {
        if ("id" in message)
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              error: { code: -32000, message: error.message },
            }) + "\n",
          );
      },
    );
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--version")) console.log("paseo-grokbot-acp 0.1.0");
  else {
    const index = process.argv.indexOf("--bot");
    if (index < 0 || !process.argv[index + 1])
      throw new Error("--bot must name an existing Grok Bot");
    serve(
      new GrokBotAdapter({
        bot: process.argv[index + 1],
        emit: (value) => process.stdout.write(JSON.stringify(value) + "\n"),
      }),
    );
  }
}
