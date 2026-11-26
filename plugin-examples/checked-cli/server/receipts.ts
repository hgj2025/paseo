import { open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Capture } from "../shared/contracts.js";
import { captureSchema } from "../shared/contracts.js";
import { readBounded } from "./files.js";
const LIMIT = 64 * 1024 * 1024;
export async function readReceipt(path: string): Promise<Capture> {
  return captureSchema.parse(JSON.parse(await readBounded(path, LIMIT)));
}
/** Explicit opt-in raw capture, private permissions, no argv/env persistence. */
export async function reserveReceipt(path: string): Promise<(capture: Capture) => Promise<void>> {
  const runId = randomUUID();
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify({ version: 1, pending: true, runId }));
  } finally {
    await handle.close();
  }
  return async (capture) => {
    const current = JSON.parse(await readBounded(path, 4096)) as { runId?: string };
    if (current.runId !== runId) throw new Error("Receipt reservation changed.");
    const temporary = path + "." + runId + ".tmp";
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(capture));
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await rename(temporary, path);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  };
}
