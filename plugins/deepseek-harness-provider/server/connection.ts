import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawnProcess, terminateProcess } from "@getpaseo/plugin/server";
import type { AcpStream, AcpStreamMessage } from "@getpaseo/plugin/server/acp";
import { z } from "zod";
import type { ProviderLaunch } from "@getpaseo/plugin/server/provider";
import { HarnessBridge } from "./bridge.js";
import { readArchive } from "./history.js";

const id = z.union([z.string(), z.number(), z.null()]);
const messageSchema = z.union([
  z.object({ jsonrpc: z.literal("2.0"), id, method: z.string(), params: z.unknown().optional() }),
  z.object({ jsonrpc: z.literal("2.0"), method: z.string(), params: z.unknown().optional() }),
  z
    .object({ jsonrpc: z.literal("2.0"), id, result: z.unknown() })
    .refine((value) => Object.hasOwn(value, "result")),
  z.object({
    jsonrpc: z.literal("2.0"),
    id,
    error: z.object({ code: z.number(), message: z.string(), data: z.unknown().optional() }),
  }),
]);
export function parseHarnessMessage(value: unknown): AcpStreamMessage {
  return messageSchema.parse(value);
}

export function createHarnessStream(launch?: ProviderLaunch): AcpStream {
  const env = launch?.env ?? process.env;
  const home = resolve(env.DSH_HOME || resolve(homedir(), ".dsh"));
  const child = spawnProcess(
    launch?.command ?? env.PASEO_DSH_COMMAND ?? "dsh",
    launch?.args ?? ["--profile", "acp"],
    {
      env: { ...env, DSH_HOME: home },
      stdio: "pipe",
    },
  );
  let closed = false;
  let buffer = "";
  let stderr = "";
  let controller: ReadableStreamDefaultController<AcpStreamMessage>;
  const stop = () => {
    if (closed) return;
    closed = true;
    child.stdin.end();
    const timer = setTimeout(() => terminateProcess(child), 3000);
    timer.unref();
    child.once("close", () => clearTimeout(timer));
  };
  const fail = (error: unknown) => {
    if (closed) return;
    controller.error(error);
    stop();
  };
  const bridge = new HarnessBridge({
    readArchive: (sessionId) => readArchive(home, sessionId),
    emit: (message) => {
      if (!closed) controller.enqueue(message);
    },
    send: (message) =>
      new Promise<void>((done, reject) => {
        child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
          if (error) reject(error);
          else done();
        });
      }),
  });
  let incoming = Promise.resolve();
  const readable = new ReadableStream<AcpStreamMessage>({
    start(value) {
      controller = value;
    },
    cancel() {
      stop();
    },
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) {
      fail(new Error("Harness protocol frame exceeds 16 MiB"));
      return;
    }
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      incoming = incoming
        .then(async () => {
          const message = parseHarnessMessage(JSON.parse(line));
          return bridge.receiveHarness(message);
        })
        .catch(fail);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-2048);
  });
  child.stdin.on("error", fail);
  child.on("error", fail);
  child.on("close", (code, signal) => {
    if (!closed) fail(new Error(`Harness exited (${signal ?? code}): ${stderr}`));
  });
  return {
    readable,
    writable: new WritableStream<AcpStreamMessage>({
      write(message) {
        if (closed) throw new Error("Harness connection closed");
        return bridge.receiveClient(message);
      },
      close() {
        stop();
      },
      abort() {
        stop();
      },
    }),
  };
}
