/**
 * @vitest-environment jsdom
 */
import React, { useCallback } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentControlTrigger } from "./control";
import { PermissionFeatureControl } from "./desktop-control-slot";

vi.mock("./mode-control", () => ({ AgentModeControl: () => null }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/ui/combobox", () => ({
  Combobox: function TestCombobox({
    open,
    onSelect,
  }: {
    open: boolean;
    onSelect: (id: string) => void;
  }) {
    const ask = useCallback(() => onSelect("ask"), [onSelect]);
    const automatic = useCallback(() => onSelect("automatic"), [onSelect]);
    if (!open) return null;
    return (
      <div>
        <button type="button" onClick={ask}>
          Ask each time
        </button>
        <button type="button" onClick={automatic}>
          Auto approve
        </button>
      </div>
    );
  },
}));

const AUTO_ACCEPT_FEATURE = {
  id: "auto_accept",
  type: "toggle" as const,
  label: "Auto Accept",
  value: true,
};
afterEach(cleanup);

beforeEach(() => vi.stubGlobal("React", React));

function TestIcon() {
  return null;
}

describe("AgentControlTrigger", () => {
  it("forwards interaction handlers to the rendered trigger", () => {
    const onPointerEnter = vi.fn();
    const onFocus = vi.fn();
    const onPress = vi.fn();
    const view = render(
      <AgentControlTrigger
        icon={TestIcon}
        surface="toolbar"
        label="Mode"
        onPress={onPress}
        onPointerEnter={onPointerEnter}
        onFocus={onFocus}
        accessibilityLabel="Select mode"
      />,
    );
    const trigger = view.getByRole("button", { name: "Select mode" });

    fireEvent.pointerEnter(trigger);
    fireEvent.focus(trigger);

    expect(onPointerEnter).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });
});

describe("PermissionFeatureControl", () => {
  it("opens without changing permissions and applies only an explicit menu choice", () => {
    const onSetFeature = vi.fn();
    const view = render(
      <PermissionFeatureControl
        feature={AUTO_ACCEPT_FEATURE}
        disabled={false}
        onSetFeature={onSetFeature}
      />,
    );
    fireEvent.click(
      view.getByRole("button", {
        name: "agentControls.permissions.title: agentControls.permissions.automatic",
      }),
    );
    expect(onSetFeature).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Ask each time" }));
    expect(onSetFeature).toHaveBeenCalledExactlyOnceWith("auto_accept", false);
  });
});
