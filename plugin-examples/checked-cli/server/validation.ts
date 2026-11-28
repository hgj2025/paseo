import type { Capture, Outcome, Validation, FailureStage } from "../shared/contracts.js";

export function failure(
  capture: Capture,
  stage: FailureStage,
  code: string,
  message: string,
  pointer?: string,
): Outcome {
  return {
    ok: false,
    stage,
    code,
    execution: capture.execution,
    exitCode: capture.exitCode,
    durationMs: capture.durationMs,
    message,
    ...(pointer === undefined ? {} : { pointer }),
  };
}
export function atPointer(value: unknown, pointer: string): { found: boolean; value?: unknown } {
  let current = value;
  for (const segment of pointer === ""
    ? []
    : pointer
        .slice(1)
        .split("/")
        .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (Array.isArray(current) && !/^(0|[1-9][0-9]*)$/.test(segment)) return { found: false };
    if (
      typeof current !== "object" ||
      current === null ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    )
      return { found: false };
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function validateCapture(capture: Capture, validation: Validation): Outcome {
  if (capture.failure)
    return failure(
      capture,
      "process",
      capture.failure.toUpperCase().replace("-", "_"),
      "Process did not complete successfully; do not infer whether side effects occurred.",
    );
  if (capture.execution !== "exited" || capture.exitCode !== 0)
    return failure(
      capture,
      "process",
      "EXIT_NONZERO",
      "Process did not exit successfully. Read back operation state before retrying any operation with side effects.",
    );
  let value: unknown;
  try {
    value = JSON.parse(capture.stdout);
  } catch {
    return failure(
      capture,
      "json",
      "INVALID_JSON",
      "stdout is not a complete JSON document. Reuse this capture; do not rerun the command to fix parsing.",
    );
  }
  for (const assertion of validation.assertions) {
    const selected = atPointer(value, assertion.pointer);
    if (!selected.found || selected.value !== assertion.equals)
      return failure(
        capture,
        "business",
        "ASSERTION_FAILED",
        "Required field is absent or does not equal the declared value.",
        assertion.pointer,
      );
  }
  for (const check of validation.checks) {
    const selected = atPointer(value, check.pointer);
    if (!selected.found && check.optional) continue;
    if (selected.found && selected.value === null && check.nullable) continue;
    const actual = selected.value;
    const valid =
      check.type === "array"
        ? Array.isArray(actual)
        : check.type === "object"
          ? isRecord(actual)
          : typeof actual === check.type && (check.type !== "number" || Number.isFinite(actual));
    if (!selected.found || !valid)
      return failure(
        capture,
        "schema",
        "FIELD_TYPE",
        "Expected " +
          check.type +
          (check.optional ? " when present" : "") +
          (check.nullable ? " or null" : "") +
          ".",
        check.pointer,
      );
  }
  if (validation.select) {
    const projection: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const pointer of validation.select) {
      const selected = atPointer(value, pointer);
      if (!selected.found)
        return failure(capture, "schema", "SELECT_MISSING", "Selected field is absent.", pointer);
      projection[pointer] = selected.value;
    }
    value = projection;
  }
  return {
    ok: true,
    execution: capture.execution,
    exitCode: capture.exitCode,
    durationMs: capture.durationMs,
    data: value,
  };
}
