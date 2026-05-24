import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

interface CheckItem {
  id: string;
  title: string;
  description: string;
  nativeKey?: string;
  alwaysAvailable?: boolean;
  icon: string;
}

const CHECKS: CheckItem[] = [
  {
    id: "capture",
    title: "MediaProjection Capture",
    description:
      "ScreenCaptureModule — required for screen frame capture via Android MediaProjection API.",
    nativeKey: "ZenLensCapture",
    icon: "radio",
  },
  {
    id: "ocr",
    title: "ML Kit OCR",
    description:
      "MLKitOCRModule — Google ML Kit text recognition running fully on-device.",
    nativeKey: "ZenLensOCR",
    icon: "type",
  },
  {
    id: "overlay",
    title: "System Overlay",
    description:
      "OverlayModule — floating SYSTEM_ALERT_WINDOW control visible across all apps.",
    nativeKey: "ZenLensOverlay",
    icon: "layers",
  },
  {
    id: "export",
    title: "File Export",
    description:
      "expo-file-system + expo-sharing — local .TXT export and Share sheet. Always available in native build.",
    alwaysAvailable: true,
    icon: "share-2",
  },
];

type Status = "checking" | "available" | "unavailable";

function checkNativeModule(key: string): Status {
  const mod = (NativeModules as Record<string, unknown>)[key];
  return mod != null ? "available" : "unavailable";
}

function StatusIcon({
  status,
  color,
}: {
  status: Status;
  color: { success: string; destructive: string; mutedForeground: string };
}) {
  if (status === "checking")
    return (
      <ActivityIndicator size="small" color={color.mutedForeground} />
    );
  if (status === "available")
    return <Feather name="check-circle" size={20} color={color.success} />;
  return <Feather name="x-circle" size={20} color={color.destructive} />;
}

