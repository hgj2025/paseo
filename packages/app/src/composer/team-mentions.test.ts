import { describe, expect, it } from "vitest";
import { parseTeamMentions, teamMentionCandidates } from "./team-mentions";
const members = [
  { id: "linux", alias: "devbox-claude" },
  { id: "mac", alias: "mac-grok" },
];
describe("inline team routing", () => {
  it("keeps multiline tasks isolated between roster mentions", () => {
    expect(
      parseTeamMentions(
        "@devbox-claude Check Linux\nRead @README.md and a@b.com\n@mac-grok Check Mac",
        members,
      ),
    ).toMatchObject({
      prompts: { linux: "Check Linux\nRead @README.md and a@b.com", mac: "Check Mac" },
      empty: [],
      preamble: "",
    });
  });
  it("combines repeated recipients in order and matches aliases case-insensitively", () => {
    expect(
      parseTeamMentions("@MAC-GROK First @devbox-claude Linux @mac-grok Second", members).prompts,
    ).toEqual({ mac: "First\n\nSecond", linux: "Linux" });
  });
  it("reports empty segments and unaddressed preamble without silently dropping them", () => {
    expect(parseTeamMentions("Intro @mac-grok @devbox-claude Task", members)).toMatchObject({
      empty: ["mac"],
      preamble: "Intro",
    });
  });
  it("does not route partial aliases, email addresses or file paths", () => {
    expect(parseTeamMentions("a@mac-grok @mac @mac-grok/readme.md", members).memberIds).toEqual([]);
  });
});

describe("team mention candidates", () => {
  it("includes Captain and peers across hosts, excluding self and pending removals", () => {
    const roster = [
      { id: "captain", alias: "Captain", serverId: "mac" },
      { id: "linux", alias: "Claude", serverId: "devbox" },
      { id: "peer", alias: "Peer", serverId: "remote" },
      { id: "leaving", alias: "Leaving", serverId: "remote", removing: true },
    ];
    const candidates = teamMentionCandidates(roster, "linux");
    expect(candidates.map((m) => m.id)).toEqual(["captain", "peer"]);
    expect(parseTeamMentions("@Captain Review this @Peer Verify that", candidates).prompts).toEqual(
      { captain: "Review this", peer: "Verify that" },
    );
    expect(teamMentionCandidates(roster, "captain").map((m) => m.id)).toEqual(["linux", "peer"]);
  });
});
