import { AgentModeControl, type AgentModeControlValue } from "./mode-control";
import { forwardRef, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { View, type ViewProps } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ShieldCheck } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { AgentFeature } from "@getpaseo/protocol/agent-types";
import { Combobox } from "@/components/ui/combobox";
import { AgentControlTrigger } from "./control";
import { useComposerControlLayout } from "./layout-context";
import { resolveComposerControlSlotWidth, type ComposerControlSlot } from "./layout";

export const DesktopControlSlot = forwardRef<
  View,
  Omit<ViewProps, "role"> & { role: ComposerControlSlot; children?: ReactNode }
>(function DesktopControlSlot({ role, children, ...viewProps }, ref) {
  const { density, fontScale } = useComposerControlLayout();
  const style = useMemo(
    () => [styles.slot, { maxWidth: resolveComposerControlSlotWidth(role, density, fontScale) }],
    [role, density, fontScale],
  );
  if (!children) return null;
  return (
    <View {...viewProps} ref={ref} style={style} testID={`composer-slot-${role}`}>
      {children}
    </View>
  );
});

export function PermissionFeatureControl({
  feature,
  disabled,
  onSetFeature,
  onClose,
}: {
  feature: Extract<AgentFeature, { type: "toggle" }>;
  disabled: boolean;
  onSetFeature?: (id: string, value: unknown) => void;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const { presentation } = useComposerControlLayout();
  const anchor = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const options = useMemo(
    () => [
      { id: "ask", label: t("agentControls.permissions.ask") },
      { id: "automatic", label: t("agentControls.permissions.automatic") },
    ],
    [t],
  );
  const value = feature.value ? "automatic" : "ask";
  const label = options.find((option) => option.id === value)!.label;
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const select = useCallback(
    (id: string) => {
      onSetFeature?.(feature.id, id === "automatic");
      setOpen(false);
      onClose?.();
    },
    [feature.id, onSetFeature, onClose],
  );
  return (
    <>
      <AgentControlTrigger
        ref={anchor}
        icon={ShieldCheck}
        surface="toolbar"
        label={t("agentControls.permissions.title")}
        value={label}
        showToolbarLabel={presentation.showModeLabel}
        showCaret={presentation.showCarets}
        open={open}
        disabled={disabled || !onSetFeature}
        onPress={toggle}
        accessibilityLabel={`${t("agentControls.permissions.title")}: ${label}`}
        testID="agent-permission-selector"
      />
      <Combobox
        options={options}
        value={value}
        onSelect={select}
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchor}
        desktopPlacement="top-start"
        desktopMinWidth={200}
        title={t("agentControls.permissions.title")}
      />
    </>
  );
}

const styles = StyleSheet.create({
  slot: {
    height: 28,
    minWidth: 0,
    flexShrink: 1,
    alignItems: "flex-start",
    justifyContent: "center",
  },
});

export function DesktopPermissionControl({
  modeControl,
  feature,
  disabled,
  onSetFeature,
  onClose,
}: {
  modeControl?: AgentModeControlValue | null;
  feature?: AgentFeature;
  disabled: boolean;
  onSetFeature?: (id: string, value: unknown) => void;
  onClose?: () => void;
}) {
  let control: ReactNode = null;
  if (modeControl) control = <AgentModeControl {...modeControl} onClose={onClose} />;
  else if (feature?.type === "toggle")
    control = (
      <PermissionFeatureControl
        feature={feature}
        disabled={disabled}
        onSetFeature={onSetFeature}
        onClose={onClose}
      />
    );
  return <DesktopControlSlot role="mode">{control}</DesktopControlSlot>;
}
