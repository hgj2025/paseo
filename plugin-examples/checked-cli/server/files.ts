import { open } from "node:fs/promises";
/** Bounded even when a file grows between stat and read. */
export async function readBounded(path: string, limit: number): Promise<string> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(limit + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await file.read(buffer, used, buffer.length - used, null);
      if (bytesRead === 0) break;
      used += bytesRead;
    }
    if (used > limit) throw new Error("File exceeds input limit.");
    return buffer.subarray(0, used).toString("utf8");
  } finally {
    await file.close();
  }
}
