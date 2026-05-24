import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { PermissionStatus } from "@/context/CaptureContext";

interface PermissionRowProps {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  description: string;
  status: PermissionStatus | "loading";
}

export function PermissionRow({
  icon,
  title,
  description,
  status,
}: PermissionRowProps) {
  const colors = useColors();

  const statusColor =
    status === "granted"
      ? colors.success
      : status === "denied"
        ? colors.destructive
        : status === "loading"
          ? colors.warning
          : colors.mutedForeground;

  const statusLabel =
    status === "granted"
      ? "Granted"
      : status === "denied"
        ? "Denied"
        : status === "loading"
          ? "Requesting…"
          : "Required";

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.card,
          borderColor:
            status === "granted" ? `${colors.success}33` : colors.border,
        },
      ]}
    >
      <View
        style={[styles.iconWrap, { backgroundColor: `${colors.primary}18` }]}
      >
        <Feather name={icon} size={20} color={colors.primary} />
      </View>
      <View style={styles.textBlock}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {title}
        </Text>
        <Text
          style={[styles.description, { color: colors.mutedForeground }]}
          numberOfLines={2}
        >
          {description}
        </Text>
      </View>
      <View style={styles.statusWrap}>
        {status === "loading" ? (
          <ActivityIndicator size="small" color={colors.warning} />
        ) : (
          <View
            style={[styles.statusDot, { backgroundColor: statusColor }]}
          />
        )}
        <Text style={[styles.statusLabel, { color: statusColor }]}>
          {statusLabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  description: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
  },
  statusWrap: {
    alignItems: "center",
    gap: 4,
    minWidth: 52,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
    textAlign: "center",
  },
});
