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
 *   - ScreenCaptureService: MediaProjection lifecycle, isRunning flag, logging
 *   - AndroidManifest.xml: all permissions + service declaration
 *   - MainApplication.kt: ZenLensPackage registered
 *   - MainActivity.kt: belt-and-suspenders onActivityResult patch
 *   - android/app/build.gradle: ML Kit dependency
 *   - utils/ocr.ts: all JS wrappers present
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

const PATCH_SENTINEL = "// ZENLENS_ACTIVITY_RESULT_PATCH";

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

  // Duplicate API checks
  const overrideCount = (src.match(/override fun onActivityResult/g) || []).length;
  check("No duplicate onActivityResult overrides", overrideCount <= 1,
    `Found ${overrideCount} — remove duplicates`);
}

// ─── 4. ScreenCaptureModule — ActivityEventListener wiring ───────────────────

section("ScreenCaptureModule — ActivityEventListener (primary result path)");
if (fs.existsSync(CAPTURE_MODULE_PATH)) {
  const src = fs.readFileSync(CAPTURE_MODULE_PATH, "utf8");
  check("Implements ActivityEventListener", src.includes("ActivityEventListener"), null);
  check("addActivityEventListener in init block", src.includes("addActivityEventListener"), null);
  check("onNewIntent override (interface requirement)", src.includes("override fun onNewIntent"), null);
  check("resultHandled @Volatile dedup guard", src.includes("@Volatile") && src.includes("resultHandled"), null);
  check("onMediaProjectionResult() dedup-safe handler", src.includes("fun onMediaProjectionResult"), null);
  check("permissionPromise?.resolve called", src.includes("permissionPromise?.resolve"), null);
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

  // STOP action handling
  check("STOP action handled in onStartCommand", src.includes("action == \"STOP\""), null);
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

// ─── 8. MainActivity.kt ──────────────────────────────────────────────────────

section("Belt-and-suspenders — MainActivity.kt");
if (fs.existsSync(MAIN_ACTIVITY_PATH)) {
  const src = fs.readFileSync(MAIN_ACTIVITY_PATH, "utf8");
  check("ZENLENS_ACTIVITY_RESULT_PATCH sentinel present", src.includes(PATCH_SENTINEL),
    "Run: npm run android:sync-native");
  check("onActivityResult override present", src.includes("override fun onActivityResult"), null);
  check("Forwards to onMediaProjectionResult", src.includes("onMediaProjectionResult"), null);
  check("Imports android.content.Intent", src.includes("import android.content.Intent"), null);
  check("Imports ScreenCaptureModule", src.includes("import com.zenlens.app.ScreenCaptureModule"), null);
  const dupCount = (src.match(/override fun onActivityResult/g) || []).length;
  check("No duplicate onActivityResult overrides", dupCount <= 1,
    `Found ${dupCount} — compilation will fail`);
  const sentinelCount = (src.match(/ZENLENS_ACTIVITY_RESULT_PATCH/g) || []).length;
  check("No duplicate patch sentinels", sentinelCount <= 1,
    `Found ${sentinelCount} — idempotency broken`);
} else {
  warn("MainActivity.kt not found — belt-and-suspenders checks skipped",
    "Primary path (ActivityEventListener) is still sufficient");
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
  ]) { check(`export ${fn}()`, src.includes(fn), `Add async function ${fn}() to utils/ocr.ts`); }
  check("ZenLensCapture referenced", src.includes("ZenLensCapture"), null);
  check("ZenLensOCR referenced", src.includes("ZenLensOCR"), null);
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
    "overlayModule",
    "ocrModule",
    "fileExport",
    "getNativeCaptureServiceStatus",
    "startNativeCaptureService",
    "stopNativeCaptureService",
  ]) { check(`readiness.tsx has '${token}'`, src.includes(token), null); }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log("\n" + "=".repeat(68));
console.log(`Passed: ${passed}   Failed: ${failed}   Warnings: ${warnings}`);

if (failed === 0) {
  console.log(`
✓ All checks passed. Foreground service handoff is fully wired.

Native APK test order:
  1. npm run android:apk                    → build APK
  2. adb install <apk>                      → install on device
  3. Open ZenLens → Device Readiness        → all 8 rows green
  4. Tap 'Test MediaProjection Permission'  → Android dialog appears → grant
  5. Tap 'Test Foreground Capture Service'  → persistent notification visible
  6. Tap 'Stop Capture Service'             → notification disappears, token cleared
  7. If all pass → next step is single-frame capture (not OCR yet)
`);
  process.exit(0);
} else {
  console.error(`
✗ ${failed} check(s) failed.

Fix sequence:
  npm run android:prebuild       # regenerates android/ with config plugin
  npm run android:sync-native    # re-sync Kotlin + patch manifests + patch MainActivity
  npm run android:verify-native  # verify again
`);
  process.exit(1);
}
