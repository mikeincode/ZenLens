#!/usr/bin/env node
/**
 * scripts/sync-native-android.js
 *
 * Standalone fallback that replicates everything the config plugin does.
 * Use this when you want to re-sync Kotlin files or re-patch native files
 * without running a full expo prebuild.
 *
 * Steps:
 *   1. Copy Kotlin modules from android-native/ into the Android source tree
 *   2. Patch AndroidManifest.xml (permissions + ScreenCaptureService)
 *   3. Patch MainApplication.kt (register ZenLensPackage)
 *   4. Report ML Kit dependency status
 *
 * NOTE: MainActivity.kt patching (belt-and-suspenders onActivityResult forward)
 * has been removed. ScreenCaptureModule implements ActivityEventListener as the
 * sole result path. The MainActivity patch caused crashes on RN 0.73+ because it
 * accessed the deprecated reactInstanceManager property.
 *
 * All steps are idempotent — running this script multiple times will not
 * duplicate any code, imports, or declarations.
 *
 * Usage:
 *   node scripts/sync-native-android.js
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
const DEST_JAVA = path.join(
  ANDROID_ROOT, "app", "src", "main", "java",
  ...PACKAGE_PATH.split("/")
);
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

/** Ensure an import line exists; add after the last existing import. */
function ensureImport(src, importLine) {
  if (src.includes(importLine)) return src;
  const lastImportIdx = src.lastIndexOf("\nimport ");
  if (lastImportIdx === -1) {
    return src.replace(/^(package .+)$/m, `$1\n\n${importLine}`);
  }
  const lineEnd = src.indexOf("\n", lastImportIdx + 1);
  return src.slice(0, lineEnd + 1) + importLine + "\n" + src.slice(lineEnd + 1);
}

// ─── Guard: android/ must exist ──────────────────────────────────────────────

section("Checking android/ directory");

if (!fs.existsSync(ANDROID_ROOT)) {
  console.error(`
✗ android/ directory not found at:
  ${ANDROID_ROOT}

Run prebuild first:
  npm run android:prebuild

Then re-run this script.
`);
  process.exit(1);
}
ok("android/ directory exists");

// ─── Step 1: Copy Kotlin files ────────────────────────────────────────────────

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

// ─── Step 2: Patch AndroidManifest.xml ───────────────────────────────────────

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

  if (!manifest.includes("android.permission.WRITE_EXTERNAL_STORAGE")) {
    const tag = `    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28"/>\n`;
    manifest = manifest.replace("<application", `${tag}<application`);
    ok("Added WRITE_EXTERNAL_STORAGE");
    changed = true;
  } else {
    ok("Permission present: WRITE_EXTERNAL_STORAGE");
  }

  if (!manifest.includes("android.permission.READ_EXTERNAL_STORAGE")) {
    const tag = `    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32"/>\n`;
    manifest = manifest.replace("<application", `${tag}<application`);
    ok("Added READ_EXTERNAL_STORAGE");
    changed = true;
  } else {
    ok("Permission present: READ_EXTERNAL_STORAGE");
  }

  const serviceDecl = `android:name=".ScreenCaptureService"`;
  if (!manifest.includes(serviceDecl)) {
    const serviceTag = `
        <service
            android:name=".ScreenCaptureService"
            android:foregroundServiceType="mediaProjection"
            android:exported="false"/>`;
    manifest = manifest.replace("</application>", `${serviceTag}\n    </application>`);
    ok("Added ScreenCaptureService declaration");
    changed = true;
  } else {
    ok("ScreenCaptureService already declared");
  }

  if (changed) {
    fs.writeFileSync(MANIFEST_PATH, manifest, "utf8");
    ok("AndroidManifest.xml written");
  }
}

// ─── Step 3: Patch MainApplication.kt ────────────────────────────────────────

section("Patching MainApplication.kt");

if (!fs.existsSync(MAIN_APP_PATH)) {
  warn(`MainApplication.kt not found — skipping. Add ZenLensPackage manually.`);
} else {
  let src = fs.readFileSync(MAIN_APP_PATH, "utf8");

  if (src.includes("ZenLensPackage")) {
    ok("ZenLensPackage already registered");
  } else {
    // Duplicate guard: count before patching
    const before = (src.match(/ZenLensPackage/g) || []).length;

    src = ensureImport(src, "import com.zenlens.app.ZenLensPackage");
    src = src.replace(
      /PackageList\(this\)\.packages\.apply\s*\{/,
      `PackageList(this).packages.apply {\n            add(ZenLensPackage())`
    );

    const after = (src.match(/ZenLensPackage/g) || []).length;
    if (after !== before + 2) {  // import + add() = 2 new occurrences
      warn("ZenLensPackage insertion may be off — verify MainApplication.kt manually");
    }

    fs.writeFileSync(MAIN_APP_PATH, src, "utf8");
    ok("Registered ZenLensPackage in MainApplication.kt");
  }
}

// ─── Step 4: ML Kit dependency status ────────────────────────────────────────

section("ML Kit dependency");

const MLKIT_DEP = 'implementation "com.google.mlkit:text-recognition:16.0.1"';
const MLKIT_COMMENT = "// ZenLens: Google ML Kit on-device text recognition";

const buildGradlePath = path.join(ANDROID_ROOT, "app", "build.gradle");
if (!fs.existsSync(buildGradlePath)) {
  warn("android/app/build.gradle not found — run android:prebuild first");
} else {
  let buildGradle = fs.readFileSync(buildGradlePath, "utf8");
  if (buildGradle.includes("text-recognition")) {
    ok("ML Kit text-recognition already in android/app/build.gradle");
  } else {
    buildGradle = buildGradle.replace(
      /implementation\("com\.facebook\.react:react-android"\)/,
      `implementation("com.facebook.react:react-android")\n\n    ${MLKIT_COMMENT}\n    ${MLKIT_DEP}`
    );
    fs.writeFileSync(buildGradlePath, buildGradle, "utf8");
    ok("Injected ML Kit text-recognition into android/app/build.gradle");
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log("\n" + "─".repeat(60));
if (errors > 0) {
  console.error(`\n✗ Sync completed with ${errors} error(s) and ${warnings} warning(s).`);
  console.error("  Fix errors above before building the APK.\n");
  process.exit(1);
} else if (warnings > 0) {
  console.warn(`\n⚠  Sync completed with ${warnings} warning(s). Review above.`);
  console.log("  Next: npm run android:verify-native\n");
} else {
  console.log(`\n✓ All native files synced successfully.`);
  console.log("  Next: npm run android:verify-native\n");
}
