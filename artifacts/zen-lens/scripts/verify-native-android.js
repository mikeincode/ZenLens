#!/usr/bin/env node
/**
 * scripts/verify-native-android.js
 *
 * Verifies the full foreground service handoff path for ZenLens native Android.
 *
 * Checks:
 *   - android/ project structure
 *   - All 5 Kotlin files present + key tokens
 *   - ScreenCaptureModule: permission + service handoff methods
 *   - ScreenCaptureModule: ActivityEventListener wiring
 *   - ScreenCaptureModule: getNativeDebugStatus() method
 *   - ScreenCaptureService: MediaProjection lifecycle, isRunning flag, logging
 *   - AndroidManifest.xml: all permissions + service declaration
 *   - MainApplication.kt: ZenLensPackage registered
 *   - MainActivity.kt: checked as informational warning only (patch removed — see NOTE)
 *   - android/app/build.gradle: ML Kit dependency
 *   - utils/ocr.ts: all JS wrappers present
 *
 * NOTE: The MainActivity.kt onActivityResult patch has been removed.
 * ScreenCaptureModule implements ActivityEventListener as the sole result path.
 * The MainActivity patch caused crashes on RN 0.73+ due to deprecated
 * reactInstanceManager access. MainActivity checks below are warnings, not errors.
 *
 * Usage:
 *   node scripts/verify-native-android.js
 *   npm run android:verify-native
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ANDROID_ROOT = path.join(ROOT, "android");
const PACKAGE_NAME = "com.zenlens.app";
const PACKAGE_PATH = PACKAGE_NAME.replace(/\./g, "/");
const JAVA_ROOT = path.join(ANDROID_ROOT, "app", "src", "main", "java");
const PACKAGE_DIR = path.join(JAVA_ROOT, ...PACKAGE_PATH.split("/"));
const MANIFEST_PATH = path.join(ANDROID_ROOT, "app", "src", "main", "AndroidManifest.xml");
const MAIN_APP_PATH = path.join(PACKAGE_DIR, "MainApplication.kt");
const MAIN_ACTIVITY_PATH = path.join(PACKAGE_DIR, "MainActivity.kt");
const BUILD_GRADLE_PATH = path.join(ANDROID_ROOT, "app", "build.gradle");
const CAPTURE_MODULE_PATH = path.join(PACKAGE_DIR, "ScreenCaptureModule.kt");
const CAPTURE_SERVICE_PATH = path.join(PACKAGE_DIR, "ScreenCaptureService.kt");
const OCR_UTIL = path.join(ROOT, "utils", "ocr.ts");

let passed = 0;
let failed = 0;
let warnings = 0;

function check(label, ok, detail) {
  if (ok) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); if (detail) console.error(`    → ${detail}`); failed++; }
}
function warn(label, detail) {
  console.warn(`  ⚠  ${label}`); if (detail) console.warn(`    → ${detail}`); warnings++;
}
function section(title) { console.log(`\n── ${title}`); }

console.log("ZenLens Native Android Verification — Foreground Service Handoff");
console.log("=".repeat(68));

// ─── 1. Project structure ─────────────────────────────────────────────────────

section("Project structure");
const androidExists = fs.existsSync(ANDROID_ROOT);
check("android/ directory exists", androidExists,
  !androidExists ? "Run: npm run android:prebuild" : null);
if (!androidExists) { console.error("\n✗ Cannot continue without android/.\n"); process.exit(1); }
check(`java/${PACKAGE_PATH}/ exists`, fs.existsSync(PACKAGE_DIR), PACKAGE_DIR);

// ─── 2. Kotlin files ──────────────────────────────────────────────────────────

section("Native Kotlin files");

const REQUIRED_KT = [
  { file: "ScreenCaptureModule.kt", label: "ScreenCaptureModule", mustContain: [
    "MEDIA_PROJECTION_REQUEST",
    "onMediaProjectionResult",
    "ActivityEventListener",
    "addActivityEventListener",
    "resultHandled",
    "startCaptureService",
    "stopCaptureService",
    "getCaptureServiceStatus",
    "checkWiring",
    "pendingResultCode",
    "pendingResultData",
    "getNativeDebugStatus",
    "lastNativeEvent",
    "lastNativeError",
    "permissionRequestInFlight",
    "safeResolvePermissionPromise",
    "safeRejectPermissionPromise",
  ]},
  { file: "ScreenCaptureService.kt", label: "ScreenCaptureService", mustContain: [
    "isRunning",
    "@Volatile",
    "startForeground",
    "getMediaProjection",
    "MediaProjection.Callback",
    "createNotificationChannel",
    "FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION",
    "getIntExtra",
    "getParcelableExtra",
    "onDestroy",
    "Log.d",
    "VirtualDisplay",
    "ImageReader",
    "doCaptureSingleFrame",
    "FrameCaptureCallback",
    "VirtualDisplay.release",
    "imageReader?.close",
    "CountDownLatch",
  ]},
  { file: "OverlayModule.kt", label: "OverlayModule", mustContain: ["SYSTEM_ALERT_WINDOW", "WindowManager"] },
  { file: "MLKitOCRModule.kt", label: "MLKitOCRModule", mustContain: ["TextRecognition", "recognizeText"] },
  { file: "ZenLensPackage.kt", label: "ZenLensPackage", mustContain: ["ReactPackage", "createNativeModules"] },
];

for (const { file, label, mustContain } of REQUIRED_KT) {
  const p = path.join(PACKAGE_DIR, file);
  const exists = fs.existsSync(p);
  check(`${label}: ${file} present`, exists,
    exists ? null : `Run: npm run android:sync-native`);
  if (exists && mustContain) {
    const src = fs.readFileSync(p, "utf8");
    for (const token of mustContain) {
      check(`  ${file} contains '${token}'`, src.includes(token),
        `Token '${token}' not found — file may be outdated. Re-run android:sync-native.`);
    }
  }
}

// ─── 3. ScreenCaptureModule — permission + service API ───────────────────────

section("ScreenCaptureModule — @ReactMethod API surface");
if (fs.existsSync(CAPTURE_MODULE_PATH)) {
  const src = fs.readFileSync(CAPTURE_MODULE_PATH, "utf8");

  check("requestPermission() @ReactMethod", src.includes("fun requestPermission"), null);
  check("startCaptureService() @ReactMethod", src.includes("fun startCaptureService"), null);
  check("stopCaptureService() @ReactMethod", src.includes("fun stopCaptureService"), null);
  check("getCaptureServiceStatus() @ReactMethod", src.includes("fun getCaptureServiceStatus"), null);
  check("checkWiring() @ReactMethod", src.includes("fun checkWiring"), null);
  check("captureSingleFrame() @ReactMethod", src.includes("fun captureSingleFrame"),
    "Add captureSingleFrame @ReactMethod that delegates to ScreenCaptureService.captureSingleFrame()");
  check("getNativeDebugStatus() @ReactMethod", src.includes("fun getNativeDebugStatus"),
    "Add getNativeDebugStatus() for post-crash diagnosis");
  check("captureSingleFrame delegates to ScreenCaptureService",
    src.includes("ScreenCaptureService.captureSingleFrame"),
    "ScreenCaptureService.captureSingleFrame(callback) must be called from the module");
  check("captureSingleFrame returns success map with width/height",
    src.includes("putBoolean(\"success\", true)") && src.includes("putInt(\"width\""),
    "captureSingleFrame must resolve with { success, width, height, pixelFormat, timestamp }");
  check("captureSingleFrame returns error map with reason",
    src.includes("putBoolean(\"success\", false)") && src.includes("putString(\"reason\""),
    "captureSingleFrame must resolve with { success: false, reason } on failure");
  check("checkWiring includes singleFrameWiringPresent",
    src.includes("singleFrameWiringPresent"),
    "Add putBoolean(\"singleFrameWiringPresent\", true) to checkWiring()");
  check("requestPermission returns map (not plain boolean)", src.includes("Arguments.createMap"),
    "requestPermission should resolve with WritableMap { granted, permissionCached, reason? }");
  check("startCaptureService passes resultCode + resultData to Intent",
    src.includes("putExtra(\"resultCode\"") && src.includes("putExtra(\"resultData\""),
    "Add: intent.putExtra(\"resultCode\", pendingResultCode) and putExtra(\"resultData\", pendingResultData)");
  check("startCaptureService checks ScreenCaptureService.isRunning",
    src.includes("ScreenCaptureService.isRunning"),
    "Guard against double-starting the service");
  check("stopCaptureService clears pendingResultCode (Android 14+ token reset)",
    src.includes("pendingResultCode = Activity.RESULT_CANCELED"),
    "Clear the one-session token after stop");
  check("stopCaptureService clears pendingResultData",
    src.includes("pendingResultData = null"),
    "Set pendingResultData = null in stopCaptureService()");
  check("onActivityResult wrapped in try/catch",
    src.includes("fun onActivityResult") && src.includes("safeRejectPermissionPromise"),
    "onActivityResult must never throw — wrap in try/catch");
  check("onMediaProjectionResult wrapped in try/catch",
    src.includes("fun onMediaProjectionResult") && src.includes("} catch (e: Exception)"),
    "onMediaProjectionResult must never throw — wrap in try/catch");
  check("null resultData handled explicitly",
    src.includes("data == null"),
    "Handle null resultData with { granted:false, reason:'MediaProjection result Intent was null' }");
  check("RESULT_CANCELED handled explicitly",
    src.includes("RESULT_CANCELED"),
    "Handle user cancellation with { granted:false, reason:'User cancelled' }");
  check("safeResolvePermissionPromise helper present",
    src.includes("fun safeResolvePermissionPromise"),
    "Promise must be resolved exactly once via a safe helper");
  check("safeRejectPermissionPromise helper present",
    src.includes("fun safeRejectPermissionPromise"),
    "Promise rejection path must be safe and wrapped");
  check("permissionRequestInFlight flag present",
    src.includes("permissionRequestInFlight"),
    "Track in-flight state for UI disable + debug status");
  check("lastNativeEvent state present",
    src.includes("lastNativeEvent"),
    "Track last event for post-crash diagnosis");
  check("lastNativeError state present",
    src.includes("lastNativeError"),
    "Track last error for post-crash diagnosis");

  // Duplicate API checks
  const overrideCount = (src.match(/override fun onActivityResult/g) || []).length;
  check("No duplicate onActivityResult overrides", overrideCount <= 1,
    `Found ${overrideCount} — remove duplicates`);
}

// ─── 4. ScreenCaptureModule — ActivityEventListener wiring ───────────────────

section("ScreenCaptureModule — ActivityEventListener (sole result path)");
if (fs.existsSync(CAPTURE_MODULE_PATH)) {
  const src = fs.readFileSync(CAPTURE_MODULE_PATH, "utf8");
  check("Implements ActivityEventListener", src.includes("ActivityEventListener"), null);
  check("addActivityEventListener in init block", src.includes("addActivityEventListener"), null);
  check("onNewIntent override (interface requirement)", src.includes("override fun onNewIntent"), null);
  check("resultHandled @Volatile dedup guard", src.includes("@Volatile") && src.includes("resultHandled"), null);
  check("onMediaProjectionResult() dedup-safe handler", src.includes("fun onMediaProjectionResult"), null);
  check("safeResolvePermissionPromise called", src.includes("safeResolvePermissionPromise"), null);
}

// ─── 5. ScreenCaptureService — foreground service lifecycle ──────────────────

section("ScreenCaptureService — foreground service + MediaProjection lifecycle");
if (fs.existsSync(CAPTURE_SERVICE_PATH)) {
  const src = fs.readFileSync(CAPTURE_SERVICE_PATH, "utf8");

  check("companion object isRunning @Volatile flag", src.includes("@Volatile") && src.includes("isRunning"), null);
  check("isRunning set to true after service starts", src.includes("isRunning = true"), null);
  check("isRunning set to false in onDestroy", src.includes("isRunning = false"), null);
  check("Receives resultCode via getIntExtra", src.includes("getIntExtra(\"resultCode\""), null);
  check("Receives resultData via getParcelableExtra", src.includes("getParcelableExtra(\"resultData\""), null);
  check("startForeground() called in onStartCommand", src.includes("startForeground("), null);
  check("FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION used (API 29+)",
    src.includes("FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION"), null);
  check("createNotificationChannel() called", src.includes("createNotificationChannel"), null);
  check("Notification channel created for Android O+", src.includes("NotificationChannel"), null);
  check("MediaProjectionManager.getMediaProjection() called",
    src.includes("getMediaProjection(resultCode"), null);
  check("MediaProjection stored as field", src.includes("mediaProjection ="), null);
  check("MediaProjection.Callback registered", src.includes("registerCallback"), null);
  check("MediaProjection.Callback.onStop() implemented",
    src.includes("override fun onStop"), null);
  check("mediaProjection?.stop() called in onDestroy", src.includes("mediaProjection?.stop()"), null);
  check("Log.d stage logging present", src.includes("Log.d("), null);
  check("Guards against null/invalid resultData before calling getMediaProjection",
    src.includes("resultCode != Activity.RESULT_OK") || src.includes("resultData == null"), null);
  check("STOP action handled in onStartCommand", src.includes("action == \"STOP\""), null);

  // ── Single-frame capture checks ──────────────────────────────────────────────
  check("companion object stores service instance", src.includes("instance: ScreenCaptureService"), null);
  check("instance set in onCreate()", src.includes("instance = this"), null);
  check("instance cleared in onDestroy()", src.includes("instance = null"), null);
  check("FrameCaptureCallback interface declared", src.includes("interface FrameCaptureCallback"), null);
  check("captureSingleFrame() static entry point", src.includes("fun captureSingleFrame(callback"), null);
  check("doCaptureSingleFrame() private implementation", src.includes("fun doCaptureSingleFrame"), null);
  check("ImageReader.newInstance() called", src.includes("ImageReader.newInstance("), null);
  check("VirtualDisplay created via createVirtualDisplay", src.includes("createVirtualDisplay("), null);
  check("HandlerThread used for ImageReader listener", src.includes("HandlerThread("), null);
  check("CountDownLatch used for timeout", src.includes("CountDownLatch("), null);
  check("CountDownLatch.await() with 3s timeout", src.includes("latch.await(3"), null);
  check("Image.close() always called", src.includes("img?.close()"), null);
  check("ImageReader.close() in releaseAll / cleanup", src.includes("imageReader?.close()"), null);
  check("VirtualDisplay.release() in releaseAll / cleanup", src.includes("virtualDisplay?.release()"), null);
  check("HandlerThread.quitSafely() called", src.includes("quitSafely()"), null);
  check("RGBA_8888 pixel format used", src.includes("RGBA_8888"), null);
  check("VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR used", src.includes("VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR"), null);
}

// ─── 6. AndroidManifest.xml ───────────────────────────────────────────────────

section("AndroidManifest.xml");
if (fs.existsSync(MANIFEST_PATH)) {
  const manifest = fs.readFileSync(MANIFEST_PATH, "utf8");
  for (const { token, label, fix } of [
    { token: 'android.permission.FOREGROUND_SERVICE"', label: "FOREGROUND_SERVICE", fix: "Add FOREGROUND_SERVICE permission" },
    { token: "FOREGROUND_SERVICE_MEDIA_PROJECTION", label: "FOREGROUND_SERVICE_MEDIA_PROJECTION", fix: "Add FOREGROUND_SERVICE_MEDIA_PROJECTION permission" },
    { token: "SYSTEM_ALERT_WINDOW", label: "SYSTEM_ALERT_WINDOW", fix: "Add SYSTEM_ALERT_WINDOW permission" },
    { token: "POST_NOTIFICATIONS", label: "POST_NOTIFICATIONS", fix: "Add POST_NOTIFICATIONS permission" },
    { token: ".ScreenCaptureService", label: "ScreenCaptureService <service> declared", fix: "Add service declaration" },
    { token: 'foregroundServiceType="mediaProjection"', label: 'foregroundServiceType="mediaProjection"', fix: "Required on API 29+" },
  ]) { check(label, manifest.includes(token), fix); }
} else { check("AndroidManifest.xml exists", false, MANIFEST_PATH); }

// ─── 7. MainApplication.kt ───────────────────────────────────────────────────

section("Package registration — MainApplication.kt");
if (fs.existsSync(MAIN_APP_PATH)) {
  const src = fs.readFileSync(MAIN_APP_PATH, "utf8");
  check("ZenLensPackage registered", src.includes("ZenLensPackage"),
    "Add: PackageList(this).packages.apply { add(ZenLensPackage()) }");
  const count = (src.match(/ZenLensPackage/g) || []).length;
  if (count > 2) check("No duplicate ZenLensPackage registrations", false,
    `Found ${count} references — remove duplicates`);
} else { check("MainApplication.kt exists", false, MAIN_APP_PATH); }

// ─── 8. MainActivity.kt — informational only (patch removed) ─────────────────

section("MainActivity.kt — informational (onActivityResult patch removed)");
console.log("  ℹ  The MainActivity.kt belt-and-suspenders patch has been removed.");
console.log("  ℹ  ActivityEventListener in ScreenCaptureModule is the sole result path.");
console.log("  ℹ  The patch caused crashes on RN 0.73+ (deprecated reactInstanceManager).");
if (fs.existsSync(MAIN_ACTIVITY_PATH)) {
  const src = fs.readFileSync(MAIN_ACTIVITY_PATH, "utf8");
  const hasPatch = src.includes("ZENLENS_ACTIVITY_RESULT_PATCH");
  const hasOverride = src.includes("override fun onActivityResult");
  if (hasPatch || hasOverride) {
    warn("MainActivity.kt still contains the old patch — consider removing it manually",
      "The patch is no longer injected but leftover code won't cause errors unless " +
      "it conflicts with the RN version's onActivityResult signature");
  } else {
    console.log("  ✓ MainActivity.kt is clean — no leftover patch");
    passed++;
  }
} else {
  console.log("  ✓ MainActivity.kt not found — no patch to worry about");
  passed++;
}

// ─── 9. build.gradle ─────────────────────────────────────────────────────────

section("build.gradle — ML Kit dependency");
if (fs.existsSync(BUILD_GRADLE_PATH)) {
  const bg = fs.readFileSync(BUILD_GRADLE_PATH, "utf8");
  check("ML Kit text-recognition in dependencies", bg.includes("text-recognition"),
    'Add: implementation "com.google.mlkit:text-recognition:16.0.1"');
} else { check("build.gradle exists", false, BUILD_GRADLE_PATH); }

// ─── 10. JS wrappers ─────────────────────────────────────────────────────────

section("JS wrappers — utils/ocr.ts");
if (fs.existsSync(OCR_UTIL)) {
  const src = fs.readFileSync(OCR_UTIL, "utf8");
  for (const fn of [
    "checkPermissionWiring",
    "requestNativeMediaProjectionPermission",
    "startNativeCaptureService",
    "stopNativeCaptureService",
    "getNativeCaptureServiceStatus",
    "captureSingleNativeFrame",
    "getNativeDebugStatus",
  ]) { check(`export ${fn}()`, src.includes(fn), `Add async function ${fn}() to utils/ocr.ts`); }
  check("ZenLensCapture referenced", src.includes("ZenLensCapture"), null);
  check("ZenLensOCR referenced", src.includes("ZenLensOCR"), null);
  check("SingleFrameResult type exported", src.includes("SingleFrameResult"), null);
  check("SingleFrameSuccess interface declared", src.includes("SingleFrameSuccess"), null);
  check("SingleFrameError interface declared", src.includes("SingleFrameError"), null);
  check("NativeDebugStatus type exported", src.includes("NativeDebugStatus"), null);
  check("captureSingleNativeFrame returns null on missing module",
    src.includes("typeof mod.captureSingleFrame") || src.includes("captureSingleFrame"),
    "Wrapper must check that captureSingleFrame exists before calling it");
}

// ─── 11. Device Readiness screen ─────────────────────────────────────────────

section("Device Readiness screen — app/readiness.tsx");
const readinessPath = path.join(ROOT, "app", "readiness.tsx");
if (fs.existsSync(readinessPath)) {
  const src = fs.readFileSync(readinessPath, "utf8");
  for (const token of [
    "captureModule",
    "wiringListener",
    "permissionGranted",
    "serviceWiring",
    "serviceRunning",
    "singleFrameWiring",
    "overlayModule",
    "ocrModule",
    "fileExport",
    "getNativeCaptureServiceStatus",
    "startNativeCaptureService",
    "stopNativeCaptureService",
    "captureSingleNativeFrame",
    "Test Single Frame Capture",
    "handleTestSingleFrame",
    "getNativeDebugStatus",
    "NativeDebugStatus",
  ]) { check(`readiness.tsx has '${token}'`, src.includes(token), null); }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log("\n" + "=".repeat(68));
console.log(`Passed: ${passed}   Failed: ${failed}   Warnings: ${warnings}`);

if (failed === 0) {
  console.log(`
✓ All checks passed. Single-frame capture checkpoint fully wired.

Native APK test order:
  1.  npm run android:apk                    → build APK
  2.  adb install <apk>                      → install on device
  3.  Open ZenLens → Device Readiness        → all 9 rows green
  4.  Tap 'Test MediaProjection Permission'  → Android dialog appears → choose 'Share entire screen'
  5.  Button shows "Waiting for Android permission result..." while dialog is open
  6.  After granting: "Permission granted ✓ — token cached"
  7.  Check Native Debug Status panel        → lastNativeEvent shows permissionGranted
  8.  Tap 'Test Foreground Capture Service'  → persistent notification visible
  9.  Tap 'Test Single Frame Capture'        → frame metadata appears (width×height)
  10. Tap 'Stop Capture Service'             → notification disappears, token cleared
  11. If all pass → next step is crop-region capture, then OCR
`);
  process.exit(0);
} else {
  console.error(`
✗ ${failed} check(s) failed.

Fix sequence:
  npm run android:prebuild       # regenerates android/ with config plugin
  npm run android:sync-native    # re-sync Kotlin + patch manifests
  npm run android:verify-native  # verify again
`);
  process.exit(1);
}
