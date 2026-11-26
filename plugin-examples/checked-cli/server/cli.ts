#!/usr/bin/env node
import { readBounded } from "./files.js";
import { requestSchema, validationSchema, type Outcome } from "../shared/contracts.js";
import { captureCommand } from "./runtime.js";
import { validateCapture, failure } from "./validation.js";
import { reserveReceipt, readReceipt } from "./receipts.js";

async function input(path: string): Promise<unknown> {
  let text: string;
  if (path === "-") {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk as Uint8Array);
      length += bytes.length;
      if (length > 65536) throw new Error("Request exceeds 64 KiB.");
      chunks.push(bytes);
    }
    text = Buffer.concat(chunks).toString("utf8");
  } else {
    text = await readBounded(path, 65536);
  }
  return JSON.parse(text);
}
function options(args: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (
      !key ||
      !["--request", "--receipt", "--validation"].includes(key) ||
      !value ||
      values.has(key)
    )
      throw new Error("Invalid or duplicate option.");
    values.set(key, value);
  }
  return values;
}
function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error("Missing " + key);
  return value;
}
const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());
async function main(): Promise<Outcome> {
  const [operation, ...args] = process.argv.slice(2);
  if (!operation || operation === "--help") {
    process.stdout.write(
      "paseo-checked-cli run --request FILE|- [--receipt NEW_FILE]\npaseo-checked-cli inspect --receipt FILE [--validation FILE]\nRuns once in the calling agent's environment. No automatic retries. Receipts contain raw output; opt in only when appropriate.\n",
    );
    process.exit(0);
  }
  const values = options(args);
  if (operation === "inspect") {
    if (values.has("--request")) throw new Error("inspect never executes a request.");
    const capture = await readReceipt(required(values, "--receipt"));
    const validation = validationSchema.parse(
      values.has("--validation") ? await input(required(values, "--validation")) : {},
    );
    return validateCapture(capture, validation);
  }
  if (operation !== "run" || values.has("--validation"))
    throw new Error("Expected run or inspect.");
  const request = requestSchema.parse(await input(required(values, "--request")));
  let save: Awaited<ReturnType<typeof reserveReceipt>> | undefined;
  if (values.has("--receipt")) {
    try {
      save = await reserveReceipt(required(values, "--receipt"));
    } catch {
      return {
        ok: false,
        stage: "receipt",
        code: "RECEIPT_UNAVAILABLE",
        execution: "not-started",
        exitCode: null,
        durationMs: 0,
        message: "Receipt must be a new writable file; command was not started.",
      };
    }
  }
  const capture = await captureCommand(request, controller.signal);
  if (save) {
    try {
      await save(capture);
    } catch {
      return failure(
        capture,
        "receipt",
        "RECEIPT_WRITE",
        "Capture could not be committed. Command may have executed; do not replay it automatically.",
      );
    }
  }
  return validateCapture(capture, request);
}
try {
  const result = await main();
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exitCode = result.ok ? 0 : 1;
} catch {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      stage: process.argv[2] === "inspect" ? "receipt" : "input",
      code: process.argv[2] === "inspect" ? "INVALID_RECEIPT" : "INVALID_INPUT",
      execution: process.argv[2] === "inspect" ? "uncertain" : "not-started",
      exitCode: null,
      durationMs: 0,
      message: "Invalid request, validation, or receipt. Use --help; no command was retried.",
    }) + "\n",
  );
  process.exitCode = 2;
}
