import type { TeamTask } from "@getpaseo/protocol/workspace-team";

type DisplayTask = Pick<TeamTask, "id" | "prompt" | "memberId">;
export type TeamMessageDisplay =
  | { kind: "task"; text: string }
  | { kind: "report"; text: string; memberId: string; status: "completed" | "failed" };

/** Only recognize envelopes backed by a task in this conversation. Provider history stays intact. */
export function resolveTeamMessageDisplay(
  message: string,
  tasks: readonly DisplayTask[],
): TeamMessageDisplay | null {
  const taskId = /^\[Team task ([^\n\]]+)\]\n/.exec(message)?.[1];
  if (taskId) {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) return null;
    const body = message.slice(`[Team task ${task.id}]\n`.length);
    if (body === task.prompt) return { kind: "task", text: task.prompt };
    if (!body.endsWith(task.prompt)) return null;
    const header = body.slice(0, body.length - task.prompt.length);
    if (/^Member prompt constraints \(@[^\n)]+\):\n[\s\S]+\n\nTask:\n$/.test(header))
      return { kind: "task", text: task.prompt };
    return null;
  }
  const report =
    /^(?:\[Team request result [^\n\]]+\]\n)?Team task ([^\n ]+) (completed|failed)\. Summarize this result for the user; do not dispatch more work unless the user requested it\.\n/.exec(
      message,
    );
  if (!report) return null;
  const task = tasks.find((entry) => entry.id === report[1]);
  if (!task) return null;
  const header = `${report[0]}Task: ${task.prompt}\nResult:\n`;
  if (!message.startsWith(header)) return null;
  return {
    kind: "report",
    memberId: task.memberId,
    status: report[2] as "completed" | "failed",
    text: `${task.prompt}\n\n${message.slice(header.length)}`,
  };
}
