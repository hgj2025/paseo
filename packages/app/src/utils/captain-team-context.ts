/** Keep the sent context and its display-only recognition in sync. */
export function captainTeamContext(workspaceId: string): string {
  return `[Team context] You are Captain for workspace ${workspaceId}. Use list_team_members to read current responsibilities and skills before assigning the user's requested work with send_team_task. Completion reports are automatic. Do not assign additional work beyond the user's request.`;
}

export function withoutCaptainTeamContext(text: string): string {
  const marker = "\n\n[Team context] You are Captain for workspace ";
  const index = text.lastIndexOf(marker);
  if (index <= 0) return text;
  const suffix = text.slice(index + 2);
  const workspace = /^\[Team context\] You are Captain for workspace (\S+?)\. Use /.exec(
    suffix,
  )?.[1];
  return workspace && suffix === captainTeamContext(workspace) ? text.slice(0, index) : text;
}
