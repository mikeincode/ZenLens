import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { checkPermissionWiring, type PermissionWiringStatus } from "@/utils/ocr";
import { useColors } from "@/hooks/useColors";

const isExpoGo =
  Constants.appOwnership === "expo" ||
  Constants.executionEnvironment === "storeClient";

// ─── Types ────────────────────────────────────────────────────────────────────

type Status = "checking" | "available" | "unavailable" | "partial";

interface CheckRow {
  id: string;
  title: string;
  description: string;
  icon: string;
  /** Static module key to check in NativeModules (synchronous) */
  nativeKey?: string;
  /** Always available in native build (not in Expo Go) */
  alwaysInNative?: boolean;
}

// ─── Static module checks (synchronous) ──────────────────────────────────────

const MODULE_CHECKS: CheckRow[] = [
  {
    id: "capture_module",
    title: "ZenLensCapture Module",
    description:
      "ScreenCaptureModule registered — NativeModules.ZenLensCapture exists.",
    nativeKey: "ZenLensCapture",
    icon: "radio",
  },
  {
    id: "ocr",
    title: "ML Kit OCR Module",
    description:
      "MLKitOCRModule registered — NativeModules.ZenLensOCR exists.",
    nativeKey: "ZenLensOCR",
    icon: "type",
  },
  {
    id: "overlay",
    title: "System Overlay Module",
    description:
      "OverlayModule registered — NativeModules.ZenLensOverlay exists.",
    nativeKey: "ZenLensOverlay",
    icon: "layers",
  },
  {
    id: "export",
    title: "File Export",
    description:
      "expo-file-system + expo-sharing available. Works in any native build.",
    alwaysInNative: true,
    icon: "share-2",
  },
];

// ─── Helper components ────────────────────────────────────────────────────────

