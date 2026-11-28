import type { PluginServerContext } from "@getpaseo/plugin/server";
import { runAcpProvider } from "@getpaseo/plugin/server/acp";
import type {
  ProviderRegistration,
  ProviderConnection,
  ProviderEvent,
} from "@getpaseo/plugin/server/provider";
import { ProviderEventSchema } from "@getpaseo/plugin/server/provider";
import { z } from "zod";
import { createHarnessStream } from "./server/connection.js";

export function createHarnessProvider(): ProviderRegistration {
  return {
    id: "deepseek-harness",
    label: "DeepSeek Harness",
    description: "DeepSeek Harness sessions, native approvals and v4 history",
    icon: "icon.svg",
    command: [process.env.PASEO_DSH_COMMAND || "dsh", "--profile", "acp"],
    async connect(request) {
      const connection = await runAcpProvider({
        id: "deepseek-harness",
        label: "DeepSeek Harness",
        connector: () => createHarnessStream(request.launch),
        transformers: [
          {
            notification(notification) {
              if (notification.method !== "_paseo/harness_history") return null;
              const payload = z.object({ item: z.unknown() }).parse(notification.params);
              const event = ProviderEventSchema.parse({
                type: "timeline.item",
                sessionId: "history",
                item: payload.item,
              });
              if (event.type !== "timeline.item") throw new Error("Invalid Harness history event");
              return { type: "timeline", item: event.item };
            },
          },
        ],
      }).connect(request);
      return withDeferredCatalog(connection);
    },
  };
}
export default function contribute(server: PluginServerContext) {
  console.info("DeepSeek Harness provider runtime", process.version);
  server.registerProvider(createHarnessProvider());
  return () => {};
}

function withDeferredCatalog(connection: ProviderConnection): ProviderConnection {
  const listeners = new Set<(event: ProviderEvent) => void>();
  return {
    version: connection.version,
    capabilities: connection.capabilities,
    async send(input) {
      if (input.type !== "catalog") return connection.send(input);
      // Native model/config options arrive when a real session opens. The generic ACP
      // catalog probe would create a durable, empty Harness session for every workspace.
      const event: ProviderEvent = {
        type: "catalog",
        requestId: input.requestId,
        catalog: { models: [], modes: [], thinkingOptions: [] },
      };
      for (const listener of listeners) listener(event);
    },
    onEvent(listener) {
      listeners.add(listener);
      const dispose = connection.onEvent(listener);
      return () => {
        listeners.delete(listener);
        dispose();
      };
    },
    async close() {
      listeners.clear();
      await connection.close();
    },
  };
}
