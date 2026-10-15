import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveDaemonVersion } from "./daemon-version.js";
import { resolveLogConfig } from "./logger.js";
import { loadConfig } from "./config.js";
import type { PersistedConfig } from "./persisted-config.js";

const repoRoot = path.resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const loggerModuleUrl = new URL("./logger.ts", import.meta.url).href;

async function runLoggerFixture(source: string): Promise<{ stdout: string; stderr: string }> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "paseo-logger-fixture-"));
  const runnerPath = path.join(tempDir, "runner.mjs");
  await writeFile(
    runnerPath,
    `
      import { createRootLogger } from ${JSON.stringify(loggerModuleUrl)};

      ${source}
    `,
  );

  const child = spawn(process.execPath, ["--import", "tsx", runnerPath], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });

  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  expect(code, stderr).toBe(0);
  return { stdout, stderr };
}

describe("resolveLogConfig", () => {
  const paseoHome = "/tmp/paseo-logger-tests";

  it("defaults to stdout JSON without file logging", () => {
    const result = resolveLogConfig(undefined, { paseoHome });

    expect(result).toEqual({
      level: "info",
      console: {
        level: "info",
        format: "json",
      },
    });
  });

  it("keeps legacy level and format as stdout configuration", () => {
    const result = resolveLogConfig({ level: "warn", format: "pretty" }, { paseoHome });

    expect(result).toEqual({
      level: "warn",
      console: {
        level: "warn",
        format: "pretty",
      },
    });
  });

  it("enables file output only when log.file is present", () => {
    const config: PersistedConfig = {
      log: {
        console: {
          level: "warn",
          format: "json",
        },
        file: {
          level: "debug",
          path: "logs/programmatic.log",
          rotate: {
            maxSize: "25m",
            maxFiles: 5,
          },
        },
      },
    };

    expect(resolveLogConfig(config, { paseoHome })).toEqual({
      level: "debug",
      console: {
        level: "warn",
        format: "json",
      },
      file: {
        level: "debug",
        path: path.resolve(paseoHome, "logs", "programmatic.log"),
      },
    });
  });

  it("defaults file output to info when log.file is present without a level", () => {
    const config: PersistedConfig = {
      log: {
        console: {
          level: "warn",
        },
        file: {
          path: "daemon.log",
        },
      },
    };

    expect(resolveLogConfig(config, { paseoHome })).toEqual({
      level: "info",
      console: {
        level: "warn",
        format: "json",
      },
      file: {
        level: "info",
        path: path.resolve(paseoHome, "daemon.log"),
      },
    });
  });
});

describe("loadConfig logger config", () => {
  it("applies log format env at the config boundary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-logger-config-"));
    const paseoHome = path.join(root, ".paseo");
    await mkdir(paseoHome, { recursive: true });
    await writeFile(
      path.join(paseoHome, "config.json"),
      JSON.stringify({ version: 1, log: { format: "json" } }),
    );

    const config = loadConfig(paseoHome, {
      env: { PASEO_LOG_FORMAT: "pretty" },
    });

    expect(config.log?.format).toBe("pretty");
    expect(resolveLogConfig(config, { paseoHome }).console.format).toBe("pretty");
  });
});

