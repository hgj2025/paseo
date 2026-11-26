import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import type { Capture, Outcome } from "../shared/contracts.js";
import { requestSchema, validationSchema, captureSchema } from "../shared/contracts.js";
import { validateCapture } from "./validation.js";
export { requestSchema, validationSchema, captureSchema, validateCapture };
export type { Capture, Outcome, Request, Validation } from "../shared/contracts.js";

export async function captureCommand(input: unknown, signal?: AbortSignal): Promise<Capture> {
  const request = requestSchema.parse(input);
  const startedAt = new Date().toISOString();
  const start = performance.now();
  if (signal?.aborted)
    return {
      version: 1,
      startedAt,
      durationMs: 0,
      execution: "not-started",
      exitCode: null,
      signal: null,
      failure: "canceled",
      stdout: "",
      stderr: "",
    };
  let complete!: (capture: Capture) => void;
  const done = new Promise<Capture>((resolve) => {
    complete = resolve;
  });
  {
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    let bytes = 0,
      reason: Capture["failure"],
      escalation: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const kill = (sig: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") child.kill(sig);
        else process.kill(-child.pid, sig);
      } catch {
        /* Already exited. */
      }
    };
    const stop = (failure: NonNullable<Capture["failure"]>) => {
      if (reason) return;
      reason = failure;
      kill("SIGTERM");
      escalation = setTimeout(() => kill("SIGKILL"), 200);
    };
    const abort = () => stop("canceled");
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => stop("timeout"), request.timeoutMs);
    const receive = (target: Buffer[], chunk: Buffer) => {
      const remaining = Math.max(0, request.maxOutputBytes - bytes);
      if (remaining > 0) target.push(chunk.subarray(0, remaining));
      bytes += chunk.length;
      if (bytes > request.maxOutputBytes) stop("output-limit");
    };
    child.stdout.on("data", (chunk: Buffer) => receive(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => receive(stderr, chunk));
    child.on("error", () => {
      if (!reason) reason = "spawn";
    });
    child.on("close", (exitCode, exitSignal) => {
      [timer, escalation].forEach((pending) => {
        if (pending) clearTimeout(pending);
      });
      signal?.removeEventListener("abort", abort);
      complete({
        version: 1,
        startedAt,
        durationMs: Math.round(performance.now() - start),
        execution: !child.pid ? "not-started" : reason || exitSignal ? "uncertain" : "exited",
        exitCode,
        signal: exitSignal,
        ...(reason ? { failure: reason } : {}),
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    // Abort can race listener installation.
    if (signal?.aborted) abort();
  }
  return done;
}
export async function runChecked(
  input: unknown,
  signal?: AbortSignal,
): Promise<{ capture: Capture; outcome: Outcome }> {
  const request = requestSchema.parse(input);
  const capture = await captureCommand(request, signal);
  return { capture, outcome: validateCapture(capture, request) };
}
