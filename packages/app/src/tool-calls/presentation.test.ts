import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { describe, expect, it } from "vitest";

import { buildToolCallPresentation, type ToolCallPresentationIcon } from "./presentation";

const fakeIcons = {
  brain: (() => null) as ToolCallPresentationIcon,
  eye: (() => null) as ToolCallPresentationIcon,
  wrench: (() => null) as ToolCallPresentationIcon,
};

function fakeResolveIcon(
  toolName: string,
  detail: ToolCallDetail | undefined,
): ToolCallPresentationIcon {
  if (detail?.type === "plan") {
    return fakeIcons.brain;
  }
  if (detail?.type === "read") {
    return fakeIcons.eye;
  }
  if (toolName === "exec_command") {
    return fakeIcons.wrench;
  }
  return fakeIcons.wrench;
}

describe("tool-call presentation", () => {
  it("builds badge, detail, icon, and file-open policy in one model", () => {
    const presentation = buildToolCallPresentation({
      toolName: "read_file",
      status: "completed",
      error: null,
      cwd: "/tmp/repo",
      detail: {
        type: "read",
        filePath: "/tmp/repo/src/index.ts",
        content: "console.log('hi');",
      },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation).toMatchObject({
      displayName: "Read",
      summary: "src/index.ts",
      icon: fakeIcons.eye,
      isLoadingDetails: false,
      hasDetails: true,
      canOpenDetails: true,
      openFilePath: "/tmp/repo/src/index.ts",
      isPlan: false,
    });
  });

  it("marks running calls without meaningful detail as loading details", () => {
    const presentation = buildToolCallPresentation({
      toolName: "exec_command",
      status: "running",
      error: null,
      detail: {
        type: "unknown",
        input: {},
        output: null,
      },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation).toMatchObject({
      displayName: "Exec command",
      icon: fakeIcons.wrench,
      isLoadingDetails: true,
      hasDetails: false,
      canOpenDetails: true,
      openFilePath: null,
      isPlan: false,
    });
  });

  it("keeps plan calls out of the expandable badge path", () => {
    const presentation = buildToolCallPresentation({
      toolName: "ExitPlanMode",
      status: "completed",
      error: null,
      detail: {
        type: "plan",
        text: "1. Do the thing",
      },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation.isPlan).toBe(true);
    expect(presentation.icon).toBe(fakeIcons.brain);
  });
});

it.each([
  ["message", "Message from QA messenger"],
  ["finished", "QA messenger finished"],
  ["errored", "QA messenger errored"],
  ["permission-required", "QA messenger needs permission"],
  ["closed", "QA messenger closed"],
] as const)("presents %s from structured provenance without a second label", (event, heading) => {
  const presentation = buildToolCallPresentation({
    toolName: "internal_name_should_not_be_visible",
    status: "completed",
    error: null,
    detail: { type: "plain_text", label: "legacy summary", text: "legacy body" },
    agentMessage: {
      event,
      sender: { id: "server::sender", title: "QA messenger" },
      text: "The delivered message.",
    },
    resolveIcon: fakeResolveIcon,
  });
  expect(presentation.displayName).toBe(heading);
  expect(presentation.summary).toBeUndefined();
  expect(presentation.detail).toEqual({
    type: "plain_text",
    icon: "bot",
    text: "From agent: server::sender\n\nThe delivered message.",
  });
});

it("uses an opaque sender ID when no title is available", () => {
  const presentation = buildToolCallPresentation({
    toolName: "agent_message",
    status: "completed",
    error: null,
    agentMessage: { event: "message", sender: { id: "remote::worker" }, text: "Hello" },
    resolveIcon: fakeResolveIcon,
  });
  expect(presentation.displayName).toBe("Message from remote::worker");
});

it("shows a no-match search neutrally while retaining its raw detail", () => {
  const detail: ToolCallDetail = {
    type: "shell",
    command: "rg -n 'a|b' src",
    exitCode: 1,
    output: "",
  };
  const presentation = buildToolCallPresentation({
    toolName: "shell",
    status: "failed",
    error: { message: "Command failed" },
    detail,
    resolveIcon: fakeResolveIcon,
  });
  expect(presentation).toMatchObject({
    status: "completed",
    noMatches: true,
    canOpenDetails: true,
  });
  expect(presentation.errorText).toBeUndefined();
  expect(presentation.detail).toBe(detail);
  expect(detail.exitCode).toBe(1);
});

it("extracts a clean single-line summary preview for thinking rows", () => {
  const presentation = buildToolCallPresentation({
    toolName: "thinking",
    status: "completed",
    error: null,
    detail: {
      type: "unknown",
      input: "**分析冲突**\n\n- 先检查 `eden.proxy.js` 的改动范围",
      output: null,
    },
    resolveIcon: fakeResolveIcon,
  });

  expect(presentation.displayName).toBe("Thinking");
  expect(presentation.summary).toBe("分析冲突 先检查 eden.proxy.js 的改动范围");

  const empty = buildToolCallPresentation({
    toolName: "thinking",
    status: "executing",
    error: null,
    detail: {
      type: "unknown",
      input: "   \n  ",
      output: null,
    },
    resolveIcon: fakeResolveIcon,
  });
  expect(empty.summary).toBeUndefined();
});
