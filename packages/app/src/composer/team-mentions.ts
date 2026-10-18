/** Only exact roster aliases delimit tasks; file mentions and emails remain task text. */
export function parseTeamMentions(text: string, members: readonly { id: string; alias: string }[]) {
  const aliases = new Map(members.map((member) => [member.alias.toLowerCase(), member.id]));
  const mentions = [...text.matchAll(/(?:^|\s)@([A-Za-z0-9_\-\u4e00-\u9fff]+)(?=\s|$)/g)]
    .map((match) => ({
      id: aliases.get(match[1]!.toLowerCase()),
      start: match.index!,
      end: match.index! + match[0].length,
    }))
    .filter((mention): mention is { id: string; start: number; end: number } =>
      Boolean(mention.id),
    );
  const prompts: Record<string, string> = {};
  const empty: string[] = [];
  mentions.forEach((mention, index) => {
    const body = text.slice(mention.end, mentions[index + 1]?.start ?? text.length).trim();
    if (!body) empty.push(mention.id);
    prompts[mention.id] = [prompts[mention.id], body].filter(Boolean).join("\n\n");
  });
  return {
    memberIds: Object.keys(prompts),
    prompts,
    empty,
    preamble: mentions.length ? text.slice(0, mentions[0]!.start).trim() : "",
  };
}
