export function appendGuidance(
  existing: string | undefined,
  runnerCommand: readonly string[],
): string {
  const marker = "[checked-cli v1]";
  if (existing?.includes(marker)) return existing;
  return [
    existing?.trim(),
    marker,
    "A checked CLI helper is available on this host. Runner argv prefix: " +
      JSON.stringify(runnerCommand) +
      ". Invoke it through your existing shell tool and approval/sandbox flow; the plugin does not execute commands.",
    "Use run --request FILE (or - for stdin) for CLI+JSON tasks. Request keys: command, args (array), optional cwd/timeoutMs/maxOutputBytes, assertions [{pointer,equals}] (scalar equality), checks [{pointer,type,optional?,nullable?}], select [JSON Pointer]. Assertions/checks/select apply to the original JSON; no business fields are assumed. Optional and nullable are independent.",
    "Check ok and stage before accessing data. Do not treat a returned tool call or process exit 0 as proof of business success. Generic json validates syntax/types only; declare business assertions from a verified command contract. Reuse reliable existing Python/other scripts.",
    "No auto retries. For operations with side effects, read back the operation/session state after uncertainty. If raw output can be retained appropriately, opt in to --receipt NEW_FILE (0600, may contain sensitive data); inspect --receipt FILE --validation FILE reparses without execution. No receipt is saved by default. Do not rerun an operation just to repair parsing.",
    "If the helper is unavailable, report that and use your existing tools; do not install dependencies or change permissions automatically. Only new agents receive these instructions; existing agents are unchanged.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
