/**
 * Expo config plugin — ZenLens native Android modules
 *
 * Runs automatically during `npx expo prebuild --platform android`.
 *
 * Steps:
 *   1. Copy all Kotlin modules from android-native/ into the generated Java source tree.
 *   2. Patch AndroidManifest.xml with permissions and ScreenCaptureService declaration.
 *   3. Patch MainApplication.kt to register ZenLensPackage.
 *   4. Patch MainActivity.kt to forward onActivityResult to ScreenCaptureModule
 *      as belt-and-suspenders alongside ScreenCaptureModule's ActivityEventListener.
 *
 * All steps are idempotent — running prebuild multiple times will not duplicate
 * any imports, methods, or declarations.
 */

const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PACKAGE_PATH = "com/zenlens/app";

const KT_FILES = [
  "ScreenCaptureModule.kt",
  "ScreenCaptureService.kt",
  "OverlayModule.kt",
  "MLKitOCRModule.kt",
  "ZenLensPackage.kt",
];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Insert `lines` before the closing brace of a Kotlin class body. */
function insertBeforeLastBrace(src, lines) {
  const lastBrace = src.lastIndexOf("}");
  if (lastBrace === -1) return src;
  return src.slice(0, lastBrace) + lines + "\n" + src.slice(lastBrace);
}

/** Ensure an import line exists; insert after the first existing import block. */
function ensureImport(src, importLine) {
  if (src.includes(importLine)) return src;
  // Find the last import line and insert after it
  const lastImportIdx = src.lastIndexOf("\nimport ");
  if (lastImportIdx === -1) {
    // No imports at all — insert after package declaration
    return src.replace(/^(package .+)$/m, `$1\n\n${importLine}`);
  }
  const lineEnd = src.indexOf("\n", lastImportIdx + 1);
  return src.slice(0, lineEnd + 1) + importLine + "\n" + src.slice(lineEnd + 1);
}

// ─── Step 1: Copy Kotlin files ───────────────────────────────────────────────

function withCopyKotlinModules(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const srcDir = path.join(projectRoot, "android-native");
      const destDir = path.join(
        projectRoot,
        "android", "app", "src", "main", "java",
        ...PACKAGE_PATH.split("/")
      );

      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      for (const file of KT_FILES) {
        const srcFile = path.join(srcDir, file);
        const destFile = path.join(destDir, file);
        if (!fs.existsSync(srcFile)) {
          console.warn(`[ZenLens] WARNING: ${file} not found in android-native/ — skipping.`);
          continue;
        }
        fs.copyFileSync(srcFile, destFile);
        console.log(`[ZenLens] Copied ${file} → android/app/src/main/java/${PACKAGE_PATH}/`);
      }

      return cfg;
    },
  ]);
}

// ─── Step 2: Patch AndroidManifest.xml ──────────────────────────────────────

function withAndroidPermissionsAndService(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    if (!manifest["uses-permission"]) manifest["uses-permission"] = [];
    const perms = manifest["uses-permission"];

    const requiredPermissions = [
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.POST_NOTIFICATIONS",
    ];

    for (const perm of requiredPermissions) {
      const exists = perms.some((p) => p.$?.["android:name"] === perm);
      if (!exists) {
        perms.push({ $: { "android:name": perm } });
        console.log(`[ZenLens] Added permission: ${perm}`);
      }
    }

    const versionedPerms = [
      { name: "android.permission.WRITE_EXTERNAL_STORAGE", maxSdkVersion: "28" },
      { name: "android.permission.READ_EXTERNAL_STORAGE", maxSdkVersion: "32" },
    ];
    for (const { name, maxSdkVersion } of versionedPerms) {
      const exists = perms.some((p) => p.$?.["android:name"] === name);
      if (!exists) {
        perms.push({ $: { "android:name": name, "android:maxSdkVersion": maxSdkVersion } });
        console.log(`[ZenLens] Added permission: ${name} (maxSdkVersion=${maxSdkVersion})`);
      }
    }

    const application = manifest.application?.[0];
    if (!application) {
      console.warn("[ZenLens] WARNING: No <application> in manifest — skipping service injection.");
      return cfg;
    }

    if (!application.service) application.service = [];
    const serviceClass = ".ScreenCaptureService";
    const hasService = application.service.some((s) => s.$?.["android:name"] === serviceClass);
    if (!hasService) {
      application.service.push({
        $: {
          "android:name": serviceClass,
          "android:foregroundServiceType": "mediaProjection",
          "android:exported": "false",
        },
      });
      console.log("[ZenLens] Added ScreenCaptureService to AndroidManifest.xml");
    }

    return cfg;
  });
}

// ─── Step 3: Patch MainApplication.kt — register ZenLensPackage ─────────────

function withRegisterZenLensPackage(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const mainAppPath = path.join(
        projectRoot,
        "android", "app", "src", "main", "java",
        ...PACKAGE_PATH.split("/"),
        "MainApplication.kt"
      );

      if (!fs.existsSync(mainAppPath)) {
        console.warn("[ZenLens] MainApplication.kt not found — skipping ZenLensPackage registration.");
        return cfg;
      }

      let src = fs.readFileSync(mainAppPath, "utf8");

      if (src.includes("ZenLensPackage")) {
        console.log("[ZenLens] ZenLensPackage already registered in MainApplication.kt");
        return cfg;
      }

      src = ensureImport(src, "import com.zenlens.app.ZenLensPackage");
      src = src.replace(
        /PackageList\(this\)\.packages\.apply\s*\{/,
        `PackageList(this).packages.apply {\n            add(ZenLensPackage())`
      );

      fs.writeFileSync(mainAppPath, src, "utf8");
      console.log("[ZenLens] Registered ZenLensPackage in MainApplication.kt");
      return cfg;
    },
  ]);
}

