import type { StreamItem } from "@/types/stream";
const sent = new Map<string, string>();
export function rememberSentMessage(scope: string, text: string) {
  if (!text.trim()) return;
  sent.delete(scope);
  sent.set(scope, text);
  if (sent.size > 100) sent.delete(sent.keys().next().value!);
}
export function recallMessage(
  scope: string,
  items: readonly StreamItem[],
  suffix?: string,
): string | null {
  const recent = sent.get(scope);
  if (recent) return recent;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind !== "user_message") continue;
    if (/^\[(?:Team task |Team request |Team request result )/.test(item.text)) continue;
    const text =
      suffix && item.text.endsWith(suffix) ? item.text.slice(0, -suffix.length) : item.text;
    if (text.trim()) return text;
  }
  return null;
}
export function canRecallMessage(event: {
  key: string;
  input: { text: string };
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}): boolean {
  return (
    event.key === "ArrowUp" &&
    event.input.text === "" &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.ctrlKey
  );
}
