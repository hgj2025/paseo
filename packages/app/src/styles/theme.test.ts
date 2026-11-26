import { PANE_COLOR_NAMES, paneSurfaceColor } from "./pane-colors";
import { parseHexColor } from "@/utils/color";
import { describe, expect, it } from "vitest";
import {
  darkPureBlackTheme,
  darkTheme,
  FONT_SIZE,
  getNextThemePreference,
  lightTheme,
  THEME_OPTIONS,
} from "./theme";

describe("Typography scale", () => {
  it("names 14px as the default interface tier", () => {
    expect(FONT_SIZE).toEqual({
      code: 12,
      content: 15,
      sm: 12,
      base: 14,
      lg: 16,
      xl: 18,
      "2xl": 20,
      "3xl": 22,
      "4xl": 26,
    });
  });
});

describe("Theme catalog", () => {
  it("owns the picker and shortcut order", () => {
    expect(THEME_OPTIONS.map((option) => option.name)).toEqual([
      "light",
      "dark",
      "auto",
      "zinc",
      "midnight",
      "claude",
      "ghostty",
      "pureBlack",
    ]);
    expect(getNextThemePreference("dark")).toBe("auto");
    expect(getNextThemePreference("pureBlack")).toBe("light");
  });
});

describe("Pure black theme", () => {
  it("uses a pure black application and terminal background", () => {
    expect(darkPureBlackTheme.colors.surface0).toBe("#000000");
    expect(darkPureBlackTheme.colors.background).toBe("#000000");
    expect(darkPureBlackTheme.colors.terminal.background).toBe("#000000");
  });

  it("uses Paseo's muted green accent", () => {
    expect(darkPureBlackTheme.colors.accent).toBe("#20744A");
    expect(darkPureBlackTheme.colors.accentBright).toBe("#7ccba0");
  });

  it("steps its sidebar hover and selection off the black sidebar", () => {
    expect(darkPureBlackTheme.colors.surfaceSidebar).toBe("#000000");
    expect(darkPureBlackTheme.colors.surfaceSidebarHover).toBe("#111111");
    expect(darkPureBlackTheme.colors.surfaceSidebarSelected).toBe("#1d1d1d");
  });

  it("keeps ANSI black output readable on its zero-luminance terminal background", () => {
    expect(darkPureBlackTheme.colors.terminal.black).toBe("#595959");
    expect(darkPureBlackTheme.colors.terminal.brightBlack).toBe("#8a8a8a");
  });
});

// Hover and selected are derived from the sidebar color. The values the default themes had when
// they were picked by eye are the reference: derivation lands within a few RGB units of them.
describe("Sidebar interaction surfaces", () => {
  function expectWithin(actual: string, expected: string, units: number) {
    const channels = (hex: string) =>
      [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
    const expectedChannels = channels(expected);
    channels(actual).forEach((channel, index) => {
      expect(Math.abs(channel - expectedChannels[index])).toBeLessThanOrEqual(units);
    });
  }

  it("keeps Light hover and selection where they were", () => {
    expectWithin(lightTheme.colors.surfaceSidebarHover, "#e4e4e7", 3);
    expectWithin(lightTheme.colors.surfaceSidebarSelected, "#d4d4d8", 3);
  });

  it("keeps Dark hover and selection where they were", () => {
    expectWithin(darkTheme.colors.surfaceSidebarHover, "#1e2120", 2);
    expectWithin(darkTheme.colors.surfaceSidebarSelected, "#272a29", 2);
  });
});

describe("Built-in light theme", () => {
  it("preserves its authored aliases and terminal contrast through the semantic builder", () => {
    expect(lightTheme.colors).toMatchObject({
      primary: "#18181b",
      primaryForeground: "#fafafa",
      destructiveForeground: "#ffffff",
      terminal: {
        black: "#1a1a1e",
        brightBlack: "#3f3f46",
      },
    });
  });
});

describe("Pane colors", () => {
  function luminance(hex: string) {
    const channels = parseHexColor(hex)!;
    const linear = channels.map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
    return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  }
  it("keeps body and secondary text readable across every built-in theme", () => {
    for (const option of THEME_OPTIONS) {
      if (!("theme" in option)) continue;
      for (const color of PANE_COLOR_NAMES) {
        for (const header of [false, true]) {
          const background = paneSurfaceColor(option.theme, color, header);
          for (const foreground of [
            option.theme.colors.foreground,
            option.theme.colors.foregroundMuted,
          ]) {
            const a = luminance(foreground),
              b = luminance(background);
            expect(
              (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
              `${option.name}/${color}/${foreground}`,
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });
  it("offers distinct pane backgrounds and preserves Follow theme exactly", () => {
    for (const theme of [lightTheme, darkTheme]) {
      expect(new Set(PANE_COLOR_NAMES.map((color) => paneSurfaceColor(theme, color))).size).toBe(
        PANE_COLOR_NAMES.length,
      );
      expect(paneSurfaceColor(theme, "theme")).toBe(theme.colors.surface0);
    }
  });
});
