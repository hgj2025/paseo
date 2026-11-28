import { expect, it } from "vitest";
import { retainCoordinatorWindowOnClose } from "./coordinator-window.js";
it("keeps only the last Mac runtime alive while explicit Quit and other windows close normally", () => {
  expect(retainCoordinatorWindowOnClose("darwin", false, 1)).toBe(true);
  expect(retainCoordinatorWindowOnClose("darwin", true, 1)).toBe(false);
  expect(retainCoordinatorWindowOnClose("darwin", false, 2)).toBe(false);
  expect(retainCoordinatorWindowOnClose("linux", false, 1)).toBe(false);
});
