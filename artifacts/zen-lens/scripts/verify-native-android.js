#!/usr/bin/env node
/**
 * scripts/verify-native-android.js
 *
 * Verifies that after prebuild + native sync, the Android project contains
 * all modules, permissions, and wiring required for real MediaProjection capture.
 *
 * Fails loudly with exact instructions if anything is missing.
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

const PATCH_SENTINEL = "// ZENLENS_ACTIVITY_RESULT_PATCH";

let passed = 0;
let failed = 0;
let warnings = 0;

function check(label, ok, detail) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    if (detail) console.error(`    → ${detail}`);
    failed++;
  }
}

function warn(label, detail) {
  console.warn(`  ⚠  ${label}`);
  if (detail) console.warn(`    → ${detail}`);
  warnings++;
}

function section(title) {
  console.log(`\n── ${title}`);
}

console.log("ZenLens Native Android Verification");
console.log("=".repeat(60));

// ─── 1. android/ directory ────────────────────────────────────────────────────

section("Project structure");

const androidExists = fs.existsSync(ANDROID_ROOT);
check(
  "android/ directory exists",
  androidExists,
  !androidExists ? "Run: npm run android:prebuild" : null
);

if (!androidExists) {
  console.error(`\n✗ Cannot continue without android/ directory.\n`);
  process.exit(1);
}

check(
  `android/app/src/main/java/${PACKAGE_PATH}/ exists`,
  fs.existsSync(PACKAGE_DIR),
  `Expected: ${PACKAGE_DIR}`
);

// ─── 2. Kotlin source files ───────────────────────────────────────────────────

section("Native Kotlin modules (file presence + content tokens)");

const REQUIRED_KT = [
  {
    file: "ScreenCaptureModule.kt",
    label: "ScreenCaptureModule (MediaProjection capture)",
    mustContain: [
      "MEDIA_PROJECTION_REQUEST",
      "startCapture",
      "onMediaProjectionResult",
      "captureFrame",
    ],
  },
  {
    file: "ScreenCaptureService.kt",
    label: "ScreenCaptureService (foreground service)",
    mustContain: ["Service", "startForeground"],
  },
  {
    file: "OverlayModule.kt",
    label: "OverlayModule (SYSTEM_ALERT_WINDOW overlay)",
    mustContain: ["SYSTEM_ALERT_WINDOW", "WindowManager"],
  },
  {
    file: "MLKitOCRModule.kt",
    label: "MLKitOCRModule (Google ML Kit OCR)",
    mustContain: ["TextRecognition", "recognizeText"],
  },
  {
    file: "ZenLensPackage.kt",
    label: "ZenLensPackage (ReactPackage registration)",
    mustContain: ["ReactPackage", "createNativeModules"],
  },
];

for (const { file, label, mustContain } of REQUIRED_KT) {
  const filePath = path.join(PACKAGE_DIR, file);
  const exists = fs.existsSync(filePath);
  check(
    `${label}: ${file} present`,
    exists,
    exists ? null : `Run: npm run android:sync-native`
  );

  if (exists && mustContain) {
    const src = fs.readFileSync(filePath, "utf8");
    for (const token of mustContain) {
      check(
        `  ${file} contains '${token}'`,
        src.includes(token),
        `Token '${token}' not found — file may be corrupted or outdated`
      );
    }
  }
}

// ─── 3. MediaProjection permission wiring (PRIMARY PATH) ─────────────────────
//
// ScreenCaptureModule implements ActivityEventListener — RN's built-in mechanism
// for receiving onActivityResult.  These checks verify that wiring is correct.

section("MediaProjection permission wiring — ScreenCaptureModule (primary path)");

if (fs.existsSync(CAPTURE_MODULE_PATH)) {
  const src = fs.readFileSync(CAPTURE_MODULE_PATH, "utf8");

  check(
    "ScreenCaptureModule implements ActivityEventListener",
    src.includes("ActivityEventListener"),
    "Add ', ActivityEventListener' to the class declaration and implement the interface"
  );

  check(
    "ActivityEventListener registered in init block",
    src.includes("addActivityEventListener"),
    "Add 'reactContext.addActivityEventListener(this)' in an init { } block"
  );

  check(
    "onMediaProjectionResult() dedup guard method present",
    src.includes("onMediaProjectionResult"),
    "Add 'fun onMediaProjectionResult(resultCode: Int, data: Intent?)' with resultHandled guard"
  );

  check(
    "resultHandled deduplication guard variable present",
    src.includes("resultHandled"),
    "Add '@Volatile private var resultHandled = false' to prevent double-resolution"
  );

  check(
    "onActivityResult override (ActivityEventListener) present",
    src.includes("override fun onActivityResult"),
    "Implement 'override fun onActivityResult(activity, requestCode, resultCode, data)' from ActivityEventListener"
  );

  check(
    "onNewIntent override present (required by ActivityEventListener)",
    src.includes("override fun onNewIntent"),
    "Add 'override fun onNewIntent(intent: Intent?) {}' — required by ActivityEventListener interface"
  );

  check(
    "permissionPromise resolved in onMediaProjectionResult",
    src.includes("permissionPromise?.resolve"),
    "onMediaProjectionResult() must call permissionPromise?.resolve(true/false)"
  );

  check(
    "checkWiring() @ReactMethod present",
    src.includes("fun checkWiring"),
    "Add @ReactMethod checkWiring(promise: Promise) that returns wiring status map"
  );

  check(
    "mediaProjection stored after grant",
    src.includes("mediaProjectionManager?.getMediaProjection"),
    "Store mediaProjection in onMediaProjectionResult so startCapture() can use it"
  );

  // Duplicate guard — should NOT have multiple onActivityResult declarations
  const occurrences = (src.match(/override fun onActivityResult/g) || []).length;
  check(
    "No duplicate onActivityResult overrides in ScreenCaptureModule",
    occurrences <= 1,
    `Found ${occurrences} onActivityResult declarations — remove duplicates`
  );
} else {
  check("ScreenCaptureModule.kt exists", false, CAPTURE_MODULE_PATH);
}

// ─── 4. MediaProjection permission wiring (SECONDARY PATH) ───────────────────
//
// MainActivity.kt is patched with an explicit onActivityResult override that
// calls ScreenCaptureModule.onMediaProjectionResult() as belt-and-suspenders.

section("MediaProjection permission wiring — MainActivity.kt (belt-and-suspenders)");

if (fs.existsSync(MAIN_ACTIVITY_PATH)) {
  const src = fs.readFileSync(MAIN_ACTIVITY_PATH, "utf8");

  check(
    "MainActivity.kt exists",
    true,
    null
  );

  check(
    "ZENLENS_ACTIVITY_RESULT_PATCH sentinel present (idempotency marker)",
    src.includes(PATCH_SENTINEL),
    "Run: npm run android:sync-native  (or npm run android:prebuild to re-run config plugin)"
  );

  check(
    "MainActivity has onActivityResult override",
    src.includes("override fun onActivityResult"),
    "The config plugin should inject this — run: npm run android:prebuild"
  );

  check(
    "MainActivity forwards to ScreenCaptureModule.onMediaProjectionResult",
    src.includes("onMediaProjectionResult"),
    "The onActivityResult override must call module?.onMediaProjectionResult(resultCode, data)"
  );

  check(
    "MainActivity imports android.content.Intent",
    src.includes("import android.content.Intent"),
    "Add: import android.content.Intent"
  );

  check(
    "MainActivity imports ScreenCaptureModule",
    src.includes("import com.zenlens.app.ScreenCaptureModule"),
    "Add: import com.zenlens.app.ScreenCaptureModule"
  );

  // Duplicate guard — only one onActivityResult should exist
  const activityResultCount = (src.match(/override fun onActivityResult/g) || []).length;
  check(
    "No duplicate onActivityResult overrides in MainActivity",
    activityResultCount <= 1,
    `Found ${activityResultCount} onActivityResult declarations — duplicates will cause compile error`
  );

  // Duplicate imports guard
  const sentinelCount = (src.match(/ZENLENS_ACTIVITY_RESULT_PATCH/g) || []).length;
  check(
    "No duplicate ZENLENS patch sentinels",
    sentinelCount <= 1,
    `Found ${sentinelCount} sentinels — prebuild has been applied more than once to the same file`
  );

} else {
  warn(
    "MainActivity.kt not found — skipping belt-and-suspenders checks",
    "Primary path (ActivityEventListener) is sufficient; MainActivity patch is optional"
  );
}

// ─── 5. AndroidManifest.xml ───────────────────────────────────────────────────

section("AndroidManifest.xml");

if (fs.existsSync(MANIFEST_PATH)) {
  const manifest = fs.readFileSync(MANIFEST_PATH, "utf8");

  const requiredEntries = [
    {
      token: 'android.permission.FOREGROUND_SERVICE"',
      label: "FOREGROUND_SERVICE permission",
      fix: '<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>',
    },
    {
      token: "FOREGROUND_SERVICE_MEDIA_PROJECTION",
      label: "FOREGROUND_SERVICE_MEDIA_PROJECTION permission",
      fix: '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION"/>',
    },
    {
      token: "SYSTEM_ALERT_WINDOW",
      label: "SYSTEM_ALERT_WINDOW permission",
      fix: '<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>',
    },
    {
      token: "POST_NOTIFICATIONS",
      label: "POST_NOTIFICATIONS permission (Android 13+)",
      fix: '<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>',
    },
    {
      token: ".ScreenCaptureService",
      label: "ScreenCaptureService <service> declaration",
      fix: '<service android:name=".ScreenCaptureService" android:foregroundServiceType="mediaProjection" android:exported="false"/>',
    },
    {
      token: 'foregroundServiceType="mediaProjection"',
      label: 'ScreenCaptureService foregroundServiceType="mediaProjection" (required API 29+)',
      fix: 'Add android:foregroundServiceType="mediaProjection" to the <service> tag',
    },
  ];

  for (const { token, label, fix } of requiredEntries) {
    check(label, manifest.includes(token), fix);
  }
} else {
  check("AndroidManifest.xml exists", false, MANIFEST_PATH);
}

// ─── 6. MainApplication.kt — package registration ────────────────────────────

section("Package registration (MainApplication.kt)");

if (fs.existsSync(MAIN_APP_PATH)) {
  const src = fs.readFileSync(MAIN_APP_PATH, "utf8");
  check(
    "ZenLensPackage registered in MainApplication.kt",
    src.includes("ZenLensPackage"),
    "Add inside getPackages(): PackageList(this).packages.apply { add(ZenLensPackage()) }"
  );
  // Duplicate check
  const count = (src.match(/ZenLensPackage/g) || []).length;
  if (count > 2) { // import + add() = 2
    check(
      "No duplicate ZenLensPackage registrations",
      false,
      `Found ${count} ZenLensPackage references — may cause duplicate module registration`
    );
  }
} else {
  check("MainApplication.kt exists", false, MAIN_APP_PATH);
}

// ─── 7. build.gradle — ML Kit dependency ─────────────────────────────────────

section("build.gradle dependencies");

if (fs.existsSync(BUILD_GRADLE_PATH)) {
  const buildGradle = fs.readFileSync(BUILD_GRADLE_PATH, "utf8");
  check(
    "ML Kit text-recognition dependency in android/app/build.gradle",
    buildGradle.includes("text-recognition"),
    'Add to dependencies block: implementation "com.google.mlkit:text-recognition:16.0.1"'
  );
} else {
  check("android/app/build.gradle exists", false, BUILD_GRADLE_PATH);
}

// ─── 8. JS-side cross-reference ──────────────────────────────────────────────

section("JS-side module name cross-reference");

const OCR_UTIL = path.join(ROOT, "utils", "ocr.ts");
if (fs.existsSync(OCR_UTIL)) {
  const ocrSrc = fs.readFileSync(OCR_UTIL, "utf8");
  check("utils/ocr.ts references ZenLensCapture", ocrSrc.includes("ZenLensCapture"), null);
  check("utils/ocr.ts references ZenLensOCR", ocrSrc.includes("ZenLensOCR"), null);
  check(
    "utils/ocr.ts has checkPermissionWiring export",
    ocrSrc.includes("checkPermissionWiring"),
    "Add export async function checkPermissionWiring() to utils/ocr.ts"
  );
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log("\n" + "=".repeat(60));
console.log(`Passed: ${passed}   Failed: ${failed}   Warnings: ${warnings}`);

if (failed === 0) {
  console.log(`
✓ All checks passed. ZenLens is ready for a native APK build.

  npm run android:apk           → EAS preview APK
  npm run android:run           → local USB device build

After installing on device:
  Home → Device Readiness       → all rows ✓
  Home → Native Capture Test    → Android shows "Start recording?" dialog
                                  → tap "Start now" → "Native capture granted ✓"
`);
  process.exit(0);
} else {
  console.error(`
✗ ${failed} check(s) failed.

Quick fix sequence:
  npm run android:prebuild          # regenerates android/ and runs config plugin
  npm run android:sync-native       # re-sync Kotlin files + patch manifest + patch MainActivity
  npm run android:verify-native     # verify again
`);
  process.exit(1);
}