// ─── Step 4: Patch MainActivity.kt — forward onActivityResult ────────────────
//
// ScreenCaptureModule already implements ActivityEventListener (the primary path).
// This step adds an explicit onActivityResult override in MainActivity as a
// belt-and-suspenders measure.  ScreenCaptureModule.onMediaProjectionResult()
// is idempotent (resultHandled guard), so being called from both paths is safe.
//
// Idempotency guarantees:
//   • Checks for ZENLENS_ACTIVITY_RESULT_PATCH sentinel before patching
//   • Will never insert duplicate imports or method bodies
//   • Fails loudly if MainActivity format is unexpected (no class declaration)

const PATCH_SENTINEL = "// ZENLENS_ACTIVITY_RESULT_PATCH";

function withPatchMainActivity(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const mainActivityPath = path.join(
        projectRoot,
        "android", "app", "src", "main", "java",
        ...PACKAGE_PATH.split("/"),
        "MainActivity.kt"
      );

      if (!fs.existsSync(mainActivityPath)) {
        console.warn("[ZenLens] MainActivity.kt not found — skipping onActivityResult patch.");
        return cfg;
      }

      let src = fs.readFileSync(mainActivityPath, "utf8");

      // ── Idempotency guard ───────────────────────────────────────────────
      if (src.includes(PATCH_SENTINEL)) {
        console.log("[ZenLens] MainActivity.kt already patched (sentinel found) — skipping.");
        return cfg;
      }

      // ── Sanity check ────────────────────────────────────────────────────
      if (!src.includes("class MainActivity")) {
        throw new Error(
          "[ZenLens] FATAL: MainActivity.kt does not contain 'class MainActivity'. " +
          "File format is unexpected. Manual patching required. " +
          "See android-native/README.md for the required onActivityResult override."
        );
      }

      // ── Ensure required imports ─────────────────────────────────────────
      src = ensureImport(src, "import android.content.Intent");
      src = ensureImport(src, "import com.zenlens.app.ScreenCaptureModule");

      // ── Inject onActivityResult override ────────────────────────────────
      //
      // Inserted just before the closing brace of the MainActivity class.
      // The method calls super() first (so RN's ReactActivity forwarding fires,
      // which triggers ActivityEventListener), then also directly calls
      // onMediaProjectionResult() as an explicit fallback.

      const patch = `
    ${PATCH_SENTINEL}
    // Belt-and-suspenders: explicitly forward MediaProjection results to ScreenCaptureModule.
    // ScreenCaptureModule also implements ActivityEventListener (primary path).
    // onMediaProjectionResult() is idempotent — double-invocation is safe.
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == ScreenCaptureModule.MEDIA_PROJECTION_REQUEST) {
            reactInstanceManager
                ?.currentReactContext
                ?.getNativeModule(ScreenCaptureModule::class.java)
                ?.onMediaProjectionResult(resultCode, data)
        }
    }
`;

      src = insertBeforeLastBrace(src, patch);
      fs.writeFileSync(mainActivityPath, src, "utf8");
      console.log("[ZenLens] Patched MainActivity.kt with onActivityResult → ScreenCaptureModule forward");
      return cfg;
    },
  ]);
}

// ─── Step 5: Patch android/app/build.gradle — ML Kit dependency ──────────────

const MLKIT_DEP = 'implementation "com.google.mlkit:text-recognition:16.0.1"';
const MLKIT_COMMENT = "// ZenLens: Google ML Kit on-device text recognition";

function withMlKitDependency(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const buildGradlePath = path.join(projectRoot, "android", "app", "build.gradle");

      if (!fs.existsSync(buildGradlePath)) {
        console.warn("[ZenLens] android/app/build.gradle not found — skipping ML Kit injection.");
        return cfg;
      }

      let src = fs.readFileSync(buildGradlePath, "utf8");

      if (src.includes("text-recognition")) {
        console.log("[ZenLens] ML Kit text-recognition already in build.gradle — skipping.");
        return cfg;
      }

      // Insert after the first `implementation("com.facebook.react:react-android")` line
      src = src.replace(
        /implementation\("com\.facebook\.react:react-android"\)/,
        `implementation("com.facebook.react:react-android")\n\n    ${MLKIT_COMMENT}\n    ${MLKIT_DEP}`
      );

      fs.writeFileSync(buildGradlePath, src, "utf8");
      console.log("[ZenLens] Injected ML Kit text-recognition into android/app/build.gradle");
      return cfg;
    },
  ]);
}

// ─── Compose all five steps ───────────────────────────────────────────────────

module.exports = function withZenLensNativeModules(config) {
  config = withCopyKotlinModules(config);
  config = withAndroidPermissionsAndService(config);
  config = withRegisterZenLensPackage(config);
  config = withPatchMainActivity(config);
  config = withMlKitDependency(config);
  return config;
};
