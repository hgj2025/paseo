import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { execCommand } from "@getpaseo/plugin/server";
import { z } from "zod";
import type { ProviderTimelineItem } from "@getpaseo/plugin/server/provider";
import type { AcpStreamMessage } from "@getpaseo/plugin/server/acp";

const record = z.record(z.string(), z.unknown());
const headerSchema = z.object({
  type: z.literal("session"),
  version: z.literal(4),
  id: z.string(),
  cwd: z.string(),
  createdAt: z.number(),
});
const eventSchema = z.object({ type: z.string(), seq: z.number(), time: z.number(), data: record });
const MAX_COMPRESSED = 64 * 1024 * 1024;
const MAX_DECODED = 256 * 1024 * 1024;
export interface Archive {
  sessionId: string;
  cwd: string;
  title: string;
  updatedAt: string;
  updates: AcpStreamMessage[];
}
function object(value: unknown): Record<string, unknown> | null {
  const result = record.safeParse(value);
  return result.success ? result.data : null;
}
function blocks(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    const b = object(v);
    return b ? [b] : [];
  });
}
function text(value: unknown): string {
  return blocks(value)
    .filter((b) => b.type === "text")
    .map((b) => (typeof b.text === "string" ? b.text : ""))
    .join("\n");
}
function update(sessionId: string, item: ProviderTimelineItem): AcpStreamMessage {
  return { jsonrpc: "2.0", method: "_paseo/harness_history", params: { sessionId, item } };
}
interface ReplayTool {
  name: string;
  input: string | null;
}
export function decodeArchive(raw: string, expectedId: string): Archive {
  const tools = new Map<string, ReplayTool>();
  const lines = raw.trimEnd().split("\n");
  const header = headerSchema.parse(JSON.parse(lines.shift() ?? ""));
  if (header.id !== expectedId || !isAbsolute(header.cwd))
    throw new Error("Harness archive identity mismatch");
  const archive: Archive = {
    sessionId: header.id,
    cwd: header.cwd,
    title: expectedId,
    updatedAt: new Date(header.createdAt).toISOString(),
    updates: [],
  };
  for (const line of lines) {
    if (!line.trim()) continue;
    const e = eventSchema.parse(JSON.parse(line));
    archive.updatedAt = new Date(e.time).toISOString();
    if (e.type === "session/title" && typeof e.data.title === "string")
      archive.title = e.data.title;
    archive.updates.push(...eventUpdates(header.id, e.seq, e.type, e.data, tools));
  }
  return archive;
}
function eventUpdates(
  id: string,
  seq: number,
  type: string,
  data: Record<string, unknown>,
  tools: Map<string, ReplayTool>,
): AcpStreamMessage[] {
  if (type === "user/message" || type === "assistant/message") {
    const message = type === "user/message" ? data : object(data.message);
    if (!message) throw new Error("Malformed Harness message record");
    return blocks(message.content).flatMap((block, index) => {
      if (typeof block.text !== "string") return [];
      const itemId = `harness:${id}:${seq}:${index}`;
      if (type === "user/message")
        return [update(id, { id: itemId, type: "user_message", text: block.text })];
      if (block.type === "reasoning")
        return [update(id, { id: itemId, type: "reasoning", text: block.text })];
      if (block.type === "text")
        return [update(id, { id: itemId, type: "assistant_message", text: block.text })];
      return [];
    });
  }
  if (type === "tool/call" && typeof data.callId === "string") {
    tools.set(data.callId, {
      name: String(data.name ?? "Tool"),
      input: typeof data.arguments === "string" ? data.arguments : null,
    });
    return [
      update(id, {
        id: data.callId,
        type: "tool_call",
        callId: data.callId,
        name: String(data.name ?? "Tool"),
        status: "running",
        error: null,
        detail: {
          type: "unknown",
          input: typeof data.arguments === "string" ? data.arguments : null,
          output: null,
        },
      }),
    ];
  }
  if (type === "tool/result") {
    const message = object(data.message);
    if (!message || typeof message.toolCallId !== "string") return [];
    const outcome: { status: "failed"; error: string } | { status: "completed"; error: null } =
      message.isError === true
        ? { status: "failed", error: text(message.content) }
        : { status: "completed", error: null };
    return [
      update(id, {
        id: message.toolCallId,
        type: "tool_call",
        callId: message.toolCallId,
        name: tools.get(message.toolCallId)?.name ?? "Tool",
        ...outcome,
        detail: {
          type: "unknown",
          input: tools.get(message.toolCallId)?.input ?? null,
          output: text(message.content),
        },
      }),
    ];
  }
  return [];
}
export async function readArchive(home: string, id: string): Promise<Archive> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(id)) throw new Error("Invalid Harness session ID");
  const root = await realpath(join(home, "sessions"));
  const groups = await readdir(root, { withFileTypes: true });
  for (const group of groups) {
    if (!group.isDirectory()) continue;
    const candidate = join(root, group.name, id, "session.v4.jsonl.zstd");
    let info;
    try {
      info = await lstat(candidate);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    if (!info.isFile() || info.size > MAX_COMPRESSED)
      throw new Error("Harness archive is not a bounded regular file");
    const resolved = await realpath(candidate);
    const rel = relative(root, resolved);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error("Harness archive escapes its session store");
    // Node 24.15 truncates concatenated zstd frames; Harness appends one frame per flush.
    // Use the native decoder so a successful read cannot silently omit later messages.
    const decoded = await execCommand(
      process.env.PASEO_DSH_ZSTD_COMMAND || "zstd",
      ["-dc", "--", resolved],
      {
        env: process.env,
        timeout: 15_000,
        maxBuffer: MAX_DECODED,
      },
    );
    return decodeArchive(decoded.stdout, id);
  }
  throw new Error(`Harness v4 archive not found: ${id}`);
}
