export type ComposerControlDensity = "full" | "condensed" | "tight";

export interface ComposerControlPresence {
  hasModel: boolean;
  hasThinking: boolean;
  hasMode: boolean;
  features: readonly ComposerFeatureControlPresence[];
  fontScale: number;
}

export type ComposerFeatureControlPresence = { type: "toggle" } | { type: "select"; label: string };

export interface ComposerControlPresentation {
  showCarets: boolean;
  showThinkingLabel: boolean;
  showModeLabel: boolean;
  aggregateFeatures: boolean;
}

export const COMPOSER_TOOLBAR_GEOMETRY = {
  controlSize: 28,
  controlGap: 4,
  iconLabelGap: 4,
  labelPadding: 8,
  caretSize: 14,
} as const;

const DENSITY_HYSTERESIS = 12;

function normalizedFontScale(fontScale: number): number {
  return Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
}

export type ComposerControlSlot = "model" | "thinking" | "mode";

const SLOT_WIDTHS = {
  full: { model: 176, thinking: 100, mode: 196 },
  condensed: { model: 144, thinking: 88, mode: 128 },
  tight: { model: 104, thinking: 28, mode: 28 },
} as const;

export function resolveComposerControlSlotWidth(
  role: ComposerControlSlot,
  density: ComposerControlDensity,
  fontScale = 1,
): number {
  return Math.round(SLOT_WIDTHS[density][role] * normalizedFontScale(fontScale));
}

function resolveDensityFloor(
  density: ComposerControlDensity,
  controls: ComposerControlPresence,
): number {
  // Reserve the same core slots and one feature-menu slot for every provider.
  // Provider-specific features never change a neighboring control's position.
  return (
    Object.values(SLOT_WIDTHS[density]).reduce((sum, width) => sum + width, 0) *
      normalizedFontScale(controls.fontScale) +
    COMPOSER_TOOLBAR_GEOMETRY.controlSize +
    COMPOSER_TOOLBAR_GEOMETRY.controlGap * 3
  );
}

export function resolveComposerControlDensity(input: {
  availableWidth: number;
  currentDensity: ComposerControlDensity;
  controls: ComposerControlPresence;
}): ComposerControlDensity {
  const fullFloor = resolveDensityFloor("full", input.controls);
  const condensedFloor = resolveDensityFloor("condensed", input.controls);

  if (input.currentDensity === "full") {
    if (input.availableWidth >= fullFloor - DENSITY_HYSTERESIS) return "full";
    return input.availableWidth >= condensedFloor ? "condensed" : "tight";
  }

  if (input.currentDensity === "condensed") {
    if (input.availableWidth >= fullFloor + DENSITY_HYSTERESIS) return "full";
    if (input.availableWidth < condensedFloor - DENSITY_HYSTERESIS) return "tight";
    return "condensed";
  }

  if (input.availableWidth >= fullFloor + DENSITY_HYSTERESIS) return "full";
  if (input.availableWidth >= condensedFloor + DENSITY_HYSTERESIS) return "condensed";
  return "tight";
}

export function resolveComposerControlPresentation(
  density: ComposerControlDensity,
): ComposerControlPresentation {
  if (density === "full") {
    return {
      showCarets: true,
      showThinkingLabel: true,
      showModeLabel: true,
      aggregateFeatures: true,
    };
  }
  if (density === "condensed") {
    return {
      showCarets: false,
      showThinkingLabel: true,
      showModeLabel: true,
      aggregateFeatures: true,
    };
  }
  return {
    showCarets: false,
    showThinkingLabel: false,
    showModeLabel: false,
    aggregateFeatures: true,
  };
}

export function resolveComposerToolbarGlyphSize(platform: "web" | "native"): number {
  return platform === "native" ? 20 : 16;
}
