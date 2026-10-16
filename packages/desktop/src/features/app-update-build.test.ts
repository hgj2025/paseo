import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { isOfficialDesktopBuild } from "./app-update-build";

it("keeps official updates available for ordinary packages", () => {
  expect(isOfficialDesktopBuild(undefined)).toBe(true);
});

it("excludes a marked local build from official update installation", async () => {
  const resources = await mkdtemp(path.join(os.tmpdir(), "paseo-build-marker-"));
  try {
    expect(isOfficialDesktopBuild(resources)).toBe(true);
    await writeFile(path.join(resources, "local-build.json"), "{}");
    expect(isOfficialDesktopBuild(resources)).toBe(false);
  } finally {
    await rm(resources, { recursive: true, force: true });
  }
});
