import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  captureSingleNativeFrame,
  checkPermissionWiring,
  getNativeCaptureServiceStatus,
  getNativeDebugStatus,
  requestNativeMediaProjectionPermission,
  startNativeCaptureService,
  stopNativeCaptureService,
  type PermissionWiringStatus,
  type CaptureServiceStatus,
  type NativeDebugStatus,
  type SingleFrameResult,
} from "@/utils/ocr";
import { useColors } from "@/hooks/useColors";

const isExpoGo =
  Constants.appOwnership === "expo" ||
  Constants.executionEnvironment === "storeClient";

type RowStatus = "checking" | "ok" | "warn" | "err";

interface RowState {
  status: RowStatus;
  detail: string;
}

interface ReadinessState {
  captureModule: RowState;
  wiringListener: RowState;
  permissionGranted: RowState;
  serviceWiring: RowState;
  serviceRunning: RowState;
  singleFrameWiring: RowState;
  overlayModule: RowState;
  ocrModule: RowState;
  fileExport: RowState;
}

const CHECKING: RowState = { status: "checking", detail: "" };
const init: ReadinessState = {
  captureModule: CHECKING,
  wiringListener: CHECKING,
  permissionGranted: CHECKING,
  serviceWiring: CHECKING,
  serviceRunning: CHECKING,
  singleFrameWiring: CHECKING,
  overlayModule: CHECKING,
  ocrModule: CHECKING,
  fileExport: CHECKING,
};

function RowIcon({ status, colors }: { status: RowStatus; colors: any }) {
  if (status === "checking") return <ActivityIndicator size="small" color={colors.mutedForeground} />;
  if (status === "ok") return <Feather name="check-circle" size={20} color={colors.success} />;
  if (status === "warn") return <Feather name="alert-circle" size={20} color={colors.warning} />;
  return <Feather name="x-circle" size={20} color={colors.destructive} />;
}

function statusBorder(status: RowStatus, colors: any) {
  if (status === "warn") return `${colors.warning}55`;
  if (status === "err") return `${colors.destructive}22`;
  return colors.border;
}

