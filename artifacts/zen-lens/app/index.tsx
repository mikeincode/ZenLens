import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusPill } from "@/components/StatusPill";
import { useCapture } from "@/context/CaptureContext";
import { useColors } from "@/hooks/useColors";

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    state,
    ocrStatus,
    transcript,
    frameCount,
    appendedCount,
    stopCapture,
    isSimulated,
  } = useCapture();

  const isActive = state === "capturing" || state === "paused";
  const wordCount = transcript.trim()
    ? transcript.trim().split(/\s+/).length
    : 0;
  const lineCount = transcript.trim()
    ? transcript.trim().split("\n").filter((l) => l.trim()).length
    : 0;

  async function handleStartCapture() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/setup");
  }

  async function handleStopCapture() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await stopCapture();
  }

  async function handleOpenTranscript() {
    await Haptics.selectionAsync();
    router.push("/transcript");
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
              24,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.appName, { color: colors.foreground }]}>
              ZenLens
            </Text>
            <Text style={[styles.tagline, { color: colors.mutedForeground }]}>
              Scrolling OCR clipboard
            </Text>
          </View>
          <Pressable
            onPress={() => router.push("/settings")}
            style={({ pressed }) => [
              styles.settingsBtn,
              {
                backgroundColor: colors.secondary,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather name="settings" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {/* Status */}
        <View style={styles.statusRow}>
          <StatusPill state={state} label={isActive ? ocrStatus : ""} />
          {isSimulated && (
            <View
              style={[
                styles.devBadge,
                { backgroundColor: `${colors.warning}22`, borderColor: `${colors.warning}44` },
              ]}
            >
              <Text style={[styles.devText, { color: colors.warning }]}>
                SIM MODE
              </Text>
            </View>
          )}
        </View>

        {/* Stats cards */}
        {isActive && (
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {frameCount}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                Frames
              </Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.statValue, { color: colors.accent }]}>
                {appendedCount}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                Appended
              </Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {wordCount}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                Words
              </Text>
            </View>
          </View>
        )}

        {/* Main action */}
        {!isActive ? (
          <Pressable
            onPress={handleStartCapture}
            style={({ pressed }) => [
              styles.startButton,
              {
                backgroundColor: colors.primary,
                opacity: pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              },
            ]}
          >
            <Feather name="radio" size={22} color={colors.primaryForeground} />
            <Text
              style={[
                styles.startButtonText,
                { color: colors.primaryForeground },
              ]}
            >
              Start Capture
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleStopCapture}
            style={({ pressed }) => [
              styles.stopButton,
              {
                backgroundColor: `${colors.destructive}18`,
                borderColor: colors.destructive,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Feather name="square" size={20} color={colors.destructive} />
            <Text style={[styles.stopButtonText, { color: colors.destructive }]}>
              Stop Capture
            </Text>
          </Pressable>
        )}

        {/* Secondary actions */}
        <View style={styles.secondaryActions}>
          <Pressable
            onPress={handleOpenTranscript}
            style={({ pressed }) => [
              styles.secondaryBtn,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather name="file-text" size={18} color={colors.primary} />
            <Text
              style={[styles.secondaryBtnText, { color: colors.foreground }]}
            >
              Transcript
            </Text>
            {lineCount > 0 && (
              <View
                style={[
                  styles.badge,
                  { backgroundColor: colors.primary },
                ]}
              >
                <Text style={styles.badgeText}>{lineCount}</Text>
              </View>
            )}
            <Feather
              name="chevron-right"
              size={16}
              color={colors.mutedForeground}
              style={styles.chevron}
            />
          </Pressable>

          {isActive && (
            <Pressable
              onPress={() => router.push("/crop")}
              style={({ pressed }) => [
                styles.secondaryBtn,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Feather name="crop" size={18} color={colors.accent} />
              <Text
                style={[styles.secondaryBtnText, { color: colors.foreground }]}
              >
                Adjust Crop
              </Text>
              <Feather
                name="chevron-right"
                size={16}
                color={colors.mutedForeground}
                style={styles.chevron}
              />
            </Pressable>
          )}
        </View>

        {/* How it works */}
        {!isActive && (
          <View
            style={[
              styles.howItWorks,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text
              style={[styles.howTitle, { color: colors.foreground }]}
            >
              How it works
            </Text>
            {[
              {
                icon: "radio" as const,
                text: "Tap Start Capture and grant screen recording permission",
              },
              {
                icon: "crop" as const,
                text: "Drag the crop box over the text you want to capture",
              },
              {
                icon: "zap" as const,
                text: "OCR runs every 1-2 seconds as you scroll",
              },
              {
                icon: "layers" as const,
                text: "Duplicate text is automatically skipped",
              },
              {
                icon: "share-2" as const,
                text: "Pause, edit, and export the transcript",
              },
            ].map((step, i) => (
              <View key={i} style={styles.howStep}>
                <View
                  style={[
                    styles.howIcon,
                    { backgroundColor: `${colors.primary}18` },
                  ]}
                >
                  <Feather name={step.icon} size={14} color={colors.primary} />
                </View>
                <Text
                  style={[styles.howText, { color: colors.mutedForeground }]}
                >
                  {step.text}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Privacy note */}
        <View style={styles.privacyNote}>
          <Feather name="shield" size={12} color={colors.mutedForeground} />
          <Text style={[styles.privacyText, { color: colors.mutedForeground }]}>
            All OCR runs on-device. Screenshots are never uploaded or stored.
          </Text>
        </View>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  appName: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  settingsBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  devBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  devText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  statCard: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    gap: 4,
  },
  statValue: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
  },
  statLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  startButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 18,
    borderRadius: 16,
  },
  startButtonText: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
  },
  stopButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  stopButtonText: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
  },
  secondaryActions: { gap: 8 },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  secondaryBtnText: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  chevron: { marginLeft: "auto" },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    fontFamily: "Inter_700Bold",
  },
  howItWorks: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  howTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  howStep: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  howIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  howText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  privacyNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
  },
  privacyText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    flex: 1,
    lineHeight: 16,
  },
});
