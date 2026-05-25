import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
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
import {
  captureSingleNativeFrame,
  getNativeCaptureServiceStatus,
  requestNativeMediaProjectionPermission,
  startNativeCaptureService,
  stopNativeCaptureService,
} from "@/utils/ocr";

const isExpoGo =
  Constants.appOwnership === "expo" ||
  Constants.executionEnvironment === "storeClient";

type TestState = "idle" | "busy" | "ok" | "err";

interface NativeTestState {
  permission: TestState;
  permissionMsg: string;
  service: TestState;
  serviceMsg: string;
  frame: TestState;
  frameMsg: string;
  stop: TestState;
  stopMsg: string;
  permissionGranted: boolean;
  serviceRunning: boolean;
}

const INIT: NativeTestState = {
  permission: "idle",
  permissionMsg: "",
  service: "idle",
  serviceMsg: "",
  frame: "idle",
  frameMsg: "",
  stop: "idle",
  stopMsg: "",
  permissionGranted: false,
  serviceRunning: false,
};

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

  const [nt, setNt] = useState<NativeTestState>(INIT);
  const appStateRef = useRef(AppState.currentState);

  // On app resume (returning from Android permission dialog), refresh permission + service status
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (appStateRef.current !== "active" && nextState === "active") {
        if (nt.permission === "busy") {
          // The dialog returned — fetch current status to reflect what happened
          getNativeCaptureServiceStatus().then((status) => {
            if (!status) return;
            if (status.permissionGranted) {
              setNt((p) => ({
                ...p,
                permission: "ok",
                permissionMsg: "Granted ✓ — token cached. Tap 'Start Service' next.",
                permissionGranted: true,
              }));
            } else {
              setNt((p) => ({
                ...p,
                permission: "err",
                permissionMsg: "Permission not granted — check logcat for details.",
                permissionGranted: false,
              }));
            }
          });
        }
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [nt.permission]); // eslint-disable-line react-hooks/exhaustive-deps

  const isActive = state === "capturing" || state === "paused";
  const wordCount = transcript.trim()
    ? transcript.trim().split(/\s+/).length
    : 0;
  const lineCount = transcript.trim()
    ? transcript.trim().split("\n").filter((l) => l.trim()).length
    : 0;

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleStartCapture() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/setup");
  }

  async function handleStopCapture() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await stopCapture();
  }

  async function handleTestPermission() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isExpoGo) {
      setNt((p) => ({
        ...p,
        permission: "err",
        permissionMsg: "Not available in Expo Go — build the native APK first.",
      }));
      return;
    }
    setNt((p) => ({
      ...p,
      permission: "busy",
      permissionMsg: "Waiting for Android permission result…",
    }));
    const result = await requestNativeMediaProjectionPermission();
    if (!result) {
      setNt((p) => ({
        ...p,
        permission: "err",
        permissionMsg: "ZenLensCapture module not found — rebuild APK.",
        permissionGranted: false,
      }));
      return;
    }
    if (result.granted) {
      setNt((p) => ({
        ...p,
        permission: "ok",
        permissionMsg: "Granted ✓ — token cached. Tap 'Start Service' next.",
        permissionGranted: true,
      }));
    } else {
      setNt((p) => ({
        ...p,
        permission: "err",
        permissionMsg: result.reason ?? "Permission denied or cancelled.",
        permissionGranted: false,
      }));
    }
  }

  async function handleStartService() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setNt((p) => ({ ...p, service: "busy", serviceMsg: "" }));
    const result = await startNativeCaptureService();
    if (!result) {
      setNt((p) => ({
        ...p,
        service: "err",
        serviceMsg: "startCaptureService() not found — rebuild APK.",
        serviceRunning: false,
      }));
      return;
    }
    if (result.started) {
      setNt((p) => ({
        ...p,
        service: "ok",
        serviceMsg: "Service started ✓ — check Android notification bar.",
        serviceRunning: true,
      }));
    } else {
      setNt((p) => ({
        ...p,
        service: "err",
        serviceMsg: result.reason ?? "Service failed to start.",
        serviceRunning: false,
      }));
    }
  }

  async function handleTestSingleFrame() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setNt((p) => ({ ...p, frame: "busy", frameMsg: "" }));
    const result = await captureSingleNativeFrame();
    if (!result) {
      setNt((p) => ({
        ...p,
        frame: "err",
        frameMsg: "captureSingleFrame() unavailable — rebuild APK.",
      }));
      return;
    }
    if (result.success) {
      setNt((p) => ({
        ...p,
        frame: "ok",
        frameMsg: `Frame captured ✓ — ${result.width}×${result.height}`,
      }));
    } else {
      setNt((p) => ({
        ...p,
        frame: "err",
        frameMsg: result.reason,
      }));
    }
  }

  async function handleStopService() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setNt((p) => ({ ...p, stop: "busy", stopMsg: "" }));
    const result = await stopNativeCaptureService();
    if (!result) {
      setNt((p) => ({
        ...p,
        stop: "err",
        stopMsg: "stopCaptureService() not found — rebuild APK.",
      }));
      return;
    }
    if (result.stopped) {
      setNt((p) => ({
        ...p,
        stop: "ok",
        stopMsg: "Service stopped ✓ — token cleared. Re-request permission for next session.",
        serviceRunning: false,
        permissionGranted: false,
        permission: "idle",
        permissionMsg: "",
        service: "idle",
        serviceMsg: "",
        frame: "idle",
        frameMsg: "",
      }));
    } else {
      setNt((p) => ({ ...p, stop: "err", stopMsg: "Stop returned false — check logs." }));
    }
  }

  // ── Test button helpers ──────────────────────────────────────────────────────

  function testColor(s: TestState) {
    if (s === "ok") return colors.success;
    if (s === "err") return colors.destructive;
    return colors.accent;
  }

  function testBg(s: TestState) {
    if (s === "ok") return `${colors.success}14`;
    if (s === "err") return `${colors.destructive}14`;
    return `${colors.accent}10`;
  }

  function testBorder(s: TestState) {
    if (s === "ok") return `${colors.success}44`;
    if (s === "err") return `${colors.destructive}44`;
    return `${colors.accent}30`;
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) + 16,
            paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 24,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.appName, { color: colors.foreground }]}>ZenLens</Text>
            <Text style={[styles.tagline, { color: colors.mutedForeground }]}>
              Scrolling OCR clipboard
            </Text>
          </View>
          <Pressable
            onPress={() => router.push("/settings")}
            style={({ pressed }) => [
              styles.settingsBtn,
              { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="settings" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {/* Mode Banner */}
        <Pressable
          onPress={() => router.push("/readiness")}
          style={({ pressed }) => [
            styles.modeBanner,
            {
              backgroundColor: isSimulated ? `${colors.warning}14` : `${colors.success}14`,
              borderColor: isSimulated ? `${colors.warning}40` : `${colors.success}40`,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Feather
            name={isSimulated ? "alert-triangle" : "check-circle"}
            size={14}
            color={isSimulated ? colors.warning : colors.success}
          />
          <Text style={[styles.modeBannerText, { color: isSimulated ? colors.warning : colors.success }]}>
            {isSimulated
              ? "Expo Go demo mode — simulated capture only"
              : "Native build mode — real MediaProjection capture available"}
          </Text>
          <Feather name="chevron-right" size={13} color={isSimulated ? colors.warning : colors.success} style={{ opacity: 0.7 }} />
        </Pressable>

        {/* Status */}
        <View style={styles.statusRow}>
          <StatusPill state={state} label={isActive ? ocrStatus : ""} />
        </View>

        {/* Stats */}
        {isActive && (
          <View style={styles.statsRow}>
            {[
              { value: frameCount, label: "Frames", color: colors.foreground },
              { value: appendedCount, label: "Appended", color: colors.accent },
              { value: wordCount, label: "Words", color: colors.foreground },
            ].map(({ value, label, color }) => (
              <View key={label} style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statValue, { color }]}>{value}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Main action */}
        {!isActive ? (
          <Pressable
            onPress={handleStartCapture}
            style={({ pressed }) => [
              styles.startButton,
              { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
            ]}
          >
            <Feather name="radio" size={22} color={colors.primaryForeground} />
            <Text style={[styles.startButtonText, { color: colors.primaryForeground }]}>Start Capture</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleStopCapture}
            style={({ pressed }) => [
              styles.stopButton,
              { backgroundColor: `${colors.destructive}18`, borderColor: colors.destructive, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Feather name="square" size={20} color={colors.destructive} />
            <Text style={[styles.stopButtonText, { color: colors.destructive }]}>Stop Capture</Text>
          </Pressable>
        )}

        {/* Secondary nav */}
        <View style={styles.secondaryActions}>
          <Pressable
            onPress={() => router.push("/transcript")}
            style={({ pressed }) => [
              styles.secondaryBtn,
              { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="file-text" size={18} color={colors.primary} />
            <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Transcript</Text>
            {lineCount > 0 && (
              <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                <Text style={styles.badgeText}>{lineCount}</Text>
              </View>
            )}
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} style={styles.chevron} />
          </Pressable>

          {isActive && (
            <Pressable
              onPress={() => router.push("/crop")}
              style={({ pressed }) => [
                styles.secondaryBtn,
                { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Feather name="crop" size={18} color={colors.accent} />
              <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Adjust Crop</Text>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} style={styles.chevron} />
            </Pressable>
          )}

          <Pressable
            onPress={() => router.push("/readiness")}
            style={({ pressed }) => [
              styles.secondaryBtn,
              { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="cpu" size={18} color={colors.mutedForeground} />
            <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Device Readiness</Text>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} style={styles.chevron} />
          </Pressable>
        </View>

        {/* ── Native Handoff Test Panel ────────────────────────────────────── */}
        <View style={[styles.nativePanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.nativePanelTitle, { color: colors.foreground }]}>
            Native Handoff Test
          </Text>
          <Text style={[styles.nativePanelSub, { color: colors.mutedForeground }]}>
            {isExpoGo
              ? "Requires native APK — build with: npm run android:apk"
              : "Run in order: permission → start service → stop service"}
          </Text>

          {/* Button 1: Permission */}
          <Pressable
            onPress={handleTestPermission}
            disabled={nt.permission === "busy"}
            style={({ pressed }) => [
              styles.nativeBtn,
              {
                backgroundColor: testBg(nt.permission),
                borderColor: testBorder(nt.permission),
                opacity: nt.permission === "busy" || pressed ? 0.7 : 1,
              },
            ]}
          >
            {nt.permission === "busy"
              ? <ActivityIndicator size="small" color={colors.accent} />
              : <Feather name="shield" size={15} color={testColor(nt.permission)} />}
            <View style={{ flex: 1 }}>
              <Text style={[styles.nativeBtnLabel, { color: testColor(nt.permission) }]}>
                Test MediaProjection Permission
              </Text>
              {nt.permissionMsg ? (
                <Text style={[styles.nativeBtnSub, { color: testColor(nt.permission) }]}>
                  {nt.permissionMsg}
                </Text>
              ) : (
                <Text style={[styles.nativeBtnSub, { color: colors.mutedForeground }]}>
                  Opens Android "Start recording?" dialog
                </Text>
              )}
            </View>
          </Pressable>

          {/* Button 2: Start service */}
          <Pressable
            onPress={handleStartService}
            disabled={nt.service === "busy" || (!nt.permissionGranted && !isExpoGo)}
            style={({ pressed }) => [
              styles.nativeBtn,
              {
                backgroundColor: testBg(nt.service),
                borderColor: testBorder(nt.service),
                opacity:
                  nt.service === "busy" ||
                  (!nt.permissionGranted && !isExpoGo) ||
                  pressed
                    ? 0.45
                    : 1,
              },
            ]}
          >
            {nt.service === "busy"
              ? <ActivityIndicator size="small" color={colors.accent} />
              : <Feather name="play-circle" size={15} color={testColor(nt.service)} />}
            <View style={{ flex: 1 }}>
              <Text style={[styles.nativeBtnLabel, { color: testColor(nt.service) }]}>
                Test Foreground Capture Service
              </Text>
              {nt.serviceMsg ? (
                <Text style={[styles.nativeBtnSub, { color: testColor(nt.service) }]}>
                  {nt.serviceMsg}
                </Text>
              ) : (
                <Text style={[styles.nativeBtnSub, { color: colors.mutedForeground }]}>
                  {nt.permissionGranted
                    ? "Starts ScreenCaptureService — check notification bar"
                    : "Grant permission first (button above)"}
                </Text>
              )}
            </View>
          </Pressable>

          {/* Button 3: Single frame capture */}
          <Pressable
            onPress={handleTestSingleFrame}
            disabled={nt.frame === "busy" || ((!nt.permissionGranted || !nt.serviceRunning) && !isExpoGo)}
            style={({ pressed }) => [
              styles.nativeBtn,
              {
                backgroundColor: testBg(nt.frame),
                borderColor: testBorder(nt.frame),
                opacity:
                  nt.frame === "busy" ||
                  ((!nt.permissionGranted || !nt.serviceRunning) && !isExpoGo) ||
                  pressed
                    ? 0.45
                    : 1,
              },
            ]}
          >
            {nt.frame === "busy"
              ? <ActivityIndicator size="small" color={colors.accent} />
              : <Feather name="camera" size={15} color={testColor(nt.frame)} />}
            <View style={{ flex: 1 }}>
              <Text style={[styles.nativeBtnLabel, { color: testColor(nt.frame) }]}>
                Test Single Frame Capture
              </Text>
              {nt.frameMsg ? (
                <Text style={[styles.nativeBtnSub, { color: testColor(nt.frame) }]}>
                  {nt.frameMsg}
                </Text>
              ) : (
                <Text style={[styles.nativeBtnSub, { color: colors.mutedForeground }]}>
                  {nt.serviceRunning
                    ? "Captures one frame — returns width×height metadata"
                    : "Start service first (button above)"}
                </Text>
              )}
            </View>
          </Pressable>

          {/* Button 4: Stop service */}
          <Pressable
            onPress={handleStopService}
            disabled={nt.stop === "busy" || (!nt.serviceRunning && !isExpoGo)}
            style={({ pressed }) => [
              styles.nativeBtn,
              {
                backgroundColor: testBg(nt.stop),
                borderColor: testBorder(nt.stop),
                opacity:
                  nt.stop === "busy" ||
                  (!nt.serviceRunning && !isExpoGo) ||
                  pressed
                    ? 0.45
                    : 1,
              },
            ]}
          >
            {nt.stop === "busy"
              ? <ActivityIndicator size="small" color={colors.accent} />
              : <Feather name="stop-circle" size={15} color={testColor(nt.stop)} />}
            <View style={{ flex: 1 }}>
              <Text style={[styles.nativeBtnLabel, { color: testColor(nt.stop) }]}>
                Stop Capture Service
              </Text>
              {nt.stopMsg ? (
                <Text style={[styles.nativeBtnSub, { color: testColor(nt.stop) }]}>
                  {nt.stopMsg}
                </Text>
              ) : (
                <Text style={[styles.nativeBtnSub, { color: colors.mutedForeground }]}>
                  {nt.serviceRunning
                    ? "Stops service, clears token — notification disappears"
                    : "Start service first (button above)"}
                </Text>
              )}
            </View>
          </Pressable>
        </View>

        {/* How it works */}
        {!isActive && (
          <View style={[styles.howItWorks, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.howTitle, { color: colors.foreground }]}>HOW IT WORKS</Text>
            {[
              { icon: "radio" as const, text: "Tap Start Capture and grant screen recording permission" },
              { icon: "crop" as const, text: "Drag the crop box over the text you want to capture" },
              { icon: "zap" as const, text: "OCR runs every 1-2 seconds as you scroll" },
              { icon: "layers" as const, text: "Duplicate text is automatically skipped" },
              { icon: "share-2" as const, text: "Pause, edit, and export the transcript" },
            ].map((step, i) => (
              <View key={i} style={styles.howStep}>
                <View style={[styles.howIcon, { backgroundColor: `${colors.primary}18` }]}>
                  <Feather name={step.icon} size={14} color={colors.primary} />
                </View>
                <Text style={[styles.howText, { color: colors.mutedForeground }]}>{step.text}</Text>
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
  scroll: { paddingHorizontal: 20, gap: 16, flexGrow: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  appName: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  tagline: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  settingsBtn: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  modeBanner: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1 },
  modeBannerText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 16 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  statsRow: { flexDirection: "row", gap: 10 },
  statCard: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, alignItems: "center", gap: 4 },
  statValue: { fontSize: 24, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  startButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 18, borderRadius: 16 },
  startButtonText: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  stopButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16, borderRadius: 16, borderWidth: 1.5 },
  stopButtonText: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  secondaryActions: { gap: 8 },
  secondaryBtn: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1 },
  secondaryBtnText: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  chevron: { marginLeft: "auto" },
  badge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  badgeText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },
  // Native test panel
  nativePanel: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  nativePanelTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", letterSpacing: 0.3, textTransform: "uppercase" },
  nativePanelSub: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, marginBottom: 2 },
  nativeBtn: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
  nativeBtnLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  nativeBtnSub: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
  // How it works
  howItWorks: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 12 },
  howTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 2 },
  howStep: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  howIcon: { width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center", marginTop: 1 },
  howText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  privacyNote: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
  privacyText: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 16 },
});
