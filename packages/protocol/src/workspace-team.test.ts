import { describe, expect, it } from "vitest";
import { resolveTeamMemberAliases, TeamAliasSchema, type TeamMember } from "./workspace-team.js";
function member(id: string, extra: Partial<TeamMember> = {}): TeamMember {
  return {
    id,
    alias: "Codex",
    serverId: "mac",
    workspaceId: "work",
    agentId: id,
    provider: "codex",
    role: "",
    skills: [],
    ...extra,
  };
}
function execution(model: string) {
  return { serverId: "remote", workspaceId: "other", agentId: "runner", provider: "claude", model };
}
describe("team model aliases", () => {
  it("repairs legacy provider defaults from the selected execution without mutating anchors", () => {
    const original = member("peer", { execution: execution("claude-opus-5-5") });
    const next = resolveTeamMemberAliases([original], null)[0]!;
    expect(next).toMatchObject({
      id: "peer",
      agentId: "peer",
      provider: "codex",
      alias: "claude-opus-5-5",
      automaticAlias: true,
    });
    expect(next.execution).toBe(original.execution);
    expect(original.alias).toBe("Codex");
  });
  it("retains verified automatic aliases when upgrading legacy records", () => {
    const verified = member("verified", {
      alias: "Verified-model",
      automaticAlias: true,
      execution: execution("requested-model"),
    });
    const legacy = member("legacy", { execution: execution("requested-model") });
    expect(
      resolveTeamMemberAliases([verified, legacy], null, { legacyOnly: true }).map((m) => m.alias),
    ).toEqual(["Verified-model", "requested-model"]);
  });
  it("uses live model changes and keeps aliases routable and unique", () => {
    const members = [
      member("captain", { alias: "Captain" }),
      member("one", { automaticAlias: true }),
      member("two", { automaticAlias: true }),
    ];
    const first = resolveTeamMemberAliases(members, "captain", {
      models: new Map([
        ["one", "GPT 6.1"],
        ["two", "GPT 6.1"],
      ]),
    });
    expect(first.map((m) => m.alias)).toEqual(["Captain", "GPT-6-1", "GPT-6-1-2"]);
    const second = resolveTeamMemberAliases(first, "captain", {
      models: new Map([
        ["one", "Opus 5.5"],
        ["two", "GPT 6.1"],
      ]),
    });
    expect(second.map((m) => m.alias)).toEqual(["Captain", "Opus-5-5", "GPT-6-1"]);
    expect(second.map((m) => TeamAliasSchema.safeParse(m.alias).success)).toEqual([
      true,
      true,
      true,
    ]);
  });
  it("preserves Captain, custom names and explicitly manual provider names", () => {
    const members = [
      member("captain", { alias: "Captain", automaticAlias: true }),
      member("custom", { alias: "Reviewer" }),
      member("manual", { automaticAlias: false }),
      member("auto", { automaticAlias: true }),
    ];
    const models = new Map(members.map((m) => [m.id, "Reviewer"]));
    expect(resolveTeamMemberAliases(members, "captain", { models }).map((m) => m.alias)).toEqual([
      "Captain",
      "Reviewer",
      "Codex",
      "Reviewer-2",
    ]);
  });
});
