import { createContext, useContext, type PropsWithChildren } from "react";
import { View, type ViewProps } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { paneSurfaceColor, type PaneTone, type PaneColorChoice } from "@/styles/pane-colors";

export interface PaneAppearanceContextValue {
  workspaceKey: string;
  paneId: string;
  tone: PaneTone;
  choice: PaneColorChoice;
  locked?: boolean;
}
export const PaneAppearanceContext = createContext<PaneAppearanceContextValue | null>(null);

export function usePaneSurfaceStyle(header = false) {
  const appearance = useContext(PaneAppearanceContext);
  return paneAppearanceStyles.surface(appearance?.tone ?? "theme", header);
}

export function PaneCanvas({ style, ...props }: PropsWithChildren<ViewProps>) {
  const surface = usePaneSurfaceStyle();
  return <View {...props} style={[style, surface]} />;
}

export const paneAppearanceStyles = StyleSheet.create((theme) => ({
  surface: (tone: PaneTone, header: boolean) => ({
    backgroundColor: paneSurfaceColor(theme, tone, header),
  }),
}));
