import { describe, expect, it } from "vitest";
import { memberTabLabel } from "./member-tab-label";

describe("memberTabLabel", () => {
  it("uses the current model instead of a stale automatic alias", () => {
    expect(
      memberTabLabel({ alias: "Codex", automaticAlias: true, provider: "codex" }, "gpt-6.1-sol"),
    ).toBe("@gpt-6.1-sol");
    expect(
      memberTabLabel({ alias: "Codex", automaticAlias: true, provider: "claude" }, "Opus 5.5"),
    ).toBe("@Opus 5.5");
  });
  it("recognizes legacy provider defaults but preserves explicit names and Captain", () => {
    expect(memberTabLabel({ alias: "Codex", provider: "codex" }, "gpt-new")).toBe("@gpt-new");
    expect(
      memberTabLabel({ alias: "Codex", automaticAlias: false, provider: "codex" }, "gpt-new"),
    ).toBe("@Codex");
    expect(memberTabLabel({ alias: "Reviewer", automaticAlias: true, provider: "claude" })).toBe(
      "@Reviewer",
    );
    expect(memberTabLabel({ alias: "Captain", provider: "codex" }, "gpt-new")).toBe("@Captain");
  });
});