describe("createRootLogger", () => {
  it("redacts nested credentials, raw process output and child bindings without mutating input", async () => {
    const { stdout } = await runLoggerFixture(`
      const logger = createRootLogger();
      const input = {
        headers: { Cookie: "session=cookie-fixture" },
        nested: [{ password: "password-fixture", access_token: "access-fixture" }],
        stderr: "unstructured-private-output",
        stdout: "unstructured-private-code",
        status: 503,
      };
      const before = JSON.stringify(input);
      logger.child({ daemonPublicKeyB64: "pairing-fixture", component: "fixture" }).error(input, "request failed");
      if (JSON.stringify(input) !== before) throw new Error("log input mutated");
      logger.flush();
    `);

    expect(JSON.parse(stdout)).toMatchObject({
      daemonPublicKeyB64: "[REDACTED]",
      component: "fixture",
      headers: { Cookie: "[REDACTED]" },
      nested: [{ password: "[REDACTED]", access_token: "[REDACTED]" }],
      stderr: "[REDACTED]",
      stdout: "[REDACTED]",
      status: 503,
      msg: "request failed",
    });
    expect(stdout).not.toMatch(
      /cookie-fixture|password-fixture|access-fixture|pairing-fixture|unstructured-private/,
    );
  });

  it.each(["json", "pretty"])(
    "redacts formatted messages, errors and pairing URLs in %s output",
    async (format) => {
      const { stdout } = await runLoggerFixture(`
      const logger = createRootLogger({ format: ${JSON.stringify(format)} });
      logger.error({ err: new Error("request failed: https://app.paseo.sh/#offer=pairing-link-fixture") }, "Authorization: %s %s", "Bearer", "bearer-fixture");
      logger.warn("ANTHROPIC_API_KEY=env-fixture token=token-fixture https://api.example/?key=query-fixture ExpoPushToken[device-fixture] sk-ant-test-fixture-long-value");
      logger.info("retry %d after status %d", 2, 503);
      logger.flush();
    `);

      expect(stdout).not.toMatch(
        /pairing-link-fixture|bearer-fixture|env-fixture|token-fixture|query-fixture|device-fixture|sk-ant-test-fixture-long-value/,
      );
      expect(stdout).toContain("request failed");
      expect(stdout).toContain("[REDACTED]");
      expect(stdout).toContain("retry 2 after status 503");
    },
  );

  it("includes the daemon version in child logger entries", async () => {
    const paseoHome = await mkdtemp(path.join(tmpdir(), "paseo-logger-version-"));

    const { stdout } = await runLoggerFixture(`
      const logger = createRootLogger(undefined, { paseoHome: ${JSON.stringify(paseoHome)} });
      logger.child({ name: "fixture" }).info("versioned child logger");
      logger.flush();
    `);

    expect(JSON.parse(stdout)).toMatchObject({
      pid: expect.any(Number),
      hostname: expect.any(String),
      daemonVersion: resolveDaemonVersion(),
      name: "fixture",
      msg: "versioned child logger",
    });
  });

  it("writes JSON to stdout by default and does not initialize file logging", async () => {
    const paseoHome = await mkdtemp(path.join(tmpdir(), "paseo-logger-default-"));
    const missingLogDir = path.join(paseoHome, "logs");

    const { stdout } = await runLoggerFixture(`
      const logger = createRootLogger(undefined, { paseoHome: ${JSON.stringify(paseoHome)} });
      logger.info({ proof: "stdout-default" }, "default logger");
      logger.flush();
    `);

    expect(stdout).toContain('"proof":"stdout-default"');
    expect(stdout).toContain('"msg":"default logger"');
    expect(existsSync(path.join(paseoHome, "daemon.log"))).toBe(false);
    expect(existsSync(missingLogDir)).toBe(false);
  });

  it("writes to an explicit file target without creating rotation files", async () => {
    const paseoHome = await mkdtemp(path.join(tmpdir(), "paseo-logger-file-"));
    const logPath = path.join(paseoHome, "logs", "programmatic.log");

    await runLoggerFixture(`
      const logger = createRootLogger(
        { log: { file: { path: ${JSON.stringify(logPath)} } } },
        { paseoHome: ${JSON.stringify(paseoHome)} },
      );
      logger.info({ proof: "file-explicit" }, "explicit file logger");
      logger.flush();
    `);

    const logText = await readFile(logPath, "utf8");
    const files = await readdir(path.dirname(logPath));

    expect(logText).toContain('"proof":"file-explicit"');
    expect(logText).toContain('"msg":"explicit file logger"');
    expect(files).toEqual(["programmatic.log"]);
  });

  it("can disable file output for supervised workers", async () => {
    const paseoHome = await mkdtemp(path.join(tmpdir(), "paseo-logger-no-worker-file-"));
    const logPath = path.join(paseoHome, "daemon.log");

    const { stdout } = await runLoggerFixture(`
      const logger = createRootLogger(
        { log: { file: { path: ${JSON.stringify(logPath)} } } },
        { paseoHome: ${JSON.stringify(paseoHome)}, file: false },
      );
      logger.info({ proof: "stdout-only" }, "worker logger");
      logger.flush();
    `);

    expect(stdout).toContain('"proof":"stdout-only"');
    expect(stdout).toContain('"msg":"worker logger"');
    expect(existsSync(logPath)).toBe(false);
  });

  it("keeps pretty output available as a format choice", async () => {
    const paseoHome = await mkdtemp(path.join(tmpdir(), "paseo-logger-pretty-"));

    const { stdout } = await runLoggerFixture(`
      const logger = createRootLogger({ level: "info", format: "pretty" }, {
        paseoHome: ${JSON.stringify(paseoHome)},
      });
      logger.info("pretty logger");
      logger.flush();
    `);

    expect(stdout).toContain("pretty logger");
  });
});
