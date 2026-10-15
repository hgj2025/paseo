const REDACTED = "[REDACTED]";
const PRIVATE_FIELDS = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "secwebsocketprotocol",
  "auth",
  "credential",
  "credentials",
  "daemonpublickeyb64",
  "publickeyb64",
  "connectionuri",
  "pairingurl",
  "offer",
  "qr",
  "stdin",
  "stdout",
  "stderr",
  "prompt",
  "systemprompt",
]);

function isPrivateField(key: string): boolean {
  const normalized = key.replace(/[-_]/g, "").toLowerCase();
  return (
    PRIVATE_FIELDS.has(normalized) ||
    /(?:password(?:hash)?|passwd|passphrase|token|secret|apikey|privatekey|secretkey)(?:b64)?$/.test(
      normalized,
    )
  );
}

function redactText(value: string): string {
  return value
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      REDACTED,
    )
    .replace(/\brelay:\/\/[^\s"'<>]+/gi, REDACTED)
    .replace(/([#&](?:offer|connect)=)[^\s"'<>]+/gi, "$1" + REDACTED)
    .replace(/(https?:\/\/)[^/\s:@]+:[^/@\s]+@/gi, "$1" + REDACTED + "@")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi, "$1 " + REDACTED)
    .replace(/\b(?:Expo|Exponent)PushToken\[[^\]]+\]/g, REDACTED)
    .replace(/\b(?:sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{8,}/g, REDACTED)
    .replace(
      /(\b(?:[A-Z_][A-Z0-9_]*(?:TOKEN|API_KEY|SECRET|PASSWORD)|password|passwd|passphrase|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|private[_-]?key)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&"'<>]+)/gi,
      "$1" + REDACTED,
    )
    .replace(/([?&](?:key|password|token|secret|api[_-]?key)=)[^\s&#"'<>]+/gi, "$1" + REDACTED);
}

function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= 40) return REDACTED;
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isPrivateField(key) ? REDACTED : redactValue(entry, depth + 1),
    ]),
  );
}

// Run after Pino formats messages and serializes errors/child bindings, but
// before either the JSON or pretty transport writes them. Never mutate callers.
export function redactLogLine(line: string): string {
  try {
    return JSON.stringify(redactValue(JSON.parse(line))) + "\n";
  } catch {
    // Fail closed: a malformed record must not bypass the redaction boundary.
    return '{"level":50,"msg":"Omitted malformed log record"}\n';
  }
}
