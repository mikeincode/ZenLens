import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PermissionRow } from "@/components/PermissionRow";
import { useCapture } from "@/context/CaptureContext";
import { useColors } from "@/hooks/useColors";

export default function SetupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    mediaProjectionPermission,
    overlayPermission,
    requestPermissions,
    state,
    isSimulated,
  } = useCapture();
  const [loading, setLoading] = useState(false);

  const isRequesting = state === "requesting_permission" || loading;
  const allGranted = mediaProjectionPermission === "granted";

  async function handleRequestPermissions() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    await requestPermissions();
    setLoading(false);
  }

  async function handleContinue() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.replace("/crop");
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop:
              insets.top +
              (Platform.OS === "web" ? 67 : 0) +
              16,
            paddingBottom:
              insets.bottom +
              (Platform.OS === "web" ? 34 : 0) +
              32,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Back */}
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.backBtn,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Feather name="arrow-left" size={18} color={colors.mutedForeground} />
          <Text style={[styles.backText, { color: colors.mutedForeground }]}>
            Back
          </Text>
        </Pressable>

        {/* Title */}
        <View style={styles.titleBlock}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: `${colors.primary}18` },
            ]}
          >
            <Feather name="shield" size={28} color={colors.primary} />
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Permissions Required
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            ZenLens needs these permissions to capture and scan screen content.
            No data ever leaves your device.
          </Text>
        </View>

        {isSimulated && (
          <View
            style={[
              styles.simBanner,
              {
                backgroundColor: `${colors.warning}18`,
                borderColor: `${colors.warning}33`,
              },
            ]}
          >
            <Feather name="info" size={14} color={colors.warning} />
            <Text style={[styles.simText, { color: colors.warning }]}>
              Running in simulation mode — permissions are mocked. A custom
              Android build with native modules is required for real screen
              capture.
            </Text>
          </View>
        )}

        {/* Permissions */}
        <View style={styles.permissionsBlock}>
          <PermissionRow
            icon="radio"
            title="Screen Recording"
            description="Android MediaProjection API — captures only the crop region. Required for OCR."
            status={
              isRequesting
                ? "loading"
                : mediaProjectionPermission === "unknown"
                  ? "unknown"
                  : mediaProjectionPermission
            }
          />
          <PermissionRow
            icon="layers"
            title="Display Over Apps"
            description="SYSTEM_ALERT_WINDOW — shows the floating capture control while you navigate other apps."
            status={
              isRequesting
                ? "loading"
                : overlayPermission === "unknown"
                  ? "unknown"
                  : overlayPermission
            }
          />
          <PermissionRow
            icon="bell"
            title="Foreground Service"
            description="Persistent notification while capture is running. Required by Android for background screen capture."
            status={allGranted ? "granted" : mediaProjectionPermission === "unknown" ? "unknown" : "granted"}
          />
        </View>

        {/* Note for non-simulated real device */}
        {!isSimulated && (
          <View
            style={[
              styles.note,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Feather
              name="info"
              size={14}
              color={colors.mutedForeground}
            />
            <Text style={[styles.noteText, { color: colors.mutedForeground }]}>
              Android will show a system permission dialog. Tap "Start now" to
              allow screen recording. You can revoke this permission at any time
              in Android Settings → Apps → ZenLens → Permissions.
            </Text>
          </View>
        )}

        {/* Action */}
        {!allGranted ? (
          <Pressable
            onPress={handleRequestPermissions}
            disabled={isRequesting}
            style={({ pressed }) => [
              styles.actionBtn,
              {
                backgroundColor: colors.primary,
                opacity: isRequesting || pressed ? 0.75 : 1,
              },
            ]}
          >
            {isRequesting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Feather name="unlock" size={18} color="#fff" />
            )}
            <Text style={styles.actionBtnText}>
              {isRequesting ? "Requesting…" : "Grant Permissions"}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleContinue}
            style={({ pressed }) => [
              styles.actionBtn,
              {
                backgroundColor: colors.accent,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Feather name="crop" size={18} color="#000" />
            <Text style={[styles.actionBtnText, { color: "#000" }]}>
              Set Up Crop Area
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: {
    paddingHorizontal: 20,
    gap: 16,
    flexGrow: 1,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  backText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  titleBlock: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  simBanner: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  simText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  permissionsBlock: { gap: 10 },
  note: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  noteText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 17,
    borderRadius: 14,
    marginTop: 4,
  },
  actionBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
});
