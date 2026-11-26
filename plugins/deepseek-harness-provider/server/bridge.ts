import { setImmediate as nextTurn } from "node:timers/promises";
import type { AcpStreamMessage } from "@getpaseo/plugin/server/acp";
import { z } from "zod";
import type { Archive } from "./history.js";

const objectSchema = z.record(z.string(), z.unknown());
const sessionSchema = z.object({ sessionId: z.string(), cwd: z.string() }).passthrough();
function object(value: unknown): Record<string, unknown> {
  return objectSchema.parse(value);
}
interface BridgeOptions {
  readArchive(id: string): Promise<Archive>;
  emit(message: AcpStreamMessage): void;
  send(message: AcpStreamMessage): Promise<void>;
}
export class HarnessBridge {
  private pending = new Map<string | number | null, { method: string; archive?: Archive }>();
  private canResume = false;
  constructor(private readonly options: BridgeOptions) {}
  async receiveClient(message: AcpStreamMessage): Promise<void> {
    if (!("method" in message) || !("id" in message)) return this.options.send(message);
    if (message.method !== "session/load") {
      this.pending.set(message.id, { method: message.method });
      return this.options.send(message);
    }
    try {
      if (!this.canResume) throw new Error("Harness does not advertise session/resume");
      const params = object(message.params);
      const session = sessionSchema.parse(params);
      const archive = await this.options.readArchive(session.sessionId);
      if (archive.cwd !== session.cwd)
        throw new Error("Harness session working directory mismatch");
      this.pending.set(message.id, { method: message.method, archive });
      await this.options.send({ ...message, method: "session/resume" });
    } catch (error) {
      this.pending.delete(message.id);
      this.options.emit({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : "Harness history unavailable",
        },
      });
    }
  }
  async receiveHarness(message: AcpStreamMessage): Promise<void> {
    if (!("id" in message) || "method" in message) {
      this.options.emit(message);
      return;
    }
    const pending = this.pending.get(message.id);
    this.pending.delete(message.id);
    if (!pending || "error" in message) {
      if (pending && "error" in message) {
        const described = describeHarnessError(message.error);
        console.warn("Harness ACP request failed", pending.method, described.message);
        this.options.emit({ ...message, error: described });
        return;
      }
      this.options.emit(message);
      return;
    }
    let result = object(message.result);
    if (pending.method === "initialize") {
      const caps = object(result.agentCapabilities);
      const sessions = object(caps.sessionCapabilities ?? {});
      this.canResume = sessions.resume !== undefined;
      if (this.canResume) result = { ...result, agentCapabilities: { ...caps, loadSession: true } };
    }
    if (pending.method === "session/list") {
      const rows = z.array(sessionSchema).parse(result.sessions);
      const sessions = [];
      for (const row of rows) {
        try {
          const archive = await this.options.readArchive(row.sessionId);
          sessions.push({ ...row, title: archive.title, updatedAt: archive.updatedAt });
        } catch (error) {
          console.warn(
            "Harness archive discovery failed",
            row.sessionId,
            error instanceof Error ? error.message : String(error),
          );
          // Preserve discovery; a later load reports the specific archive error.
          sessions.push(row);
        }
      }
      result = { ...result, sessions };
    }
    this.options.emit({ ...message, result });
    if (pending.archive) {
      // Paseo's ACP adapter installs its native session ID after the load response.
      // Yield once so replay reaches that session instead of being discarded during open.
      await nextTurn();
      for (const notification of pending.archive.updates) this.options.emit(notification);
    }
  }
}

function describeHarnessError(error: Extract<AcpStreamMessage, { error: unknown }>["error"]) {
  const data = z
    .object({ details: z.string().optional(), message: z.string().optional() })
    .safeParse(error.data);
  if (!data.success) return error;
  const details = data.data.details ?? data.data.message;
  if (!details) return error;
  if (details.includes("already owned by an active write handle")) {
    return {
      ...error,
      message:
        "DeepSeek Harness 会话正在被其他进程占用。请先在 Harness Desktop 中释放该会话或退出 Desktop，再重试导入。",
    };
  }
  if (error.message !== "Internal error") return error;
  return { ...error, message: `DeepSeek Harness: ${details.slice(0, 2000)}` };
}
