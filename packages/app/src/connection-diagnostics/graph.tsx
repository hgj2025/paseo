import { useCallback, useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { G, Path, Rect, Text as SvgText, Circle, Defs, Marker } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { Theme } from "@/styles/theme";
import type { Probe } from "./view";
export interface GraphHost {
  serverId: string;
  label: string;
  online: boolean;
  checking: boolean;
  probe: Probe | null;
}
type Status = "ok" | "error" | "unchecked";
const Edge = Path,
  Node = Rect,
  Label = SvgText,
  Dot = Circle;
export interface GraphPalette {
  ink: string;
  muted: string;
  surface: string;
  border: string;
  ok: string;
  error: string;
  unchecked: string;
}
export const graphPalette = (theme: Theme) => ({
  palette: {
    ink: theme.colors.foreground,
    muted: theme.colors.foregroundMuted,
    surface: theme.colors.surface1,
    border: theme.colors.border,
    ok: theme.colors.statusSuccess,
    error: theme.colors.statusDanger,
    unchecked: theme.colors.foregroundMuted,
  },
});
// Only wrap the whole graph. Unistyles' web div cannot be a child of an SVG.
export const ConnectionGraph = withUnistyles(function ConnectionGraph({
  hosts,
  states,
  selected,
  onSelect,
  palette,
}: {
  hosts: { serverId: string; label: string }[];
  states: Record<string, GraphHost>;
  selected: string | null;
  onSelect: (id: string) => void;
  palette?: GraphPalette;
}) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(1000);
  const measure = useCallback(
    (event: LayoutChangeEvent) =>
      setWidth(Math.min(1000, Math.max(320, event.nativeEvent.layout.width))),
    [],
  );
  if (!palette) return null;
  const external = new Map<string, string>();
  for (const state of Object.values(states).filter((entry) => entry.online))
    for (const route of state.probe?.report?.routes ?? [])
      if (!hosts.some((h) => h.serverId === route.hostId)) external.set(route.hostId, route.label);
  const height = Math.max(420, Math.max(hosts.length, external.size) * 108 + 90);
  const appY = height / 2;
  const positions = new Map(hosts.map((h, i) => [h.serverId, { x: 480, y: 90 + i * 108 }]));
  [...external].forEach(([id], i) => positions.set(id, { x: 790, y: 90 + i * 108 }));
  const routeEdges = Object.values(states).flatMap((owner) => {
    const from = positions.get(owner.serverId);
    if (!from || !owner.online) return [];
    return (owner.probe?.report?.routes ?? [])
      .filter((route) => route.transport !== "mac")
      .map((route) => ({
        id: `${owner.serverId}:${route.hostId}`,
        from,
        to: positions.get(route.hostId),
        status: owner.checking ? ("unchecked" as const) : route.status,
      }));
  });
  return (
    <View style={styles.root}>
      <Text style={styles.hint}>{t("connectionDiagnostics.graphHint")}</Text>
      <View onLayout={measure}>
        <Svg
          width="100%"
          height={Math.round((height * width) / 1000)}
          viewBox={`0 0 1000 ${height}`}
          accessibilityLabel={t("connectionDiagnostics.graphTitle")}
        >
          <Defs>
            <Marker
              id="connection-arrow"
              markerWidth={8}
              markerHeight={8}
              refX={7}
              refY={4}
              orient="auto"
            >
              <Path d="M 0 1 L 7 4 L 0 7" fill="none" stroke="context-stroke" strokeWidth={1.5} />
            </Marker>
          </Defs>
          <Label x={45} y={30} fontSize={13} fill={palette.muted}>
            {t("connectionDiagnostics.coordinator")}
          </Label>
          <Label x={480} y={30} fontSize={13} fill={palette.muted}>
            {t("connectionDiagnostics.pairedDaemons")}
          </Label>
          <Label x={790} y={30} fontSize={13} fill={palette.muted}>
            {t("connectionDiagnostics.directTargets")}
          </Label>
          {hosts.map((host) => {
            const to = positions.get(host.serverId)!;
            const state = states[host.serverId];
            let status: Status = "unchecked";
            if (state && !state.online) status = "error";
            else if (state?.probe && !state.checking) status = state.probe.error ? "error" : "ok";
            return (
              <G key={host.serverId}>
                <Edge
                  d={`M 225 ${appY} C 345 ${appY}, 345 ${to.y}, 480 ${to.y}`}
                  fill="none"
                  strokeWidth={2}
                  markerEnd="url(#connection-arrow)"
                  strokeDasharray={status === "error" ? "6 5" : undefined}
                  stroke={palette[status]}
                />
                <Label x={400} y={to.y - 10} textAnchor="middle" fontSize={11} fill={palette.muted}>
                  {state?.probe?.latencyMs != null
                    ? `${state.probe.latencyMs} ms`
                    : t(`connectionDiagnostics.status.${status}`)}
                </Label>
              </G>
            );
          })}
          {routeEdges.map(
            (edge) =>
              edge.to && (
                <Edge
                  key={edge.id}
                  d={`M ${edge.from.x + 170} ${edge.from.y} C ${edge.from.x + 230} ${edge.from.y}, ${edge.to.x - 60} ${edge.to.y}, ${edge.to.x} ${edge.to.y}`}
                  fill="none"
                  strokeWidth={2}
                  markerEnd="url(#connection-arrow)"
                  strokeDasharray={edge.status === "error" ? "6 5" : undefined}
                  stroke={palette[edge.status]}
                />
              ),
          )}
          {Object.values(states)
            .filter(
              (state) =>
                state.online && state.probe?.report?.routes.some((r) => r.transport === "mac"),
            )
            .map((state) => {
              const from = positions.get(state.serverId)!;
              return (
                <G key={`mac:${state.serverId}`}>
                  <Edge
                    d={`M ${from.x} ${from.y + 20} C 260 ${from.y + 60}, 260 ${appY + 60}, 225 ${appY + 20}`}
                    fill="none"
                    strokeWidth={2}
                    markerEnd="url(#connection-arrow)"
                    strokeDasharray="3 5"
                    stroke={palette.unchecked}
                  />
                  <Label x={275} y={from.y + 53} fontSize={11} fill={palette.muted}>
                    {t("connectionDiagnostics.requestViaMac")}
                  </Label>
                </G>
              );
            })}
          <Node
            x={35}
            y={appY - 35}
            width={190}
            height={70}
            rx={12}
            strokeWidth={1.5}
            fill={palette.surface}
            stroke={palette.border}
          />
          <Label
            x={130}
            y={appY - 3}
            textAnchor="middle"
            fontSize={16}
            fontWeight="600"
            fill={palette.ink}
          >
            {t("connectionDiagnostics.macApp")}
          </Label>
          <Label x={130} y={appY + 19} textAnchor="middle" fontSize={11} fill={palette.muted}>
            {t("connectionDiagnostics.coordinator")}
          </Label>
          {[...hosts, ...[...external].map(([serverId, label]) => ({ serverId, label }))].map(
            (host) => {
              const pos = positions.get(host.serverId)!;
              const state = states[host.serverId];
              const route = Object.values(states)
                .filter((entry) => entry.online && !entry.checking)
                .flatMap((s) => s.probe?.report?.routes ?? [])
                .find((r) => r.hostId === host.serverId);
              let status: Status = route?.status ?? "unchecked";
              if (state) {
                status = "unchecked";
                if (!state.online || state.probe?.error) status = "error";
                else if (state.probe && !state.checking) status = "ok";
              }
              const owner = routeOwner(states, host.serverId);
              return (
                <GraphNode
                  key={host.serverId}
                  palette={palette}
                  id={host.serverId}
                  label={host.label}
                  position={pos}
                  status={status}
                  selected={selected === host.serverId}
                  selectId={state ? host.serverId : (owner?.serverId ?? host.serverId)}
                  onSelect={onSelect}
                />
              );
            },
          )}
        </Svg>
      </View>
      <View style={styles.buttons}>
        {hosts.map((host) => (
          <SelectHost
            key={host.serverId}
            host={host}
            selected={host.serverId === selected}
            onSelect={onSelect}
          />
        ))}
      </View>
    </View>
  );
});
function GraphNode({
  id,
  label,
  position: pos,
  palette,
  status,
  selected,
  selectId,
  onSelect,
}: {
  id: string;
  label: string;
  position: { x: number; y: number };
  palette: GraphPalette;
  status: Status;
  selected: boolean;
  selectId: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const select = useCallback(() => onSelect(selectId), [onSelect, selectId]);
  return (
    <G onPress={select} accessibilityLabel={`${label} daemon`} testID={`connection-node-${id}`}>
      <Node
        x={pos.x}
        y={pos.y - 30}
        width={170}
        height={60}
        rx={10}
        strokeWidth={selected ? 2.5 : 1}
        fill={palette.surface}
        stroke={palette.border}
      />
      <Dot cx={pos.x + 18} cy={pos.y} r={4} fill={palette[status]} />
      <Label x={pos.x + 34} y={pos.y - 2} fontSize={15} fontWeight="500" fill={palette.ink}>
        {label.slice(0, 18)}
      </Label>
      <Label
        x={pos.x + 34}
        y={pos.y + 17}
        fontSize={11}
        fill={palette.muted}
      >{`daemon · ${t(`connectionDiagnostics.status.${status}`)}`}</Label>
    </G>
  );
}
function SelectHost({
  host,
  selected,
  onSelect,
}: {
  host: { serverId: string; label: string };
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const select = useCallback(() => onSelect(host.serverId), [host.serverId, onSelect]);
  return (
    <Button size="sm" variant={selected ? "secondary" : "ghost"} onPress={select}>
      {host.label}
    </Button>
  );
}
const styles = StyleSheet.create((theme) => ({
  root: { gap: theme.spacing[3], padding: theme.spacing[4] },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));

function routeOwner(states: Record<string, GraphHost>, id: string) {
  for (const owner of Object.values(states))
    for (const route of owner.probe?.report?.routes ?? []) if (route.hostId === id) return owner;
  return undefined;
}
