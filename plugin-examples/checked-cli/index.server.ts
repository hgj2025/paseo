import type { PluginServerContext } from "@getpaseo/plugin/server";
import { preferences } from "./shared/settings.js";
import { appendGuidance } from "./server/integration.js";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  const remove = server.before("agent.create", async ({ request }) => {
    const state = await settings.read();
    if (state.status !== "ready" || !state.values.enabled) return request;
    return {
      ...request,
      config: {
        ...request.config,
        systemPrompt: appendGuidance(request.config.systemPrompt, state.values.runnerCommand),
      },
    };
  });
  return () => remove();
}
