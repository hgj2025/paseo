import { describe, expect, test } from "vitest";

import {
  canAutoCreateTeamDraft,
  shouldAllowEmptyDraftText,
  validateDraftSubmission,
} from "./workspace-tab-core";

const baseComposerState = {
  providerDefinitions: [{ id: "codewhale" }],
  selectedProvider: "codewhale",
  isModelLoading: false,
  effectiveModelId: "",
  availableModels: [],
};

function validate(overrides = {}) {
  return validateDraftSubmission({
    text: "hello",
    allowsEmptyAutoSubmit: false,
    composerState: baseComposerState,
    autoSubmitConfig: null,
    workspaceDirectory: "/tmp/project",
    isConnected: true,
    ...overrides,
  });
}

describe("workspace draft agent model validation", () => {
  test("reports an offline host before an absent catalog or pending model defaults", () => {
    expect(
      validate({
        isConnected: false,
        composerState: {
          ...baseComposerState,
          providerDefinitions: [],
          selectedProvider: null,
          isModelLoading: true,
        },
      }),
    ).toBe("Host is not connected");
  });

  test("allows a ready provider with no models to submit without a selected model", () => {
    expect(validate({})).toBeNull();
  });

  test("keeps waiting while model defaults are loading", () => {
    expect(
      validate({
        composerState: {
          ...baseComposerState,
          isModelLoading: true,
        },
      }),
    ).toBe("Model defaults are still loading");
  });

  test("still requires a selected model when the provider exposes models", () => {
    expect(
      validate({
        composerState: {
          ...baseComposerState,
          availableModels: [{ id: "deepseek/deepseek-v4-pro" }],
        },
      }),
    ).toBe("No model is available for the selected provider");
  });
});

describe("workspace draft empty text readiness", () => {
  test("allows attachment-only retries after a fork draft create fails", () => {
    expect(
      shouldAllowEmptyDraftText({
        allowsEmptyAutoSubmit: false,
        attachments: [{ kind: "chat_history" }],
      }),
    ).toBe(true);
  });

  test("still rejects empty drafts with no auto-submit and no attachments", () => {
    expect(
      shouldAllowEmptyDraftText({
        allowsEmptyAutoSubmit: false,
        attachments: [],
      }),
    ).toBe(false);
  });
});

describe("team draft host readiness", () => {
  test("does not create with the old host's provider while resolving devbox", () => {
    expect(
      canAutoCreateTeamDraft({
        hydrated: true,
        loading: false,
        provider: "opencode",
        providers: [{ id: "claude" }],
      }),
    ).toBe(false);
    expect(
      canAutoCreateTeamDraft({
        hydrated: true,
        loading: true,
        provider: "claude",
        providers: [{ id: "claude" }],
      }),
    ).toBe(false);
    expect(
      canAutoCreateTeamDraft({
        hydrated: false,
        loading: false,
        provider: "claude",
        providers: [{ id: "claude" }],
      }),
    ).toBe(false);
    expect(
      canAutoCreateTeamDraft({
        hydrated: true,
        loading: false,
        provider: "claude",
        providers: [{ id: "claude" }],
      }),
    ).toBe(true);
  });
});
