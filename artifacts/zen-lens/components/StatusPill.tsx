import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { CaptureState } from "@/context/CaptureContext";

interface StatusPillProps {
  state: CaptureState;
  label: string;
}

const STATE_COLORS: Record<CaptureState, string> = {
  idle: "#6B7A99",
  requesting_permission: "#F59E0B",
  ready: "#22C55E",
  capturing: "#FF5A5F",
  paused: "#F59E0B",
};

const STATE_LABELS: Record<CaptureState, string> = {
  idle: "Idle",
  requesting_permission: "Requesting…",
  ready: "Ready",
  capturing: "LIVE",
  paused: "Paused",
};

export function StatusPill({ state, label }: StatusPillProps) {
  const colors = useColors();
  const dotColor = STATE_COLORS[state];
  const isLive = state === "capturing";

  return (
    <View style={[styles.pill, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.dot, { backgroundColor: dotColor }, isLive && styles.dotLive]} />
      <Text style={[styles.stateText, { color: dotColor }]}>
        {STATE_LABELS[state]}
      </Text>
      {label.length > 0 && (
        <>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Text style={[styles.label, { color: colors.mutedForeground }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
    alignSelf: "flex-start",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotLive: {
    shadowColor: "#FF5A5F",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 3,
  },
  stateText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
  },
  divider: {
    width: 1,
    height: 12,
  },
  label: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    maxWidth: 160,
  },
});
