import { existsSync } from "node:fs";
import path from "node:path";

/** A locally assembled build must not be replaced by an upstream release on quit. */
export function isOfficialDesktopBuild(resourcesPath: string | undefined): boolean {
  return !resourcesPath || !existsSync(path.join(resourcesPath, "local-build.json"));
}