function StatusIcon({
  status,
  colors,
}: {
  status: Status;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  if (status === "checking")
    return <ActivityIndicator size="small" color={colors.mutedForeground} />;
  if (status === "available")
    return <Feather name="check-circle" size={20} color={colors.success} />;
  if (status === "partial")
    return <Feather name="alert-circle" size={20} color={colors.warning} />;
  return <Feather name="x-circle" size={20} color={colors.destructive} />;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ReadinessScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  // Static module statuses (synchronous)
  const [moduleStatuses, setModuleStatuses] = useState<Record<string, Status>>(
    {}
  );

  // Async wiring check result
  const [wiringStatus, setWiringStatus] = useState<Status>("checking");
  const [wiringDetail, setWiringDetail] = useState<PermissionWiringStatus | null>(null);
  const [wiringMessage, setWiringMessage] = useState("");

  // Native Capture Test
  const [mpTestState, setMpTestState] = useState<
    "idle" | "testing" | "success" | "failed"
  >("idle");

  // ─── Initial checks ──────────────────────────────────────────────────────

  useEffect(() => {
    // Synchronous module presence checks
    const result: Record<string, Status> = {};
    for (const check of MODULE_CHECKS) {
      if (check.alwaysInNative) {
        result[check.id] = isExpoGo ? "unavailable" : "available";
      } else if (check.nativeKey) {
        const mod = (NativeModules as Record<string, unknown>)[check.nativeKey];
        result[check.id] = mod != null ? "available" : "unavailable";
      }
    }
    setModuleStatuses(result);

    // Async permission wiring check
    runWiringCheck();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function runWiringCheck() {
    setWiringStatus("checking");
    const captureModule = (NativeModules as Record<string, unknown>)["ZenLensCapture"];

    if (!captureModule) {
      // Module not present at all
      setWiringStatus("unavailable");
      setWiringMessage(
        isExpoGo
          ? "Not available in Expo Go — requires native build."
          : "ZenLensCapture module missing — run android:sync-native."
      );
      return;
    }

    const mod = captureModule as Record<string, unknown>;
    if (typeof mod["checkWiring"] !== "function") {
      // Module exists but is an old version without checkWiring
      setWiringStatus("partial");
      setWiringMessage(
        "Native module found, but MediaProjection permission wiring is incomplete. " +
        "Rebuild APK with the updated ScreenCaptureModule.kt."
      );
      return;
    }

    const wiring = await checkPermissionWiring();
    if (!wiring) {
      setWiringStatus("partial");
      setWiringMessage(
        "checkWiring() returned null — module may be outdated. Rebuild APK."
      );
      return;
    }

    setWiringDetail(wiring);

    if (wiring.activityListenerRegistered) {
      setWiringStatus("available");
      setWiringMessage(
        wiring.permissionGranted
          ? "Wired ✓ — permission already granted for this session."
          : `Wired ✓ — ActivityEventListener registered, request code ${wiring.requestCode}.`
      );
    } else {
      setWiringStatus("partial");
      setWiringMessage(
        "Module loaded but ActivityEventListener not registered. Rebuild APK."
      );
    }
  }

  // ─── Native Capture Test ─────────────────────────────────────────────────

  async function handleTestMediaProjection() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (isExpoGo) {
      setMpTestState("failed");
      return;
    }

    const mod = (NativeModules as Record<string, unknown>)["ZenLensCapture"] as
      | Record<string, unknown>
      | undefined;

    if (!mod || typeof mod["requestPermission"] !== "function") {
      setMpTestState("failed");
      return;
    }

    setMpTestState("testing");
    try {
      const granted = await (mod["requestPermission"] as () => Promise<boolean>)();
      setMpTestState(granted ? "success" : "failed");
      // Refresh wiring status to show permissionGranted = true
      if (granted) runWiringCheck();
    } catch {
      setMpTestState("failed");
    }
  }

  // ─── Derived display values ───────────────────────────────────────────────

  const mpTestColor =
    mpTestState === "success"
      ? colors.success
      : mpTestState === "failed"
        ? colors.destructive
        : colors.accent;

  const mpTestLabel =
    mpTestState === "testing"
      ? "Requesting MediaProjection permission…"
      : mpTestState === "success"
        ? "Permission granted — native capture ready ✓"
        : mpTestState === "failed"
          ? isExpoGo
            ? "Native capture unavailable in Expo Go"
            : "Permission denied or module missing"
          : "Test MediaProjection Permission";

  const allModulesOk =
    !isExpoGo &&
    Object.values(moduleStatuses).every((s) => s === "available") &&
    wiringStatus === "available";

  const captureModuleExists = moduleStatuses["capture_module"] === "available";

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) + 16,
            paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 32,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Back */}
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Feather name="arrow-left" size={18} color={colors.mutedForeground} />
          <Text style={[styles.backText, { color: colors.mutedForeground }]}>
            Back
          </Text>
        </Pressable>

        {/* Title */}
        <View style={styles.titleBlock}>
          <View style={[styles.iconCircle, { backgroundColor: `${colors.primary}18` }]}>
            <Feather name="cpu" size={28} color={colors.primary} />
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Device Readiness
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Checks all native Android modules required for real screen capture.
          </Text>
        </View>

        {/* App Mode Banner */}
        <View
          style={[
            styles.modeBanner,
            {
              backgroundColor: isExpoGo ? `${colors.warning}18` : `${colors.success}18`,
              borderColor: isExpoGo ? `${colors.warning}44` : `${colors.success}44`,
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
              {isExpoGo ? "Expo Go Demo Mode" : "Native Android Build Mode"}
            </Text>
            <Text style={[styles.modeDesc, { color: colors.mutedForeground }]}>
              {isExpoGo
                ? "Real screen capture is not included in this build. All 4 modules below will show ✗. Build the native APK to enable real capture."
                : "Running as a native Android build. Native modules should be available."}
            </Text>
          </View>
        </View>

        {/* Module Checklist */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
            Native Module Checklist
          </Text>

          {/* Static module rows */}
          {MODULE_CHECKS.map((check) => {
            const status = moduleStatuses[check.id] ?? "checking";
            return (
              <View
                key={check.id}
                style={[styles.checkRow, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={[styles.checkIcon, { backgroundColor: `${colors.primary}14` }]}>
                  <Feather name={check.icon as any} size={16} color={colors.primary} />
                </View>
                <View style={styles.checkContent}>
                  <Text style={[styles.checkTitle, { color: colors.foreground }]}>
                    {check.title}
                  </Text>
                  <Text style={[styles.checkDesc, { color: colors.mutedForeground }]}>
                    {check.description}
                  </Text>
                  {check.nativeKey && (
                    <Text style={[styles.moduleKey, { color: colors.mutedForeground }]}>
                      NativeModules.{check.nativeKey}
                    </Text>
                  )}
                </View>
                <StatusIcon status={status} colors={colors} />
              </View>
            );
          })}

          {/* Permission Wiring Row — separate from module existence */}
          <View
            style={[
              styles.checkRow,
              {
                backgroundColor: colors.card,
                borderColor:
                  wiringStatus === "partial"
                    ? `${colors.warning}66`
                    : colors.border,
                borderWidth: wiringStatus === "partial" ? 1.5 : 1,
              },
            ]}
          >
            <View
              style={[
                styles.checkIcon,
                {
                  backgroundColor:
                    wiringStatus === "partial"
                      ? `${colors.warning}20`
                      : `${colors.primary}14`,
                },
              ]}
            >
              <Feather
                name="link"
                size={16}
                color={
                  wiringStatus === "partial" ? colors.warning : colors.primary
                }
              />
            </View>
            <View style={styles.checkContent}>
              <Text style={[styles.checkTitle, { color: colors.foreground }]}>
                MediaProjection Permission Wiring
              </Text>
              <Text style={[styles.checkDesc, { color: colors.mutedForeground }]}>
                ActivityEventListener registered + onMediaProjectionResult() wired
                to resolve the JS promise when Android grants/denies the dialog.
              </Text>
              {wiringMessage ? (
                <Text
                  style={[
                    styles.wiringMsg,
                    {
                      color:
                        wiringStatus === "available"
                          ? colors.success
                          : wiringStatus === "partial"
                            ? colors.warning
                            : colors.destructive,
                    },
                  ]}
                >
                  {wiringMessage}
                </Text>
              ) : null}
              {wiringDetail && (
                <Text style={[styles.moduleKey, { color: colors.mutedForeground }]}>
                  requestCode={wiringDetail.requestCode} · permissionGranted=
                  {String(wiringDetail.permissionGranted)}
                </Text>
              )}
            </View>
            <StatusIcon status={wiringStatus} colors={colors} />
          </View>
        </View>

        {/* "Honest" warning: module exists but wiring is broken */}
        {captureModuleExists && wiringStatus === "partial" && (
          <View
            style={[
              styles.warningBox,
              { backgroundColor: `${colors.warning}14`, borderColor: `${colors.warning}44` },
            ]}
          >
            <Feather name="alert-triangle" size={16} color={colors.warning} />
            <Text style={[styles.warningText, { color: colors.warning }]}>
              Native module found, but MediaProjection permission wiring is
              incomplete. The capture button will appear to work, but the
              permission dialog will never resolve. Rebuild the APK with the
              updated ScreenCaptureModule.kt.
            </Text>
          </View>
        )}

        {/* Overall summary */}
        {!isExpoGo && (
          <View
            style={[
              styles.summaryBox,
              {
                backgroundColor: allModulesOk
                  ? `${colors.success}12`
                  : `${colors.destructive}12`,
                borderColor: allModulesOk
                  ? `${colors.success}33`
                  : `${colors.destructive}33`,
              },
            ]}
          >
            <Feather
              name={allModulesOk ? "check-circle" : "alert-circle"}
              size={16}
              color={allModulesOk ? colors.success : colors.destructive}
            />
            <Text
              style={[
                styles.summaryText,
                { color: allModulesOk ? colors.success : colors.destructive },
              ]}
            >
              {allModulesOk
                ? "All native modules wired — ZenLens is ready for real capture."
                : "One or more modules are missing or incomplete. Fix issues above and rebuild."}
            </Text>
          </View>
        )}

        {/* Native Capture Test */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
            Native Capture Test
          </Text>
          <Pressable
            onPress={handleTestMediaProjection}
            disabled={mpTestState === "testing"}
            style={({ pressed }) => [
              styles.testBtn,
              {
                backgroundColor:
                  mpTestState === "success"
                    ? `${colors.success}18`
                    : mpTestState === "failed"
                      ? `${colors.destructive}18`
                      : `${colors.primary}18`,
                borderColor:
                  mpTestState === "success"
                    ? `${colors.success}55`
                    : mpTestState === "failed"
                      ? `${colors.destructive}55`
                      : `${colors.primary}55`,
                opacity: mpTestState === "testing" || pressed ? 0.75 : 1,
              },
            ]}
          >
            {mpTestState === "testing" ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Feather name="play" size={16} color={mpTestColor} />
            )}
            <Text style={[styles.testBtnText, { color: mpTestColor }]}>
              {mpTestLabel}
            </Text>
          </Pressable>

          <Text style={[styles.testHint, { color: colors.mutedForeground }]}>
            {isExpoGo
              ? "Requires native APK build. Expo Go cannot open the Android MediaProjection dialog."
              : mpTestState === "idle"
                ? "Tapping this requests MediaProjection permission from Android. A system dialog titled 'Start recording?' will appear. Tap 'Start now' to grant."
                : mpTestState === "success"
                  ? "Android opened the permission dialog and you granted it. The wiring is confirmed working end-to-end."
                  : mpTestState === "failed"
                    ? "Permission was denied or the wiring is incomplete. Check the checklist above."
                    : ""}
          </Text>
        </View>

        {/* Build Guide */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
            Build Guide
          </Text>
          <View
            style={[styles.buildGuide, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            {[
              {
                step: "1. Prebuild + copy native modules",
                code: "npm run android:prebuild",
                note: "Generates android/ and runs the config plugin (copies Kotlin, patches manifests, wires MainActivity).",
              },
              {
                step: "2. Verify integration",
                code: "npm run android:verify-native",
                note: "Checks all 5 Kotlin files, all manifest entries, ActivityEventListener wiring, and MainActivity patch.",
              },
              {
                step: "3. Build APK via EAS",
                code: "npm run android:apk",
                note: "Submits to EAS Build. Download the APK from the EAS dashboard or via 'eas build:list'.",
              },
              {
                step: "4. Install and verify",
                code: "adb install zen-lens.apk",
                note: "Open ZenLens → Device Readiness → all rows green → Native Capture Test → grant dialog.",
              },
            ].map(({ step, code, note }) => (
              <View key={step} style={styles.buildStepBlock}>
                <Text style={[styles.buildStepLabel, { color: colors.foreground }]}>
                  {step}
                </Text>
                <View style={[styles.codeBlock, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.code, { color: colors.accent }]} selectable>
                    {code}
                  </Text>
                </View>
                <Text style={[styles.buildNote, { color: colors.mutedForeground }]}>
                  {note}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 16, flexGrow: 1 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  backText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  titleBlock: { alignItems: "center", gap: 10, paddingVertical: 8 },
  iconCircle: {
    width: 64, height: 64, borderRadius: 20,
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", textAlign: "center" },
  subtitle: {
    fontSize: 14, fontFamily: "Inter_400Regular",
    textAlign: "center", lineHeight: 20, paddingHorizontal: 8,
  },
  modeBanner: {
    flexDirection: "row", gap: 10, padding: 14,
    borderRadius: 12, borderWidth: 1, alignItems: "flex-start",
  },
  modeLabel: { fontSize: 13, fontFamily: "Inter_700Bold", marginBottom: 3 },
  modeDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 11, fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8, textTransform: "uppercase", paddingHorizontal: 2,
  },
  checkRow: {
    flexDirection: "row", alignItems: "flex-start",
    gap: 12, padding: 14, borderRadius: 12, borderWidth: 1,
  },
  checkIcon: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: "center", justifyContent: "center", marginTop: 1,
  },
  checkContent: { flex: 1, gap: 3 },
  checkTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  checkDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  moduleKey: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2, opacity: 0.7 },
  wiringMsg: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 4, lineHeight: 16 },
  warningBox: {
    flexDirection: "row", gap: 10, padding: 14,
    borderRadius: 12, borderWidth: 1, alignItems: "flex-start",
  },
  warningText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 18 },
  summaryBox: {
    flexDirection: "row", gap: 10, padding: 14,
    borderRadius: 12, borderWidth: 1, alignItems: "flex-start",
  },
  summaryText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },
  testBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 15, borderRadius: 12, borderWidth: 1,
  },
  testBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  testHint: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, paddingHorizontal: 2 },
  buildGuide: { padding: 16, borderRadius: 12, borderWidth: 1, gap: 16 },
  buildStepBlock: { gap: 6 },
  buildStepLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  codeBlock: { padding: 10, borderRadius: 8 },
  code: { fontSize: 12, fontFamily: "Inter_400Regular" },
  buildNote: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
});
