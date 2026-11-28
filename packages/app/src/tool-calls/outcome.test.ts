import { describe, expect, it } from "vitest";
import { toolCallDisplayOutcome } from "./outcome";

function shell(command: string, exitCode = 1, output = "", error: unknown = null) {
  return {
    status: "failed" as const,
    error,
    detail: { type: "shell" as const, command, exitCode, output },
  };
}
describe("shell display outcomes", () => {
  it.each([
    "rg missing src",
    "rg -n 'a|b' src",
    'rg -e "a;b" src',
    "rg --files -g '*.ts'",
    "/opt/bin/rg missing src",
    "'rg' 'literal $pattern'",
    "rg a\\;b src",
  ])("labels a single search with no results: %s", (command) => {
    expect(toolCallDisplayOutcome(shell(command))).toEqual({
      status: "completed",
      noMatches: true,
    });
  });
  it.each([
    "sed missing; rg missing src",
    "gofmt x; go test ./...",
    "rg x src | head",
    "rg x src && echo done",
    "rg x src > output",
    "rg $(false) src",
    'rg "$(false)" src',
    "rg `false` src",
    "rg x src\nfalse",
    "rg x src # comment",
    "rg x src*",
    "env rg x src",
    "zsh -lc 'rg x src'",
    "rg 'unterminated",
    "rg x src\\\nfalse",
    "false rg x src",
    "rg x src &",
    "rg <(false) src",
  ])("preserves uncertain or compound command failure: %s", (command) => {
    expect(toolCallDisplayOutcome(shell(command))).toEqual({ status: "failed", noMatches: false });
  });
  it("keeps rg IO errors, diagnostics and explicit provider errors as failures", () => {
    expect(toolCallDisplayOutcome(shell("rg x missing", 2, "rg: missing: No such file"))).toEqual({
      status: "failed",
      noMatches: false,
    });
    expect(toolCallDisplayOutcome(shell("rg x src", 1, "rg: permission denied"))).toEqual({
      status: "failed",
      noMatches: false,
    });
    expect(
      toolCallDisplayOutcome(shell("rg x src", 1, "", { message: "Permission denied" })),
    ).toEqual({ status: "failed", noMatches: false });
    expect(
      toolCallDisplayOutcome(
        shell("rg x src", 1, "", { message: "Command failed", code: "DENIED" }),
      ),
    ).toEqual({ status: "failed", noMatches: false });
    expect(toolCallDisplayOutcome(shell("rg x src", 1, "", { message: "Command failed" }))).toEqual(
      { status: "completed", noMatches: true },
    );
  });
  it("retains cancellation and running state and normalizes completed nonzero results", () => {
    expect(toolCallDisplayOutcome({ ...shell("rg x src"), status: "canceled" })).toEqual({
      status: "canceled",
      noMatches: false,
    });
    expect(toolCallDisplayOutcome({ ...shell("rg x src"), status: "running" })).toEqual({
      status: "running",
      noMatches: false,
    });
    expect(toolCallDisplayOutcome({ ...shell("rg x src", 2), status: "completed" })).toEqual({
      status: "failed",
      noMatches: false,
    });
    expect(
      toolCallDisplayOutcome({
        status: "failed",
        error: null,
        detail: { type: "shell", command: "rg x", exitCode: 1 },
      }),
    ).toEqual({ status: "failed", noMatches: false });
  });
});
