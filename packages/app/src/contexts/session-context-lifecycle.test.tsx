// @vitest-environment jsdom
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { SessionProvider } from "./session-context";

const fake = vi.hoisted(() => ({
  connected: true,
  owners: [] as Array<{
    setConnected: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeIsConnected: () => fake.connected,
  getHostRuntimeStore: () => ({
    createViewedTimelineOwner: () => {
      const owner = {
        setActive: vi.fn(),
        setConnected: vi.fn(),
        dispose: vi.fn(),
        replaceOpenTabAgentIds: vi.fn(),
        replaceVisibleAgentIds: vi.fn(),
      };
      fake.owners.push(owner);
      return owner;
    },
  }),
}));
vi.mock("@/stores/workspace-layout-store", () => ({
  observeOpenWorkspaceAgentIds: () => () => {},
}));
vi.mock("@/contexts/voice-context", () => ({
  useVoiceRuntimeOptional: () => null,
  useVoiceAudioEngineOptional: () => null,
}));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({}) }));
vi.mock("@/hooks/use-client-activity", () => ({ useClientActivity: () => {} }));
vi.mock("@/hooks/use-app-visible", () => ({ useAppVisible: () => true }));
vi.mock("@/push-notifications", () => ({ startPushNotifications: () => () => {} }));
vi.mock("@/utils/os-notifications", () => ({ sendOsNotification: vi.fn() }));
const queryClient = {};
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => queryClient }));

function client() {
  return {
    observeEvents: () => ({ subscribe: () => () => {}, release: async () => {} }),
    on: () => () => {},
  } as unknown as DaemonClient;
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  fake.connected = true;
  fake.owners.length = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("connects the new timeline owner when SSH changes to TLS while the host stays online", () => {
  const view = render(
    <SessionProvider serverId="home" client={client()}>
      chat
    </SessionProvider>,
  );
  expect(fake.owners[0]!.setConnected).toHaveBeenLastCalledWith(true);
  view.rerender(
    <SessionProvider serverId="home" client={client()}>
      chat
    </SessionProvider>,
  );
  expect(fake.owners[0]!.dispose).toHaveBeenCalledOnce();
  expect(fake.owners[1]!.setConnected).toHaveBeenLastCalledWith(true);
});
it("updates connectivity without rebuilding the timeline owner", () => {
  const connection = client();
  const view = render(
    <SessionProvider serverId="home" client={connection}>
      chat
    </SessionProvider>,
  );
  fake.connected = false;
  view.rerender(
    <SessionProvider serverId="home" client={connection}>
      chat
    </SessionProvider>,
  );
  expect(fake.owners[0]!.setConnected).toHaveBeenLastCalledWith(false);
  fake.connected = true;
  view.rerender(
    <SessionProvider serverId="home" client={connection}>
      chat
    </SessionProvider>,
  );
  expect(fake.owners).toHaveLength(1);
  expect(fake.owners[0]!.setConnected).toHaveBeenLastCalledWith(true);
});
