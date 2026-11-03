import { describe, expect, it } from "vitest";
import {
  COMPOSER_TOOLBAR_GEOMETRY,
  resolveComposerControlDensity,
  resolveComposerControlPresentation,
  resolveComposerControlSlotWidth,
  resolveComposerToolbarGlyphSize,
  type ComposerControlPresence,
} from "./layout";

const controls: ComposerControlPresence = {
  hasModel: true,
  hasThinking: true,
  hasMode: true,
  features: [{ type: "toggle" }],
  fontScale: 1,
};

describe("composer control layout", () => {
  it("keeps labels together and secondary features in one menu", () => {
    for (const density of ["full", "condensed"] as const) {
      expect(resolveComposerControlPresentation(density)).toMatchObject({
        showThinkingLabel: true,
        showModeLabel: true,
        aggregateFeatures: true,
      });
    }
    expect(resolveComposerControlPresentation("tight")).toMatchObject({
      showThinkingLabel: false,
      showModeLabel: false,
      aggregateFeatures: true,
    });
  });

  it("uses the same density for different providers and missing capabilities", () => {
    const other: ComposerControlPresence = {
      ...controls,
      hasThinking: false,
      hasMode: false,
      features: [{ type: "select", label: "A long localized feature name" }, { type: "toggle" }],
    };
    for (const width of [240, 420, 600]) {
      const input = { availableWidth: width, currentDensity: "full" as const };
      expect(resolveComposerControlDensity({ ...input, controls: other })).toBe(
        resolveComposerControlDensity({ ...input, controls }),
      );
    }
  });

  it("uses local available width with hysteresis around slot boundaries", () => {
    const resolve = (width: number, currentDensity: "full" | "condensed" | "tight") =>
      resolveComposerControlDensity({ availableWidth: width, currentDensity, controls });
    expect(resolve(540, "full")).toBe("full");
    expect(resolve(480, "full")).toBe("condensed");
    expect(resolve(390, "condensed")).toBe("condensed");
    expect(resolve(380, "condensed")).toBe("tight");
    expect(resolve(400, "tight")).toBe("tight");
    expect(resolve(420, "tight")).toBe("condensed");
  });

  it("reserves aligned slots while scaling with interface text", () => {
    expect(resolveComposerControlSlotWidth("thinking", "full", 1.5)).toBeGreaterThan(
      resolveComposerControlSlotWidth("thinking", "full"),
    );
    const input = { availableWidth: 540, currentDensity: "full" as const };
    expect(resolveComposerControlDensity({ ...input, controls })).toBe("full");
    expect(
      resolveComposerControlDensity({ ...input, controls: { ...controls, fontScale: 1.25 } }),
    ).toBe("condensed");
    for (const role of ["model", "thinking", "mode"] as const) {
      expect(resolveComposerControlSlotWidth(role, "full")).toBeGreaterThanOrEqual(
        resolveComposerControlSlotWidth(role, "condensed"),
      );
    }
  });

  it("gives every toolbar control one shell and one platform glyph envelope", () => {
    expect(COMPOSER_TOOLBAR_GEOMETRY.controlSize).toBe(28);
    expect(resolveComposerToolbarGlyphSize("web")).toBe(16);
    expect(resolveComposerToolbarGlyphSize("native")).toBe(20);
  });
});
