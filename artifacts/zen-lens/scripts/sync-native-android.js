#!/usr/bin/env node
/**
 * scripts/sync-native-android.js
 *
 * Standalone fallback script that replicates what the config plugin does,
 * useful if you need to re-sync after editing Kotlin files without re-running
 * a full prebuild.
 *
 * Usage:
 *   node scripts/sync-native-android.js
 *   # or via npm script:
 *   npm run android:sync-native
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ANDROID_ROOT = path.join(ROOT, "android");
const NATIVE_SRC = path.join(ROOT, "android-native");

const PACKAGE_NAME = "com.zenlens.app";
const PACKAGE_PATH = PACKAGE_NAME.replace(/\./g, "/");
const DEST_JAVA = path.join(ANDROID_ROOT, "app", "src", "main", "java", ...PACKAGE_PATH.split("/"));
const MANIFEST_PATH = path.join(ANDROID_ROOT, "app", "src", "main", "AndroidManifest.xml");
const MAIN_APP_PATH = path.join(DEST_JAVA, "MainApplication.kt");

const KT_FILES = [
  "ScreenCaptureModule.kt",
  "ScreenCaptureService.kt",
  "OverlayModule.kt",
  "MLKitOCRModule.kt",
  "ZenLensPackage.kt",
];

let errors = 0;
let warnings = 0;

function ok(msg) { console.log(`  ✓ ${msg}`); }
function warn(msg) { console.warn(`  ⚠  ${msg}`); warnings++; }
function fail(msg) { console.error(`  ✗ ${msg}`); errors++; }
function section(title) { console.log(`\n── ${title}`); }

// ─── Guard: android/ must exist ───────────────────────────────────────────

section("Checking android/ directory");

if (!fs.existsSync(ANDROID_ROOT)) {
  console.error(`
✗ android/ directory not found at:
  ${ANDROID_ROOT}

Run prebuild first:
  cd artifacts/zen-lens
  npx expo prebuild --platform android

Then re-run this script.
`);
  process.exit(1);
}
ok("android/ directory exists");

// ─── Step 1: Copy Kotlin files ─────────────────────────────────────────────

section("Copying Kotlin native modules");

if (!fs.existsSync(DEST_JAVA)) {
  fs.mkdirSync(DEST_JAVA, { recursive: true });
  ok(`Created ${DEST_JAVA}`);
}

for (const file of KT_FILES) {
  const src = path.join(NATIVE_SRC, file);
  const dest = path.join(DEST_JAVA, file);
  if (!fs.existsSync(src)) {
    fail(`${file} not found in android-native/`);
    continue;
  }
  fs.copyFileSync(src, dest);
  ok(`Copied ${file}`);
}

// ─── Step 2: Patch AndroidManifest.xml ────────────────────────────────────

section("Patching AndroidManifest.xml");

if (!fs.existsSync(MANIFEST_PATH)) {
  fail(`AndroidManifest.xml not found at ${MANIFEST_PATH}`);
} else {
  let manifest = fs.readFileSync(MANIFEST_PATH, "utf8");
  let changed = false;

  const requiredPermissions = [
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION",
    "android.permission.SYSTEM_ALERT_WINDOW",
    "android.permission.POST_NOTIFICATIONS",
  ];

  for (const perm of requiredPermissions) {
    if (!manifest.includes(perm)) {
      const tag = `    <uses-permission android:name="${perm}"/>\n`;
      manifest = manifest.replace("<application", `${tag}<application`);
      ok(`Added permission: ${perm}`);
      changed = true;
    } else {
      ok(`Permission present: ${perm}`);
    }
  }

  // Versioned permissions
  if (!manifest.includes("android.permission.WRITE_EXTERNAL_STORAGE")) {
    const tag = `    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28"/>\n`;
    manifest = manifest.replace("<application", `${tag}<application`);
    ok("Added WRITE_EXTERNAL_STORAGE (maxSdkVersion=28)");
    changed = true;
  } else {
    ok("Permission present: WRITE_EXTERNAL_STORAGE");
  }

  if (!manifest.includes("android.permission.READ_EXTERNAL_STORAGE")) {
    const tag = `    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32"/>\n`;
    manifest = manifest.replace("<application", `${tag}<application`);
    ok("Added READ_EXTERNAL_STORAGE (maxSdkVersion=32)");
    changed = true;
  } else {
    ok("Permission present: READ_EXTERNAL_STORAGE");
  }

  // ScreenCaptureService declaration
  const serviceDecl = `android:name=".ScreenCaptureService"`;
  if (!manifest.includes(serviceDecl)) {
    const serviceTag = `
        <service
            android:name=".ScreenCaptureService"
            android:foregroundServiceType="mediaProjection"
            android:exported="false"/>`;
    manifest = manifest.replace("</application>", `${serviceTag}\n    </application>`);
    ok("Added ScreenCaptureService to manifest");
    changed = true;
  } else {
    ok("ScreenCaptureService already declared");
  }

  if (changed) {
    fs.writeFileSync(MANIFEST_PATH, manifest, "utf8");
    ok("AndroidManifest.xml written");
  }
}

// ─── Step 3: Patch MainApplication.kt ─────────────────────────────────────

section("Patching MainApplication.kt");

if (!fs.existsSync(MAIN_APP_PATH)) {
  warn(`MainApplication.kt not found at ${MAIN_APP_PATH} — package registration skipped.`);
  warn("You may need to add ZenLensPackage manually (see android-native/README.md).");
} else {
  let src = fs.readFileSync(MAIN_APP_PATH, "utf8");

  if (src.includes("ZenLensPackage")) {
    ok("ZenLensPackage already registered");
  } else {
    // Add import
    if (!src.includes("import com.zenlens.app.ZenLensPackage")) {
      src = src.replace(
        /^(import .+)$/m,
        `$1\nimport com.zenlens.app.ZenLensPackage`
      );
    }
    // Patch getPackages()
    src = src.replace(
      /PackageList\(this\)\.packages\.apply\s*\{/,
      `PackageList(this).packages.apply {\n            add(ZenLensPackage())`
    );
    fs.writeFileSync(MAIN_APP_PATH, src, "utf8");
    ok("Registered ZenLensPackage in MainApplication.kt");
  }
}

// ─── Step 4: Add ML Kit dependency note ───────────────────────────────────

section("ML Kit dependency");

const buildGradlePath = path.join(ANDROID_ROOT, "app", "build.gradle");
if (fs.existsSync(buildGradlePath)) {
  const buildGradle = fs.readFileSync(buildGradlePath, "utf8");
  if (buildGradle.includes("text-recognition")) {
    ok("ML Kit text-recognition already in build.gradle");
  } else {
    warn("ML Kit text-recognition NOT found in android/app/build.gradle");
    warn("Add this to the dependencies block:");
    warn('  implementation "com.google.mlkit:text-recognition:16.0.1"');
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────

console.log("\n" + "─".repeat(60));
if (errors > 0) {
  console.error(`\n✗ Sync completed with ${errors} error(s) and ${warnings} warning(s).`);
  console.error("  Fix the errors above before building the APK.\n");
  process.exit(1);
} else if (warnings > 0) {
  console.warn(`\n⚠  Sync completed with ${warnings} warning(s). Review above.`);
  console.log("  Next: npm run android:verify-native\n");
} else {
  console.log(`\n✓ All native files synced successfully.`);
  console.log("  Next: npm run android:verify-native\n");
}
