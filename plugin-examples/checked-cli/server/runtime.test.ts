import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { requestSchema, validationSchema, type Capture } from "../shared/contracts.js";
import { captureCommand, runChecked, validateCapture } from "./runtime.js";
import { reserveReceipt, readReceipt } from "./receipts.js";
import { appendGuidance } from "./integration.js";
import { readBounded } from "./files.js";
import contribute from "../index.server.js";
import type { PluginServerContext } from "@getpaseo/plugin/server";

function noop() {}
let directory: string;
let cli: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "checked cli-"));
  cli = path.join(directory, "cli.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("./cli.ts", import.meta.url))],
    outfile: cli,
    bundle: true,
    platform: "node",
    format: "esm",
  });
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
const capture = (value: unknown): Capture => ({
  version: 1,
  startedAt: "2026-01-01T00:00:00Z",
  durationMs: 2,
  execution: "exited",
  exitCode: 0,
  signal: null,
  stdout: JSON.stringify(value),
  stderr: "",
});
function checked(value: unknown, validation: unknown = {}) {
  return validateCapture(capture(value), validationSchema.parse(validation));
}
function invoke(args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 5000 });
  return { code: result.status, result: JSON.parse(result.stdout) as Record<string, unknown> };
}

describe("agent-side execution", () => {
  it("passes argv literally and keeps stderr separate from JSON stdout", async () => {
    const marker = path.join(directory, "must-not-exist");
    const literal = "$(touch " + marker + "); echo injected";
    const result = await runChecked({
      command: process.execPath,
      args: [
        "-e",
        'console.error("warning"); console.log(JSON.stringify({argument:process.argv[1]}))',
        literal,
      ],
    });
    expect(result.outcome).toMatchObject({ ok: true, data: { argument: literal } });
    expect(result.capture.stderr).toBe("warning\n");
    await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("does not parse stdout after nonzero process exit or leak raw error output", async () => {
    const { outcome, capture: result } = await runChecked({
      command: process.execPath,
      args: ["-e", 'console.log("secret-raw-output");process.exit(7)'],
    });
    expect(outcome).toMatchObject({
      ok: false,
      stage: "process",
      exitCode: 7,
      execution: "exited",
    });
    expect(JSON.stringify(outcome)).not.toContain("secret-raw-output");
    expect(result.stdout).toContain("secret-raw-output");
  });
  it("reports launch failure separately from uncertain execution", async () => {
    const { outcome } = await runChecked({ command: path.join(directory, "not-installed") });
    expect(outcome).toMatchObject({ ok: false, code: "SPAWN", execution: "not-started" });
  });
  it("bounds output before JSON parsing", async () => {
    const { outcome, capture: result } = await runChecked({
      command: process.execPath,
      args: ["-e", 'process.stdout.write("x".repeat(10000))'],
      maxOutputBytes: 128,
    });
    expect(outcome).toMatchObject({ ok: false, code: "OUTPUT_LIMIT", execution: "uncertain" });
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(128);
  });
  it("times out a process without claiming that its side effects were rolled back", async () => {
    const { outcome } = await runChecked({
      command: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"],
      timeoutMs: 80,
    });
    expect(outcome).toMatchObject({ ok: false, code: "TIMEOUT", execution: "uncertain" });
  });
  it("does not launch an already canceled request", async () => {
    const abort = new AbortController();
    abort.abort();
    const result = await captureCommand(
      requestSchema.parse({ command: "not-installed" }),
      abort.signal,
    );
    expect(result).toMatchObject({ failure: "canceled", execution: "not-started" });
  });
});

describe("validation boundaries", () => {
  it("makes optional and nullable independent", () => {
    expect(
      checked({ error: null }, { checks: [{ pointer: "/error", type: "object", optional: true }] }),
    ).toMatchObject({ ok: false, stage: "schema", pointer: "/error" });
    expect(
      checked({ error: null }, { checks: [{ pointer: "/error", type: "object", nullable: true }] }),
    ).toMatchObject({ ok: true });
    expect(
      checked({}, { checks: [{ pointer: "/error", type: "object", optional: true }] }),
    ).toMatchObject({ ok: true });
  });
  it("rejects strings-as-objects, list-of-strings-as-objects and malformed pointers", () => {
    expect(
      checked({ version: "1.2" }, { checks: [{ pointer: "/version", type: "object" }] }),
    ).toMatchObject({ ok: false });
    expect(
      checked({ owners: ["alice"] }, { checks: [{ pointer: "/owners/0", type: "object" }] }),
    ).toMatchObject({ ok: false });
    expect(validationSchema.safeParse({ select: ["/bad~2escape"] }).success).toBe(false);
  });
  it("supports escaped JSON Pointer keys and excludes inherited properties", () => {
    expect(checked({ "a/b": { "~": 3 } }, { select: ["/a~1b/~0"] })).toMatchObject({
      ok: true,
      data: { "/a~1b/~0": 3 },
    });
    expect(checked({ rows: [] }, { select: ["/rows/length"] })).toMatchObject({
      ok: false,
      code: "SELECT_MISSING",
    });
    expect(checked({}, { select: ["/toString"] })).toMatchObject({
      ok: false,
      code: "SELECT_MISSING",
    });
  });
  it("does not mistake generic JSON syntax validation for business success", () => {
    expect(checked({ ok: false })).toMatchObject({ ok: true, data: { ok: false } });
    expect(
      checked({ ok: false }, { assertions: [{ pointer: "/ok", equals: true }] }),
    ).toMatchObject({
      ok: false,
      stage: "business",
      code: "ASSERTION_FAILED",
    });
  });
  it("uses caller-declared business contracts without CLI-specific adapters", () => {
    const validation = {
      assertions: [{ pointer: "/status", equals: "success" }],
      checks: [{ pointer: "/data/version", type: "string" }],
      select: ["/data/version"],
    };
    expect(checked({ status: "success", data: { version: "1.0" } }, validation)).toMatchObject({
      ok: true,
      data: { "/data/version": "1.0" },
    });
    expect(checked({ status: "error", data: null }, validation)).toMatchObject({
      ok: false,
      stage: "business",
    });
    expect(checked({ status: "success", data: { version: {} } }, validation)).toMatchObject({
      ok: false,
      stage: "schema",
    });
  });
  it("requires assertion presence and exact scalar equality", () => {
    expect(checked({}, { assertions: [{ pointer: "/missing", equals: null }] })).toMatchObject({
      ok: false,
      stage: "business",
    });
    expect(
      checked({ flag: "true" }, { assertions: [{ pointer: "/flag", equals: true }] }),
    ).toMatchObject({ ok: false, stage: "business" });
    expect(
      checked({ flag: null }, { assertions: [{ pointer: "/flag", equals: null }] }),
    ).toMatchObject({ ok: true });
    expect(
      validationSchema.safeParse({ assertions: [{ pointer: "/flag", equals: {} }] }).success,
    ).toBe(false);
    expect(validationSchema.safeParse({ adapter: "unknown" }).success).toBe(false);
  });
  it("rejects empty/mixed JSON rather than extracting a plausible substring", () => {
    for (const stdout of ["", 'banner\n{"ok":true}', '{"ok":true}\n{"ok":false}']) {
      expect(
        validateCapture({ ...capture(null), stdout }, validationSchema.parse({})),
      ).toMatchObject({ ok: false, stage: "json" });
    }
  });
  it("does not accept unvalidated shell options or unbounded requests", () => {
    expect(requestSchema.safeParse({ command: "x", shell: true }).success).toBe(false);
    expect(requestSchema.safeParse({ command: "x", timeoutMs: 300001 }).success).toBe(false);
  });
});

describe("explicit receipts and CLI", () => {
  it("revalidates one capture without re-executing an operation", async () => {
    const marker = path.join(directory, "executions");
    const request = path.join(directory, "request.json");
    const receipt = path.join(directory, "receipt.json");
    const validation = path.join(directory, "validation.json");
    await writeFile(
      request,
      JSON.stringify({
        command: process.execPath,
        args: [
          "-e",
          'require("node:fs").appendFileSync(process.argv[1],"once");console.log(JSON.stringify({items:[]}))',
          marker,
        ],
        checks: [{ pointer: "/items", type: "object" }],
      }),
    );
    expect(invoke(["run", "--request", request, "--receipt", receipt])).toMatchObject({
      code: 1,
      result: { stage: "schema", execution: "exited" },
    });
    await writeFile(
      validation,
      JSON.stringify({ checks: [{ pointer: "/items", type: "array" }], select: ["/items"] }),
    );
    expect(invoke(["inspect", "--receipt", receipt, "--validation", validation])).toMatchObject({
      code: 0,
      result: { ok: true, data: { "/items": [] } },
    });
    expect(await readFile(marker, "utf8")).toBe("once");
    expect(invoke(["run", "--request", request, "--receipt", receipt])).toMatchObject({
      result: { code: "RECEIPT_UNAVAILABLE", execution: "not-started" },
    });
    expect(await readFile(marker, "utf8")).toBe("once");
    expect((await stat(receipt)).mode & 0o777).toBe(0o600);
  });
  it("rejects pending/corrupted receipts without executing anything", async () => {
    const receipt = path.join(directory, "pending.json");
    await reserveReceipt(receipt);
    await expect(readReceipt(receipt)).rejects.toThrow();
    expect(invoke(["inspect", "--receipt", receipt])).toMatchObject({
      code: 2,
      result: { ok: false, execution: "uncertain", stage: "receipt" },
    });
  });
  it("produces a bounded structured input error", () => {
    expect(invoke(["run", "--request", "not-present"])).toMatchObject({
      code: 2,
      result: { stage: "input", execution: "not-started" },
    });
  });
});

describe("plugin isolation", () => {
  it("only registers a create hook and preserves provider permissions and MCP", async () => {
    let handler: unknown;
    const remove = noop;
    const context = {
      registerSettings: () => ({
        read: async () => ({
          status: "ready",
          values: { enabled: true, runnerCommand: ["node", "/host path/cli.mjs"] },
        }),
      }),
      before: (name: string, callback: unknown) => {
        expect(name).toBe("agent.create");
        handler = callback;
        return remove;
      },
    } as unknown as PluginServerContext;
    const dispose = contribute(context);
    const config = {
      provider: "codex",
      cwd: "/project",
      systemPrompt: "Original",
      providerOptions: { sandbox_mode: "workspace-write" },
      mcpServers: { existing: {} },
    };
    const apply = handler as (input: {
      request: { config: typeof config };
    }) => Promise<{ config: typeof config }>;
    const result = await apply({ request: { config } });
    expect(result.config.systemPrompt).toContain("Original");
    expect(result.config.systemPrompt).toContain("[checked-cli v1]");
    expect(result.config.providerOptions).toBe(config.providerOptions);
    expect(result.config.mcpServers).toBe(config.mcpServers);
    expect(result.config.cwd).toBe(config.cwd);
    expect(dispose).toBeTypeOf("function");
  });
  it("composes guidance without duplicating it", () => {
    const first = appendGuidance("Existing instructions", ["paseo-checked-cli"]);
    expect(appendGuidance(first, ["paseo-checked-cli"])).toBe(first);
    expect(first).toContain("existing shell tool and approval/sandbox flow");
  });
});

describe("bounded inputs and disabled integration", () => {
  it("bounds file reads before parsing", async () => {
    const file = path.join(directory, "large-input");
    await writeFile(file, "x".repeat(65537));
    await expect(readBounded(file, 65536)).rejects.toThrow("limit");
    expect(invoke(["run", "--request", file])).toMatchObject({
      code: 2,
      result: { execution: "not-started" },
    });
  });
  it("cancels a running child without replay", async () => {
    const controller = new AbortController();
    const running = runChecked(
      { command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] },
      controller.signal,
    );
    const timer = setTimeout(() => controller.abort(), 50);
    try {
      expect((await running).outcome).toMatchObject({
        ok: false,
        code: "CANCELED",
        execution: "uncertain",
      });
    } finally {
      clearTimeout(timer);
    }
  });
  it("does not change agent configuration when disabled", async () => {
    let handler: unknown;
    const context = {
      registerSettings: () => ({
        read: async () => ({
          status: "ready",
          values: { enabled: false, runnerCommand: ["unused"] },
        }),
      }),
      before: (_name: string, callback: unknown) => {
        handler = callback;
        return noop;
      },
    } as unknown as PluginServerContext;
    contribute(context);
    const request = { config: { provider: "codex", cwd: "/project", systemPrompt: "Original" } };
    const apply = handler as (input: { request: typeof request }) => Promise<typeof request>;
    expect(await apply({ request })).toBe(request);
  });
});
