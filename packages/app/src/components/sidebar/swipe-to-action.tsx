import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, PanResponder, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";

const ACTION_WIDTH = 88;
export function SwipeToAction({
  children,
  enabled,
  label,
  onAction,
  disabled = false,
  testID,
}: {
  children: ReactNode;
  enabled: boolean;
  label: string;
  onAction: () => void;
  disabled?: boolean;
  testID: string;
}) {
  const offset = useRef(new Animated.Value(0)).current;
  const start = useRef(0);
  const current = useRef(0);
  const [revealed, setRevealed] = useState(false);
  const settle = useCallback(
    (open: boolean) => {
      current.current = open ? -ACTION_WIDTH : 0;
      setRevealed(open);
      Animated.timing(offset, {
        toValue: current.current,
        duration: 160,
        useNativeDriver: !isWeb,
      }).start();
    },
    [offset],
  );
  const action = useCallback(() => {
    settle(false);
    onAction();
  }, [onAction, settle]);
  const gesture = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, state) =>
          enabled &&
          !disabled &&
          Math.abs(state.dx) > 14 &&
          Math.abs(state.dx) > Math.abs(state.dy) * 1.5 &&
          (state.dx < 0 || current.current < 0),
        onPanResponderGrant: () => {
          offset.stopAnimation();
          start.current = current.current;
        },
        onPanResponderMove: (_event, state) =>
          offset.setValue(Math.max(-ACTION_WIDTH, Math.min(0, start.current + state.dx))),
        onPanResponderRelease: (_event, state) =>
          settle(start.current + state.dx < -ACTION_WIDTH / 2),
        onPanResponderTerminate: () => settle(false),
        onPanResponderTerminationRequest: () => false,
      }),
    [disabled, enabled, offset, settle],
  );
  const translateStyle = useMemo(() => ({ transform: [{ translateX: offset }] }), [offset]);
  const accessibilityActions = useMemo(() => [{ name: "delete", label }], [label]);
  const accessibleAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === "delete" && !disabled) action();
    },
    [action, disabled],
  );
  if (!enabled) return children;
  return (
    <View style={styles.container} testID={testID}>
      <View
        style={styles.actionSlot}
        pointerEvents={revealed ? "auto" : "none"}
        accessibilityElementsHidden={!revealed}
        aria-hidden={!revealed}
        importantForAccessibility={revealed ? "auto" : "no-hide-descendants"}
      >
        <Pressable
          onPress={action}
          disabled={disabled || !revealed}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={styles.action}
          testID={`${testID}-action`}
        >
          <Text style={styles.actionLabel}>{label}</Text>
        </Pressable>
      </View>
      <Animated.View
        {...gesture.panHandlers}
        style={translateStyle}
        accessibilityActions={accessibilityActions}
        onAccessibilityAction={accessibleAction}
      >
        <View style={styles.content}>{children}</View>
      </Animated.View>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  container: { overflow: "hidden" },
  content: { backgroundColor: theme.colors.surfaceSidebar },
  actionSlot: { position: "absolute", top: 0, bottom: 0, right: 0, width: ACTION_WIDTH },
  action: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.destructive,
  },
  actionLabel: {
    color: theme.colors.destructiveForeground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
}));