export default function ReadinessScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<ReadinessState>(init);
  const [mpState, setMpState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const [mpMsg, setMpMsg] = useState("");
  const [svcState, setSvcState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const [svcMsg, setSvcMsg] = useState("");
  const [stopState, setStopState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const [stopMsg, setStopMsg] = useState("");
  const [frameState, setFrameState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const [frameMsg, setFrameMsg] = useState("");
  const [lastFrameResult, setLastFrameResult] = useState<SingleFrameResult | null>(null);
  const [permGranted, setPermGranted] = useState(false);
  const [svcRunning, setSvcRunning] = useState(false);
  const [debugStatus, setDebugStatus] = useState<NativeDebugStatus | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    runChecks();
    refreshDebugStatus();
    // Poll service status every 3s while screen is open
    pollingRef.current = setInterval(pollServiceStatus, 3000);

    // On app resume (returning from Android permission dialog), refresh status + debug info
    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (appStateRef.current !== "active" && nextState === "active") {
        pollServiceStatus();
        refreshDebugStatus();
      }
      appStateRef.current = nextState;
    });

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      appStateSub.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function pollServiceStatus() {
    const status = await getNativeCaptureServiceStatus();
    if (!status) return;
    setSvcRunning(status.serviceRunning);
    setPermGranted(status.permissionGranted);
    setRows((prev) => ({
      ...prev,
      permissionGranted: status.permissionGranted
        ? { status: "ok", detail: "MediaProjection token cached — ready to start service." }
        : { status: "err", detail: "No permission cached. Tap 'Test MediaProjection Permission' below." },
      serviceRunning: status.serviceRunning
        ? { status: "ok", detail: "ScreenCaptureService is running. Check Android notification bar." }
        : { status: "err", detail: "Service not running. Tap 'Test Foreground Capture Service' below." },
    }));
  }

  async function refreshDebugStatus() {
    const status = await getNativeDebugStatus();
    setDebugStatus(status);
  }

  async function runChecks() {
    setRows(init);

    // ── 1. ZenLensCapture module exists ───────────────────────────────────────
    const captureModule = (NativeModules as any).ZenLensCapture;
    if (!captureModule) {
      const reason = isExpoGo
        ? "Not available in Expo Go — build native APK."
        : "ZenLensCapture module missing — run android:sync-native then rebuild.";
      setRows((p) => ({
        ...p,
        captureModule: { status: "err", detail: reason },
        wiringListener: { status: "err", detail: "Cannot check wiring without module." },
        permissionGranted: { status: "err", detail: "Module missing." },
        serviceWiring: { status: "err", detail: "Module missing." },
        serviceRunning: { status: "err", detail: "Module missing." },
      }));
    } else {
      setRows((p) => ({ ...p, captureModule: { status: "ok", detail: "NativeModules.ZenLensCapture exists." } }));

      // ── 2. ActivityEventListener wiring ────────────────────────────────────
      const wiring: PermissionWiringStatus | null = await checkPermissionWiring();
      if (!wiring) {
        setRows((p) => ({
          ...p,
          wiringListener: {
            status: "warn",
            detail: "Module found but checkWiring() missing — old APK. Rebuild with updated ScreenCaptureModule.kt.",
          },
        }));
      } else if (!wiring.activityListenerRegistered) {
        setRows((p) => ({
          ...p,
          wiringListener: {
            status: "warn",
            detail: "Module found, but ActivityEventListener not registered. Rebuild APK.",
          },
        }));
      } else {
        setRows((p) => ({
          ...p,
          wiringListener: {
            status: "ok",
            detail: `ActivityEventListener registered. requestCode=${wiring.requestCode}.`,
          },
        }));
      }

      // ── 3. Foreground service wiring ───────────────────────────────────────
      const hasServiceMethods =
        typeof captureModule.startCaptureService === "function" &&
        typeof captureModule.stopCaptureService === "function" &&
        typeof captureModule.getCaptureServiceStatus === "function";

      if (!hasServiceMethods) {
        setRows((p) => ({
          ...p,
          serviceWiring: {
            status: "warn",
            detail:
              "Native module found, but foreground service handoff is incomplete. " +
              "Rebuild APK with updated ScreenCaptureModule.kt (startCaptureService / stopCaptureService / getCaptureServiceStatus missing).",
          },
        }));
      } else {
        setRows((p) => ({
          ...p,
          serviceWiring: {
            status: "ok",
            detail: "startCaptureService / stopCaptureService / getCaptureServiceStatus all present.",
          },
        }));
      }

      // ── 3b. Single-frame capture wiring ────────────────────────────────────
      const hasSingleFrame = typeof captureModule.captureSingleFrame === "function";
      setRows((p) => ({
        ...p,
        singleFrameWiring: hasSingleFrame
          ? { status: "ok", detail: "captureSingleFrame() available — VirtualDisplay + ImageReader pipeline wired." }
          : { status: "warn", detail: "captureSingleFrame() missing — rebuild APK with updated ScreenCaptureModule.kt." },
      }));

      // ── 4. Live permission + service status ────────────────────────────────
      const liveStatus: CaptureServiceStatus | null = await getNativeCaptureServiceStatus();
      if (liveStatus) {
        setPermGranted(liveStatus.permissionGranted);
        setSvcRunning(liveStatus.serviceRunning);
        setRows((p) => ({
          ...p,
          permissionGranted: liveStatus.permissionGranted
            ? { status: "ok", detail: "MediaProjection token cached — ready to start service." }
            : { status: "err", detail: "No permission cached. Tap 'Test MediaProjection Permission' below." },
          serviceRunning: liveStatus.serviceRunning
            ? { status: "ok", detail: "ScreenCaptureService is running. Check Android notification bar." }
            : { status: "err", detail: "Service not running. Tap 'Test Foreground Capture Service' below." },
        }));
      } else {
        setRows((p) => ({
          ...p,
          permissionGranted: { status: "err", detail: "getCaptureServiceStatus() unavailable." },
          serviceRunning: { status: "err", detail: "getCaptureServiceStatus() unavailable." },
        }));
      }
    }

    // ── 5. ZenLensOverlay module ───────────────────────────────────────────────
    const overlayModule = (NativeModules as any).ZenLensOverlay;
    setRows((p) => ({
      ...p,
      overlayModule: overlayModule
        ? { status: "ok", detail: "NativeModules.ZenLensOverlay exists." }
        : { status: "err", detail: isExpoGo ? "Not available in Expo Go." : "Module missing — sync native files." },
    }));

    // ── 6. ML Kit OCR module ──────────────────────────────────────────────────
    const ocrModule = (NativeModules as any).ZenLensOCR;
    setRows((p) => ({
      ...p,
      ocrModule: ocrModule
        ? { status: "ok", detail: "NativeModules.ZenLensOCR exists." }
        : { status: "err", detail: isExpoGo ? "Not available in Expo Go." : "Module missing — add ML Kit dependency." },
    }));

    // ── 7. File export (always available in native build) ─────────────────────
    setRows((p) => ({
      ...p,
      fileExport: isExpoGo
        ? { status: "warn", detail: "Limited in Expo Go — full export available in native build." }
        : { status: "ok", detail: "expo-file-system + expo-sharing available." },
    }));
  }

  // ── Test handlers ──────────────────────────────────────────────────────────

  async function handleTestPermission() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isExpoGo) { setMpMsg("Not available in Expo Go."); setMpState("err"); return; }
    setMpState("busy");
    setMpMsg("Waiting for Android permission result…");
    const result = await requestNativeMediaProjectionPermission();
    if (!result) {
      setMpState("err");
      setMpMsg("ZenLensCapture module not found.");
      await refreshDebugStatus();
      return;
    }
    await refreshDebugStatus();
    if (result.granted) {
      setMpState("ok");
      setMpMsg("Permission granted ✓ — token cached. Start the service next.");
      setPermGranted(true);
      await pollServiceStatus();
    } else {
      setMpState("err");
      setMpMsg(result.reason ?? "Permission denied or cancelled.");
    }
  }

  async function handleStartService() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSvcState("busy"); setSvcMsg("");
    const result = await startNativeCaptureService();
    if (!result) { setSvcState("err"); setSvcMsg("startCaptureService() not found — rebuild APK."); return; }
    if (result.started) {
      setSvcState("ok");
      setSvcMsg("Service started ✓ — check the Android notification bar.");
      setSvcRunning(true);
      await pollServiceStatus();
    } else {
      setSvcState("err");
      setSvcMsg(result.reason ?? "Service failed to start.");
    }
  }

  async function handleStopService() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStopState("busy"); setStopMsg("");
    const result = await stopNativeCaptureService();
    if (!result) { setStopState("err"); setStopMsg("stopCaptureService() not found."); return; }
    if (result.stopped) {
      setStopState("ok");
      setStopMsg("Service stopped ✓ — token cleared. Next session requires new permission.");
      setSvcRunning(false); setPermGranted(false);
      setMpState("idle"); setMpMsg(""); setSvcState("idle"); setSvcMsg("");
      await pollServiceStatus();
    } else {
      setStopState("err");
      setStopMsg("Stop returned false — check logcat.");
    }
  }

  async function handleTestSingleFrame() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFrameState("busy"); setFrameMsg(""); setLastFrameResult(null);
    const result = await captureSingleNativeFrame();
    if (!result) {
      setFrameState("err");
      setFrameMsg("captureSingleFrame() not available — rebuild APK with updated ScreenCaptureModule.kt.");
      return;
    }
    setLastFrameResult(result);
    if (result.success) {
      setFrameState("ok");
      setFrameMsg(`Frame captured ✓ — ${result.width}×${result.height} · format=${result.pixelFormat}`);
    } else {
      setFrameState("err");
      setFrameMsg(result.reason);
    }
  }

  function btnColor(s: "idle" | "busy" | "ok" | "err") {
    return s === "ok" ? colors.success : s === "err" ? colors.destructive : colors.accent;
  }

  // ── Row definitions ────────────────────────────────────────────────────────

  const ROW_DEFS = [
    {
      key: "captureModule" as const,
      title: "ZenLensCapture Module",
      desc: "NativeModules.ZenLensCapture registered by ZenLensPackage.",
      icon: "radio",
    },
    {
      key: "wiringListener" as const,
      title: "MediaProjection Permission Wiring",
      desc: "ActivityEventListener registered — result from permission dialog reaches the module.",
      icon: "link",
    },
    {
      key: "permissionGranted" as const,
      title: "MediaProjection Permission Granted",
      desc: "User has granted screen recording for this session. Token cached in module.",
      icon: "shield",
    },
    {
      key: "serviceWiring" as const,
      title: "Foreground Capture Service Wiring",
      desc: "startCaptureService / stopCaptureService / getCaptureServiceStatus exposed.",
      icon: "cpu",
    },
    {
      key: "serviceRunning" as const,
      title: "Foreground Capture Service Running",
      desc: "ScreenCaptureService is active — persistent notification visible.",
      icon: "activity",
    },
    {
      key: "singleFrameWiring" as const,
      title: "Single-Frame Capture Wiring",
      desc: "captureSingleFrame() exposed — VirtualDisplay + ImageReader pipeline ready.",
      icon: "camera",
    },
    {
      key: "overlayModule" as const,
      title: "System Overlay Module",
      desc: "NativeModules.ZenLensOverlay registered (SYSTEM_ALERT_WINDOW overlay).",
      icon: "layers",
    },
    {
      key: "ocrModule" as const,
      title: "ML Kit OCR Module",
      desc: "NativeModules.ZenLensOCR registered (on-device text recognition).",
      icon: "type",
    },
    {
      key: "fileExport" as const,
      title: "File Export",
      desc: "expo-file-system + expo-sharing available.",
      icon: "share-2",
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

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
          <Text style={[styles.backText, { color: colors.mutedForeground }]}>Back</Text>
        </Pressable>

        {/* Title */}
        <View style={styles.titleBlock}>
          <View style={[styles.iconCircle, { backgroundColor: `${colors.primary}18` }]}>
            <Feather name="cpu" size={28} color={colors.primary} />
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>Device Readiness</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Live status of all native modules and the foreground service handoff path.
          </Text>
        </View>

        {/* Mode Banner */}
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
            <Text style={[styles.modeLabel, { color: isExpoGo ? colors.warning : colors.success }]}>
              {isExpoGo ? "Expo Go Demo Mode" : "Native Android Build"}
            </Text>
            <Text style={[styles.modeDesc, { color: colors.mutedForeground }]}>
              {isExpoGo
                ? "Native modules, MediaProjection, and the foreground service all require a native APK build. Build with: npm run android:apk"
                : "Running as a native build. All modules should be available below."}
            </Text>
          </View>
        </View>

        {/* Refresh */}
        <Pressable
          onPress={runChecks}
          style={({ pressed }) => [
            styles.refreshBtn,
            { backgroundColor: colors.secondary, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
          <Text style={[styles.refreshText, { color: colors.mutedForeground }]}>Refresh all checks</Text>
        </Pressable>

        {/* ── 8 status rows ──────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>Native Module Checklist</Text>

          {ROW_DEFS.map(({ key, title, desc, icon }) => {
            const row = rows[key];
            return (
              <View
                key={key}
                style={[
                  styles.checkRow,
                  {
                    backgroundColor: colors.card,
                    borderColor: statusBorder(row.status, colors),
                    borderWidth: row.status === "warn" ? 1.5 : 1,
                  },
                ]}
              >
                <View style={[styles.checkIcon, { backgroundColor: `${colors.primary}14` }]}>
                  <Feather name={icon as any} size={16} color={colors.primary} />
                </View>
                <View style={styles.checkContent}>
                  <Text style={[styles.checkTitle, { color: colors.foreground }]}>{title}</Text>
                  <Text style={[styles.checkDesc, { color: colors.mutedForeground }]}>{desc}</Text>
                  {row.detail ? (
                    <Text
                      style={[
                        styles.checkDetail,
                        {
                          color:
                            row.status === "ok"
                              ? colors.success
                              : row.status === "warn"
                                ? colors.warning
                                : colors.destructive,
                        },
                      ]}
                    >
                      {row.detail}
                    </Text>
                  ) : null}
                </View>
                <RowIcon status={row.status} colors={colors} />
              </View>
            );
          })}
        </View>

        {/* ── Native Handoff Test ────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
            Native Handoff Test
          </Text>
          <Text style={[styles.testHint, { color: colors.mutedForeground }]}>
            {isExpoGo
              ? "All four tests require a native APK build."
              : "Run in order: grant permission → start service → test single frame → stop service."}
          </Text>

          {/* Permission */}
          <Pressable
            onPress={handleTestPermission}
            disabled={mpState === "busy"}
            style={({ pressed }) => [
              styles.testBtn,
              {
                backgroundColor: mpState === "ok" ? `${colors.success}14` : mpState === "err" ? `${colors.destructive}14` : `${colors.primary}14`,
                borderColor: mpState === "ok" ? `${colors.success}44` : mpState === "err" ? `${colors.destructive}44` : `${colors.primary}44`,
                opacity: mpState === "busy" || pressed ? 0.7 : 1,
              },
            ]}
          >
            {mpState === "busy" ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="shield" size={15} color={btnColor(mpState)} />}
            <View style={{ flex: 1 }}>
              <Text style={[styles.testBtnLabel, { color: btnColor(mpState) }]}>Test MediaProjection Permission</Text>
              <Text style={[styles.testBtnSub, { color: mpMsg ? btnColor(mpState) : colors.mutedForeground }]}>
                {mpMsg || "Opens Android 'Start recording?' dialog"}
              </Text>
            </View>
          </Pressable>

          {/* Start service */}
          <Pressable
            onPress={handleStartService}
            disabled={svcState === "busy" || (!permGranted && !isExpoGo)}
            style={({ pressed }) => [
              styles.testBtn,
              {
                backgroundColor: svcState === "ok" ? `${colors.success}14` : svcState === "err" ? `${colors.destructive}14` : `${colors.primary}14`,
                borderColor: svcState === "ok" ? `${colors.success}44` : svcState === "err" ? `${colors.destructive}44` : `${colors.primary}44`,
                opacity: svcState === "busy" || (!permGranted && !isExpoGo) || pressed ? 0.45 : 1,
              },
            ]}
          >
            {svcState === "busy" ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="play-circle" size={15} color={btnColor(svcState)} />}
            <View style={{ flex: 1 }}>
              <Text style={[styles.testBtnLabel, { color: btnColor(svcState) }]}>Test Foreground Capture Service</Text>
              <Text style={[styles.testBtnSub, { color: svcMsg ? btnColor(svcState) : colors.mutedForeground }]}>
                {svcMsg || (permGranted ? "Starts ScreenCaptureService — check notification bar" : "Grant permission first")}
              </Text>
            </View>
          </Pressable>

          {/* Single frame capture */}
          <Pressable
            onPress={handleTestSingleFrame}
            disabled={frameState === "busy" || ((!permGranted || !svcRunning) && !isExpoGo)}
            style={({ pressed }) => [
              styles.testBtn,
              {
                backgroundColor: frameState === "ok" ? `${colors.success}14` : frameState === "err" ? `${colors.destructive}14` : `${colors.primary}14`,
                borderColor: frameState === "ok" ? `${colors.success}44` : frameState === "err" ? `${colors.destructive}44` : `${colors.primary}44`,
                opacity: frameState === "busy" || ((!permGranted || !svcRunning) && !isExpoGo) || pressed ? 0.45 : 1,
              },
            ]}
          >
            {frameState === "busy" ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="camera" size={15} color={btnColor(frameState)} />}
            <View style={{ flex: 1 }}>
              <Text style={[styles.testBtnLabel, { color: btnColor(frameState) }]}>Test Single Frame Capture</Text>
              <Text style={[styles.testBtnSub, { color: frameMsg ? btnColor(frameState) : colors.mutedForeground }]}>
                {frameMsg || (svcRunning
                  ? "Captures one frame via VirtualDisplay + ImageReader — metadata only"
                  : "Grant permission and start service first")}
              </Text>
              {lastFrameResult?.success && (
                <Text style={[styles.testBtnSub, { color: colors.success, marginTop: 2 }]}>
                  {`${lastFrameResult.width}×${lastFrameResult.height} · pixelFormat=${lastFrameResult.pixelFormat}`}
                </Text>
              )}
            </View>
          </Pressable>

          {/* Stop service */}
          <Pressable
            onPress={handleStopService}
            disabled={stopState === "busy" || (!svcRunning && !isExpoGo)}
            style={({ pressed }) => [
              styles.testBtn,
              {
                backgroundColor: stopState === "ok" ? `${colors.success}14` : stopState === "err" ? `${colors.destructive}14` : `${colors.primary}14`,
                borderColor: stopState === "ok" ? `${colors.success}44` : stopState === "err" ? `${colors.destructive}44` : `${colors.primary}44`,
                opacity: stopState === "busy" || (!svcRunning && !isExpoGo) || pressed ? 0.45 : 1,
              },
            ]}
          >
            {stopState === "busy" ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="stop-circle" size={15} color={btnColor(stopState)} />}
            <View style={{ flex: 1 }}>
              <Text style={[styles.testBtnLabel, { color: btnColor(stopState) }]}>Stop Capture Service</Text>
              <Text style={[styles.testBtnSub, { color: stopMsg ? btnColor(stopState) : colors.mutedForeground }]}>
                {stopMsg || (svcRunning ? "Stops service, clears token — notification disappears" : "Start service first")}
              </Text>
            </View>
          </Pressable>
        </View>

        {/* ── Native Debug Status ───────────────────────────────────────────── */}
        {!isExpoGo && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              Native Debug Status
            </Text>
            <Text style={[styles.testHint, { color: colors.mutedForeground }]}>
              Shows the last event and error recorded inside the native module.
              Persists across app resumes — check this after a crash or failed permission.
            </Text>

            <Pressable
              onPress={refreshDebugStatus}
              style={({ pressed }) => [
                styles.refreshBtn,
                { backgroundColor: colors.secondary, borderColor: colors.border, opacity: pressed ? 0.7 : 1, marginBottom: 4 },
              ]}
            >
              <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
              <Text style={[styles.refreshText, { color: colors.mutedForeground }]}>Refresh debug status</Text>
            </Pressable>

            <View style={[styles.debugPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {debugStatus == null ? (
                <Text style={[styles.debugRow, { color: colors.mutedForeground }]}>
                  {(NativeModules as any).ZenLensCapture
                    ? "Tap 'Refresh debug status' above to load."
                    : "ZenLensCapture module not loaded — native APK required."}
                </Text>
              ) : (
                <>
                  <View style={styles.debugLine}>
                    <Text style={[styles.debugKey, { color: colors.mutedForeground }]}>lastNativeEvent</Text>
                    <Text style={[styles.debugVal, { color: debugStatus.lastNativeEvent === "none" ? colors.mutedForeground : colors.foreground }]} selectable>
                      {debugStatus.lastNativeEvent || "none"}
                    </Text>
                  </View>
                  <View style={styles.debugLine}>
                    <Text style={[styles.debugKey, { color: colors.mutedForeground }]}>lastNativeError</Text>
                    <Text style={[styles.debugVal, { color: debugStatus.lastNativeError ? colors.destructive : colors.mutedForeground }]} selectable>
                      {debugStatus.lastNativeError || "none"}
                    </Text>
                  </View>
                  <View style={styles.debugLine}>
                    <Text style={[styles.debugKey, { color: colors.mutedForeground }]}>permissionInFlight</Text>
                    <Text style={[styles.debugVal, { color: debugStatus.permissionRequestInFlight ? colors.warning : colors.mutedForeground }]}>
                      {debugStatus.permissionRequestInFlight ? "true — waiting for dialog result" : "false"}
                    </Text>
                  </View>
                  <View style={styles.debugLine}>
                    <Text style={[styles.debugKey, { color: colors.mutedForeground }]}>permissionGranted</Text>
                    <Text style={[styles.debugVal, { color: debugStatus.permissionGranted ? colors.success : colors.mutedForeground }]}>
                      {debugStatus.permissionGranted ? "true" : "false"}
                    </Text>
                  </View>
                  <View style={styles.debugLine}>
                    <Text style={[styles.debugKey, { color: colors.mutedForeground }]}>hasProjectionToken</Text>
                    <Text style={[styles.debugVal, { color: debugStatus.hasProjectionToken ? colors.success : colors.mutedForeground }]}>
                      {debugStatus.hasProjectionToken ? "true" : "false"}
                    </Text>
                  </View>
                  <View style={[styles.debugLine, { borderBottomWidth: 0 }]}>
                    <Text style={[styles.debugKey, { color: colors.mutedForeground }]}>serviceRunning</Text>
                    <Text style={[styles.debugVal, { color: debugStatus.serviceRunning ? colors.success : colors.mutedForeground }]}>
                      {debugStatus.serviceRunning ? "true" : "false"}
                    </Text>
                  </View>
                </>
              )}
            </View>
          </View>
        )}

        {/* Build Guide */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>Build & Test Order</Text>
          <View style={[styles.buildGuide, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {[
              { n: "1", label: "Build APK", code: "npm run android:apk" },
              { n: "2", label: "Install on real Android device", code: "adb install zen-lens.apk" },
              { n: "3", label: "Open ZenLens → Device Readiness" },
              { n: "4", label: "Confirm ZenLensCapture module row shows ✓" },
              { n: "5", label: "Tap Test MediaProjection Permission", note: "Android dialog appears — tap 'Start now'" },
              { n: "6", label: "Tap Test Foreground Capture Service", note: "Persistent notification appears in status bar" },
              { n: "7", label: "Tap Stop Capture Service", note: "Notification disappears — token cleared" },
              { n: "8", label: "If all pass: next step is single-frame capture", note: "Do not add OCR yet" },
            ].map(({ n, label, code, note }) => (
              <View key={n} style={styles.buildStep}>
                <View style={[styles.stepNum, { backgroundColor: `${colors.primary}18` }]}>
                  <Text style={[styles.stepNumText, { color: colors.primary }]}>{n}</Text>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.stepLabel, { color: colors.foreground }]}>{label}</Text>
                  {code && (
                    <View style={[styles.codeBlock, { backgroundColor: colors.secondary }]}>
                      <Text style={[styles.code, { color: colors.accent }]} selectable>{code}</Text>
                    </View>
                  )}
                  {note && (
                    <Text style={[styles.stepNote, { color: colors.mutedForeground }]}>{note}</Text>
                  )}
                </View>
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
  iconCircle: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", textAlign: "center" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20, paddingHorizontal: 8 },
  modeBanner: { flexDirection: "row", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, alignItems: "flex-start" },
  modeLabel: { fontSize: 13, fontFamily: "Inter_700Bold", marginBottom: 3 },
  modeDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  refreshBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  refreshText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  section: { gap: 8 },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, textTransform: "uppercase", paddingHorizontal: 2 },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1 },
  checkIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkContent: { flex: 1, gap: 3 },
  checkTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  checkDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  checkDetail: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 4, lineHeight: 16 },
  testHint: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, paddingHorizontal: 2 },
  testBtn: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1 },
  testBtnLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 3 },
  testBtnSub: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  buildGuide: { padding: 16, borderRadius: 12, borderWidth: 1, gap: 14 },
  buildStep: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  stepNum: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  stepNumText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  stepLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  codeBlock: { padding: 8, borderRadius: 6 },
  code: { fontSize: 12, fontFamily: "Inter_400Regular" },
  stepNote: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
  debugPanel: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  debugRow: { fontSize: 12, fontFamily: "Inter_400Regular", padding: 14, lineHeight: 18 },
  debugLine: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(128,128,128,0.15)", gap: 8 },
  debugKey: { fontSize: 11, fontFamily: "Inter_500Medium", width: 150, flexShrink: 0, paddingTop: 1 },
  debugVal: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
});
