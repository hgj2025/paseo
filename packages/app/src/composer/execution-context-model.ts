import type { StreamItem } from "@/types/stream";

export interface ExecutionDirectory {
  path: string;
  edited: boolean;
}

// Only structured paths are evidence. Shell text is arbitrary code, not a path parser.
export function executionCheckoutEvidence(
  cwd: string,
  items: readonly StreamItem[],
): { directories: ExecutionDirectory[]; revision: string } {
  const directories = new Map<string, boolean>();
  const completed: string[] = [];
  if (cwd) directories.set(cwd, false);
  for (const item of items) {
    if (item.kind !== "tool_call" || item.payload.source !== "agent") continue;
    const { detail, status } = item.payload.data;
    if (status !== "running" && ["shell", "edit", "write"].includes(detail.type))
      completed.push(`${item.id}:${status}`);
    if (status === "failed" || status === "canceled") continue;
    let path: string | undefined;
    let edited = false;
    if (detail.type === "shell") path = detail.cwd;
    if (detail.type === "edit" || detail.type === "write") {
      edited = true;
      const file = detail.filePath.replaceAll("\\", "/");
      const absolute = file.startsWith("/") || /^[A-Za-z]:\//.test(file);
      const resolved = absolute ? file : `${cwd.replace(/\/$/, "")}/${file}`;
      path = resolved.slice(0, resolved.lastIndexOf("/")) || "/";
    }
    if (path) directories.set(path, edited || directories.get(path) === true);
  }
  return {
    directories: Array.from(directories, ([path, edited]) => ({ path, edited })),
    revision: completed.join("|"),
  };
}

export function executionDirectories(
  cwd: string,
  items: readonly StreamItem[],
): ExecutionDirectory[] {
  return executionCheckoutEvidence(cwd, items).directories;
}
