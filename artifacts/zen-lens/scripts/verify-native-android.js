#!/usr/bin/env node
/**
 * scripts/verify-native-android.js
 *
 * Verifies that after prebuild + native sync, the Android project contains
 * all the native modules required for real MediaProjection capture.
 *
 * Fails loudly with exact instructions if anything is missing.
 *
 * Usage:
 *   node scripts/verify-native-android.js
 *   # or via npm script:
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
const BUILD_GRADLE_PATH = path.join(ANDROID_ROOT, "app", "build.gradle");

let passed = 0;
let failed = 0;

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

function section(title) {
  console.log(`\n── ${title}`);
}

console.log("ZenLens Native Android Verification");
console.log("=".repeat(60));

// ─── 1. android/ directory ─────────────────────────────────────────────────

section("Project structure");

const androidExists = fs.existsSync(ANDROID_ROOT);
check(
  "android/ directory exists",
  androidExists,
  !androidExists
    ? "Run: npx expo prebuild --platform android (from artifacts/zen-lens/)"
    : null
);

if (!androidExists) {
  console.error(`\n✗ Cannot continue without android/ directory.\n`);
  process.exit(1);
}

check(
  "android/app/src/main/java/" + PACKAGE_PATH + "/ exists",
  fs.existsSync(PACKAGE_DIR),
  `Expected: ${PACKAGE_DIR}`
);

// ─── 2. Kotlin source files ────────────────────────────────────────────────

section("Native Kotlin modules");

const REQUIRED_KT = [
  {
    file: "ScreenCaptureModule.kt",
    label: "ScreenCaptureModule (MediaProjection capture)",
    nativeKey: "ZenLensCapture",
    mustContain: ["MEDIA_PROJECTION_REQUEST", "startCapture", "handlePermissionResult"],
  },
  {
    file: "ScreenCaptureService.kt",
    label: "ScreenCaptureService (foreground service)",
    mustContain: ["Service", "startForeground"],
  },
  {
    file: "OverlayModule.kt",
    label: "OverlayModule (SYSTEM_ALERT_WINDOW overlay)",
    nativeKey: "ZenLensOverlay",
    mustContain: ["SYSTEM_ALERT_WINDOW", "WindowManager"],
  },
  {
    file: "MLKitOCRModule.kt",
    label: "MLKitOCRModule (Google ML Kit OCR)",
    nativeKey: "ZenLensOCR",
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
    exists
      ? null
      : `Missing: ${filePath}\n    Run: npm run android:sync-native`
  );

  if (exists && mustContain) {
    const src = fs.readFileSync(filePath, "utf8");
    for (const token of mustContain) {
      check(
        `  ${file} contains '${token}'`,
        src.includes(token),
        `Token '${token}' not found — file may be incomplete or corrupted`
      );
    }
  }
}

// ─── 3. AndroidManifest.xml ────────────────────────────────────────────────

section("AndroidManifest.xml");

if (fs.existsSync(MANIFEST_PATH)) {
  const manifest = fs.readFileSync(MANIFEST_PATH, "utf8");

  const requiredEntries = [
    {
      token: "android.permission.FOREGROUND_SERVICE\"",
      label: "FOREGROUND_SERVICE permission",
      fix: 'Add: <uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>',
    },
    {
      token: "FOREGROUND_SERVICE_MEDIA_PROJECTION",
      label: "FOREGROUND_SERVICE_MEDIA_PROJECTION permission",
      fix: 'Add: <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION"/>',
    },
    {
      token: "SYSTEM_ALERT_WINDOW",
      label: "SYSTEM_ALERT_WINDOW permission",
      fix: 'Add: <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>',
    },
    {
      token: "POST_NOTIFICATIONS",
      label: "POST_NOTIFICATIONS permission (Android 13+)",
      fix: 'Add: <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>',
    },
    {
      token: ".ScreenCaptureService",
      label: "ScreenCaptureService <service> declaration",
      fix: 'Add inside <application>:\n    <service android:name=".ScreenCaptureService" android:foregroundServiceType="mediaProjection" android:exported="false"/>',
    },
    {
      token: 'foregroundServiceType="mediaProjection"',
      label: 'ScreenCaptureService foregroundServiceType="mediaProjection"',
      fix: "Add android:foregroundServiceType=\"mediaProjection\" to the <service> tag — required on Android 10+ (API 29+)",
    },
  ];

  for (const { token, label, fix } of requiredEntries) {
    check(label, manifest.includes(token), fix);
  }
} else {
  check("AndroidManifest.xml exists", false, MANIFEST_PATH);
}

// ─── 4. MainApplication.kt — package registration ─────────────────────────

section("Package registration");

if (fs.existsSync(MAIN_APP_PATH)) {
  const src = fs.readFileSync(MAIN_APP_PATH, "utf8");
  check(
    "ZenLensPackage registered in MainApplication.kt",
    src.includes("ZenLensPackage"),
    "Add inside getPackages():\n    PackageList(this).packages.apply { add(ZenLensPackage()) }"
  );
} else {
  check(
    "MainApplication.kt exists",
    false,
    MAIN_APP_PATH
  );
}

// ─── 5. build.gradle — ML Kit dependency ──────────────────────────────────

section("build.gradle dependencies");

if (fs.existsSync(BUILD_GRADLE_PATH)) {
  const buildGradle = fs.readFileSync(BUILD_GRADLE_PATH, "utf8");
  check(
    "ML Kit text-recognition dependency",
    buildGradle.includes("text-recognition"),
    'Add to android/app/build.gradle dependencies:\n    implementation "com.google.mlkit:text-recognition:16.0.1"'
  );
} else {
  check("android/app/build.gradle exists", false, BUILD_GRADLE_PATH);
}

// ─── 6. Module JS name cross-reference ────────────────────────────────────

section("JS-side module name cross-reference");

const OCR_UTIL = path.join(ROOT, "utils", "ocr.ts");
if (fs.existsSync(OCR_UTIL)) {
  const ocrSrc = fs.readFileSync(OCR_UTIL, "utf8");
  check("ocr.ts references ZenLensCapture", ocrSrc.includes("ZenLensCapture"), null);
  check("ocr.ts references ZenLensOCR", ocrSrc.includes("ZenLensOCR"), null);
}

// ─── Summary ──────────────────────────────────────────────────────────────

console.log("\n" + "=".repeat(60));
console.log(`Passed: ${passed}   Failed: ${failed}`);

if (failed === 0) {
  console.log(`
✓ All checks passed. ZenLens is ready for a native APK build.

Next steps:
  1. eas login                              (first time only)
  2. npm run android:apk                   (builds APK via EAS)
  3. Install the downloaded APK on device
  4. Open ZenLens → Device Readiness → verify all 4 rows are ✓
`);
  process.exit(0);
} else {
  console.error(`
✗ ${failed} check(s) failed. Fix the issues above, then re-run:
  npm run android:verify-native

Quick fix commands:
  npm run android:prebuild      # re-run expo prebuild
  npm run android:sync-native   # copy Kotlin files + patch manifest
  npm run android:verify-native # verify again
`);
  process.exit(1);
}
