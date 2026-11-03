import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { transform } from "esbuild";

let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("closes the persistent worker when its daemon disconnects so the owner can reconnect", async () => {
  directory = await mkdtemp(join(tmpdir(), "paseo-worker-disconnect-"));
  const client = join(directory, "client.mjs");
  await writeFile(
    client,
    `export async function connectToDaemon() {
    return {
      subscribeConnectionStatus(listener) {
        listener({status:'connected'});
        const timer = setTimeout(() => listener({status:'disconnected'}), 80);
        return () => clearTimeout(timer);
      },
      getLastServerInfoMessage() { return {serverId:'test-host'}; },
      async close() {},
    };
  }`,
  );
  const source = await readFile(new URL("./remote-agent-worker.ts", import.meta.url), "utf8");
  const compiled = await transform(source, { loader: "ts", target: "es2022", format: "esm" });
  const worker = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      compiled.code + "\nremoteAgentWorkerMain().catch(() => process.exit(75));",
      pathToFileURL(client).href,
      directory,
    ],
    { stdio: "pipe" },
  );
  let output = "";
  worker.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  const timeout = setTimeout(() => worker.kill("SIGKILL"), 3000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      worker.once("exit", resolve);
      worker.once("error", reject);
    });
    expect(output).toContain('"event":"ready"');
    expect(code).not.toBeNull();
    expect([0, 75]).toContain(code);
  } finally {
    clearTimeout(timeout);
    worker.stdin.destroy();
  }
});
