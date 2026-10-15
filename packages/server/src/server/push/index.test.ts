import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type pino from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createPushNotifications } from "./index.js";
import { PushService } from "./push-service.js";

function createLogger(): pino.Logger {
  const logger = {
    child: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger as unknown as pino.Logger;
}

describe("push notifications", () => {
  const homes: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test.each(["finished", "permission", "terminal"])(
    "sends only a generic reminder and routing identifiers to Expo for %s",
    async (reason) => {
      // Capture the third-party boundary without sending a real phone notification.
      const send = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(Response.json({ data: [{ status: "ok" }] }));
      const service = new PushService(createLogger(), () => {});
      const payload = {
        title: "Private project title",
        body: "Reply or permission details containing secret-fixture",
        data: {
          serverId: "srv-test",
          workspaceId: "wks-test",
          agentId: "agent-test",
          terminalId: "terminal-test",
          reason,
          cwd: "/Users/private/customer-repo",
          extra: { token: "secret-fixture" },
        },
      };

      await service.sendPush(["ExponentPushToken[test-device]"], payload);

      expect(send).toHaveBeenCalledTimes(1);
      const [url, options] = send.mock.calls[0]!;
      expect(url).toBe("https://exp.host/--/api/v2/push/send");
      expect(JSON.parse(String(options?.body))).toEqual([
        {
          to: "ExponentPushToken[test-device]",
          title: "Paseo",
          body: "An update is available. Open Paseo to view it.",
          data: {
            serverId: "srv-test",
            workspaceId: "wks-test",
            agentId: "agent-test",
            terminalId: "terminal-test",
          },
          sound: "default",
        },
      ]);
      // The encrypted in-app notification can still use the original payload.
      expect(payload.body).toContain("secret-fixture");
    },
  );

  test("an offline device stops receiving notifications after 48 hours", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-notifications-"));
    homes.push(home);
    const filePath = path.join(home, "push-tokens.json");
    let now = Date.parse("2026-08-10T00:00:00.000Z");
    const deliveries: string[][] = [];
    const pushNotifications = createPushNotifications({
      logger: createLogger(),
      filePath,
      now: () => now,
      deliver: async (tokens) => deliveries.push(tokens),
    });

    pushNotifications.renew("ExponentPushToken[offline-device]");
    now += 48 * 60 * 60 * 1000;
    await pushNotifications.send({ title: "Agent finished", body: "Done" });

    expect(deliveries).toEqual([]);
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({ subscriptions: [] });
  });

  test("online revocation stops notifications immediately", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-notifications-"));
    homes.push(home);
    const deliveries: string[][] = [];
    const pushNotifications = createPushNotifications({
      logger: createLogger(),
      filePath: path.join(home, "push-tokens.json"),
      now: () => Date.parse("2026-08-10T00:00:00.000Z"),
      deliver: async (tokens) => deliveries.push(tokens),
    });

    pushNotifications.renew("ExponentPushToken[online-device]");
    pushNotifications.revoke("ExponentPushToken[online-device]");
    await pushNotifications.send({ title: "Agent finished", body: "Done" });

    expect(deliveries).toEqual([]);
  });

  test("revokes invalid devices without logging tokens or provider-echoed content", async () => {
    const token = "ExponentPushToken[private-device-fixture]";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        data: [
          {
            status: "error",
            message: token + " private-reply",
            details: { error: "DeviceNotRegistered" },
          },
        ],
      }),
    );
    const logger = createLogger();
    const errors = vi.spyOn(logger, "error");
    const revoke = vi.fn();
    await new PushService(logger, revoke).sendPush([token], {
      title: "Private",
      body: "private-reply",
    });

    expect(revoke).toHaveBeenCalledWith(token);
    expect(errors).toHaveBeenCalledWith("Push delivery failed");
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/private-device-fixture|private-reply/);
  });
});
