/** Closing the last Mac window preserves paired connections; explicit Quit and other platforms retain their lifecycle. */
export function retainCoordinatorWindowOnClose(
  platform: string,
  quitting: boolean,
  windowCount: number,
) {
  return platform === "darwin" && !quitting && windowCount === 1;
}
