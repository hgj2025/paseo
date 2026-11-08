import type { TeamMember } from "@getpaseo/protocol/workspace-team";

export function memberTabLabel(
  member: Pick<TeamMember, "alias" | "automaticAlias" | "provider">,
  model?: string | null,
): string {
  const automatic =
    member.automaticAlias === true ||
    (member.automaticAlias === undefined &&
      member.alias.toLowerCase() === member.provider.toLowerCase());
  return `@${automatic && model?.trim() ? model.trim() : member.alias}`;
}