export default function ReadinessScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [mpTestResult, setMpTestResult] = useState<
    "idle" | "testing" | "success" | "failed"
  >("idle");

  const isExpoGo =
    Constants.appOwnership === "expo" ||
    Constants.executionEnvironment === "storeClient";

  useEffect(() => {
    const result: Record<string, Status> = {};
    for (const check of CHECKS) {
      if (check.alwaysAvailable) {
        result[check.id] = isExpoGo ? "unavailable" : "available";
      } else if (check.nativeKey) {
        result[check.id] = checkNativeModule(check.nativeKey);
      }
    }
    setStatuses(result);
  }, [isExpoGo]);

  const allAvailable =
    !isExpoGo &&
    Object.values(statuses).every((s) => s === "available");
  const noneAvailable = Object.values(statuses).every(
    (s) => s === "unavailable"
  );

  async function handleTestMediaProjection() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isExpoGo) {
      setMpTestResult("failed");
      return;
    }
    setMpTestResult("testing");
    try {
      const mod = NativeModules.ZenLensCapture;
      if (!mod) {
        setMpTestResult("failed");
        return;
      }
      const granted = await mod.requestPermission();
      setMpTestResult(granted ? "success" : "failed");
    } catch {
      setMpTestResult("failed");
    }
  }

  const mpResultColor =
    mpTestResult === "success"
      ? colors.success
      : mpTestResult === "failed"
        ? colors.destructive
        : colors.primary;

  const mpResultLabel =
    mpTestResult === "testing"
      ? "Requesting…"
      : mpTestResult === "success"
        ? "Permission granted — capture ready"
        : mpTestResult === "failed"
          ? isExpoGo
            ? "Native capture unavailable in Expo Go"
            : "Permission denied or module missing"
          : "Test MediaProjection Permission";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop:
              insets.top + (Platform.OS === "web" ? 67 : 0) + 16,
            paddingBottom:
              insets.bottom + (Platform.OS === "web" ? 34 : 0) + 32,
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
            <Feather name="cpu" size={28} color={colors.primary} />
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Device Readiness
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Checks whether ZenLens native Android modules are registered and
            available in the current build.
          </Text>
        </View>

        {/* App Mode Banner */}
        <View
          style={[
            styles.modeBanner,
            {
              backgroundColor: isExpoGo
                ? `${colors.warning}18`
                : `${colors.success}18`,
              borderColor: isExpoGo
                ? `${colors.warning}44`
                : `${colors.success}44`,
            },
          ]}
        >
          <Feather
            name={isExpoGo ? "alert-triangle" : "check-circle"}
            size={16}
            color={isExpoGo ? colors.warning : colors.success}
          />
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.modeLabel,
                { color: isExpoGo ? colors.warning : colors.success },
              ]}
            >
              {isExpoGo
                ? "Expo Go Demo Mode"
                : "Native Android Build Mode"}
            </Text>
            <Text
              style={[styles.modeDesc, { color: colors.mutedForeground }]}
            >
              {isExpoGo
                ? "Simulated capture only. Run a custom development build or APK for real screen capture."
                : "Running as a native Android build. Native modules are available for real capture."}
            </Text>
          </View>
        </View>

        {/* Checklist */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: colors.mutedForeground }]}
          >
            Native Module Checklist
          </Text>
          {CHECKS.map((check) => {
            const status = statuses[check.id] ?? "checking";
            return (
              <View
                key={check.id}
                style={[
                  styles.checkRow,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.checkIcon,
                    { backgroundColor: `${colors.primary}14` },
                  ]}
                >
                  <Feather
                    name={check.icon as any}
                    size={16}
                    color={colors.primary}
                  />
                </View>
                <View style={styles.checkContent}>
                  <Text
                    style={[styles.checkTitle, { color: colors.foreground }]}
                  >
                    {check.title}
                  </Text>
                  <Text
                    style={[
                      styles.checkDesc,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {check.description}
                  </Text>
                  {check.nativeKey && (
                    <Text
                      style={[
                        styles.moduleKey,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      NativeModules.{check.nativeKey}
                    </Text>
                  )}
                </View>
                <StatusIcon status={status} color={colors} />
              </View>
            );
          })}
        </View>

        {/* Summary */}
        {!isExpoGo && (
          <View
            style={[
              styles.summaryBox,
              {
                backgroundColor: allAvailable
                  ? `${colors.success}12`
                  : `${colors.destructive}12`,
                borderColor: allAvailable
                  ? `${colors.success}33`
                  : `${colors.destructive}33`,
              },
            ]}
          >
            <Feather
              name={allAvailable ? "check-circle" : "alert-circle"}
              size={16}
              color={allAvailable ? colors.success : colors.destructive}
            />
            <Text
              style={[
                styles.summaryText,
                {
                  color: allAvailable
                    ? colors.success
                    : colors.destructive,
                },
              ]}
            >
              {allAvailable
                ? "All native modules available — ZenLens is ready for real capture."
                : "Some modules are missing. Follow the build guide below to register all native modules."}
            </Text>
          </View>
        )}

        {/* Native Capture Test */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: colors.mutedForeground }]}
          >
            Native Capture Test
          </Text>
          <Pressable
            onPress={handleTestMediaProjection}
            disabled={mpTestResult === "testing"}
            style={({ pressed }) => [
              styles.testBtn,
              {
                backgroundColor:
                  mpTestResult === "success"
                    ? `${colors.success}18`
                    : mpTestResult === "failed"
                      ? `${colors.destructive}18`
                      : `${colors.primary}18`,
                borderColor:
                  mpTestResult === "success"
                    ? `${colors.success}55`
                    : mpTestResult === "failed"
                      ? `${colors.destructive}55`
                      : `${colors.primary}55`,
                opacity:
                  mpTestResult === "testing" || pressed ? 0.75 : 1,
              },
            ]}
          >
            {mpTestResult === "testing" ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Feather name="play" size={16} color={mpResultColor} />
            )}
            <Text style={[styles.testBtnText, { color: mpResultColor }]}>
              {mpResultLabel}
            </Text>
          </Pressable>
          {mpTestResult === "idle" && (
            <Text
              style={[styles.testHint, { color: colors.mutedForeground }]}
            >
              Requests MediaProjection permission from Android and reports
              success or failure.
              {isExpoGo
                ? " This will always fail in Expo Go — it requires a native build."
                : ""}
            </Text>
          )}
        </View>

        {/* Build Guide Link */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: colors.mutedForeground }]}
          >
            Build Guide
          </Text>
          <View
            style={[
              styles.buildGuide,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.buildStep, { color: colors.foreground }]}>
              1. Run prebuild
            </Text>
            <View
              style={[
                styles.codeBlock,
                { backgroundColor: colors.secondary },
              ]}
            >
              <Text
                style={[styles.code, { color: colors.accent }]}
                selectable
              >
                npx expo prebuild --platform android
              </Text>
            </View>

            <Text style={[styles.buildStep, { color: colors.foreground }]}>
              2. Copy Kotlin modules
            </Text>
            <View
              style={[
                styles.codeBlock,
                { backgroundColor: colors.secondary },
              ]}
            >
              <Text
                style={[styles.code, { color: colors.accent }]}
                selectable
              >
                android/app/src/main/java/com/zenlens/app/
              </Text>
            </View>
            <Text
              style={[styles.buildNote, { color: colors.mutedForeground }]}
            >
              Copy all .kt files from android-native/ into that folder, then
              register ZenLensPackage in MainApplication.kt.
            </Text>

            <Text style={[styles.buildStep, { color: colors.foreground }]}>
              3. Launch dev build on device
            </Text>
            <View
              style={[
                styles.codeBlock,
                { backgroundColor: colors.secondary },
              ]}
            >
              <Text
                style={[styles.code, { color: colors.accent }]}
                selectable
              >
                npx expo run:android
              </Text>
            </View>

            <Text style={[styles.buildStep, { color: colors.foreground }]}>
              4. Build signed APK via EAS
            </Text>
            <View
              style={[
                styles.codeBlock,
                { backgroundColor: colors.secondary },
              ]}
            >
              <Text
                style={[styles.code, { color: colors.accent }]}
                selectable
              >
                eas build --platform android --profile preview
              </Text>
            </View>
            <Text
              style={[styles.buildNote, { color: colors.mutedForeground }]}
            >
              See android-native/README.md in the project source for the
              complete manifest, dependency, and EAS setup guide.
            </Text>
          </View>
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
  modeBanner: {
    flexDirection: "row",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  modeLabel: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    marginBottom: 3,
    letterSpacing: 0.2,
  },
  modeDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    paddingHorizontal: 2,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  checkIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkContent: { flex: 1, gap: 3 },
  checkTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  checkDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  moduleKey: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
    opacity: 0.7,
  },
  summaryBox: {
    flexDirection: "row",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  summaryText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    lineHeight: 18,
  },
  testBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    borderRadius: 12,
    borderWidth: 1,
  },
  testBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  testHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
    paddingHorizontal: 2,
  },
  buildGuide: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  buildStep: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginTop: 4,
  },
  codeBlock: {
    padding: 10,
    borderRadius: 8,
  },
  code: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  buildNote: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
  },
});
