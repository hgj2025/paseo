import { identityColor } from "./identity-colors";
import type { Theme } from "./theme";
import { parseHexColor } from "@/utils/color";

// Stable order: existing panes keep their assigned tone when their neighbours change.
export const PANE_COLOR_NAMES = ["blue", "teal", "amber", "violet", "pink", "sky"] as const;
export type PaneColor = (typeof PANE_COLOR_NAMES)[number];
export type PaneColorChoice = PaneColor | "auto" | "theme";
export type PaneTone = PaneColor | "theme";

export function paneSurfaceColor(theme: Theme, tone: PaneTone, header = false): string {
  if (tone === "theme") return theme.colors.surface0;
  return theme.colors.panes[tone][header ? "header" : "surface"];
}

function mixPaneColor(base: string, scheme: "light" | "dark", tone: PaneColor, header: boolean) {
  const rgb = parseHexColor(base);
  const accent = parseHexColor(identityColor(tone));
  if (!rgb || !accent) return base;
  const amount = scheme === "dark" ? 0.22 : 0.045;
  const headerLift = scheme === "dark" ? 0.04 : 0.01;
  const weight = header ? amount + headerLift : amount;
  return `#${rgb
    .map((channel, index) =>
      Math.round((channel * (1 - weight) + accent[index]! * weight) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

// Compute tokens before Unistyles replaces web theme colors with CSS variables.
export function buildPaneColors(base: string, scheme: "light" | "dark") {
  return Object.fromEntries(
    PANE_COLOR_NAMES.map((tone) => [
      tone,
      {
        surface: mixPaneColor(base, scheme, tone, false),
        header: mixPaneColor(base, scheme, tone, true),
      },
    ]),
  ) as Record<PaneColor, { surface: string; header: string }>;
}

export interface PaneAppearance {
  automatic: PaneColor;
  choice: PaneColorChoice;
}

export function assignPaneColors(
  previous: Record<string, PaneAppearance>,
  paneIds: readonly string[],
): Record<string, PaneAppearance> {
  const next: Record<string, PaneAppearance> = {};
  // Count all survivors first, even when a new pane was inserted before them.
  for (const id of paneIds) if (previous[id]) next[id] = previous[id];
  for (const id of paneIds) {
    if (next[id]) continue;
    const counts = PANE_COLOR_NAMES.map(
      (tone) =>
        Object.values(next).filter((pane) => pane.automatic === tone || pane.choice === tone)
          .length,
    );
    const automatic = PANE_COLOR_NAMES[counts.indexOf(Math.min(...counts))]!;
    next[id] = { automatic, choice: "auto" };
  }
  const unchanged =
    Object.keys(previous).length === paneIds.length &&
    paneIds.every((id) => previous[id] === next[id]);
  return unchanged ? previous : next;
}
