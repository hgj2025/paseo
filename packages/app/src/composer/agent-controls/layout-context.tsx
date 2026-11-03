import { createContext, useContext, type ReactNode } from "react";
import type {
  ComposerControlDensity,
  ComposerControlPresentation,
} from "@/composer/agent-controls/layout";

interface ComposerControlLayoutValue {
  glyphSize: number;
  density: ComposerControlDensity;
  fontScale: number;
  presentation: ComposerControlPresentation;
}

const DEFAULT_LAYOUT: ComposerControlLayoutValue = {
  glyphSize: 16,
  density: "full",
  fontScale: 1,
  presentation: {
    showCarets: true,
    showThinkingLabel: true,
    showModeLabel: true,
    aggregateFeatures: true,
  },
};

const ComposerControlLayoutContext = createContext(DEFAULT_LAYOUT);

export function ComposerControlLayoutProvider({
  value,
  children,
}: {
  value: ComposerControlLayoutValue;
  children: ReactNode;
}) {
  return (
    <ComposerControlLayoutContext.Provider value={value}>
      {children}
    </ComposerControlLayoutContext.Provider>
  );
}

export function useComposerControlLayout(): ComposerControlLayoutValue {
  return useContext(ComposerControlLayoutContext);
}
