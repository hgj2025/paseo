import type { TeamMember, TeamTask } from "@getpaseo/protocol/workspace-team";

export function memberPathInstructions(
  member: Pick<TeamMember, "serverId" | "pathContext">,
): string {
  return `[Team path convention]
Your host: ${JSON.stringify(member.serverId)}
${member.pathContext ? `Your repository mapping: ${JSON.stringify(member.pathContext)}\n` : "No repository mapping is configured; verify your working directory before resolving paths.\n"}In team tasks and results, identify files by repository + repository-relative path (optional line number). Resolve references using your own repository mapping, never another host's absolute root. Label absolute paths and temporary artifacts with their owning host; they are not shared or automatically transferred. If the repository is unknown, ask for its mapping instead of guessing. Report branch/commit when code versions matter.

`;
}

export function resultPathInstructions(task: Pick<TeamTask, "pathContext">): string {
  return task.pathContext
    ? `Result repository context (source host only; do not use its root locally): ${JSON.stringify(task.pathContext)}\n`
    : "";
}
