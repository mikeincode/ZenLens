/**
 * Expo config plugin — ZenLens native Android modules
 *
 * Runs automatically during `npx expo prebuild --platform android`.
 * It does three things:
 *   1. Copies all Kotlin modules from android-native/ into the generated
 *      android/app/src/main/java/com/zenlens/app/ directory.
 *   2. Patches AndroidManifest.xml with every permission and service declaration
 *      needed for MediaProjection, foreground service, and system overlay.
 *   3. Patches MainApplication.kt to register ZenLensPackage.
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

// ─── Step 1: Copy Kotlin files ─────────────────────────────────────────────

function withCopyKotlinModules(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const srcDir = path.join(projectRoot, "android-native");
      const destDir = path.join(
        projectRoot,
        "android",
        "app",
        "src",
        "main",
        "java",
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

// ─── Step 2: Patch AndroidManifest.xml ────────────────────────────────────

function withAndroidPermissionsAndService(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // Ensure uses-permission array exists
    if (!manifest["uses-permission"]) manifest["uses-permission"] = [];
    const perms = manifest["uses-permission"];

    const requiredPermissions = [
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.POST_NOTIFICATIONS",
    ];

    for (const perm of requiredPermissions) {
      const exists = perms.some(
        (p) => p.$?.["android:name"] === perm
      );
      if (!exists) {
        perms.push({ $: { "android:name": perm } });
        console.log(`[ZenLens] Added permission: ${perm}`);
      }
    }

    // Permissions with maxSdkVersion
    const versionedPerms = [
      { name: "android.permission.WRITE_EXTERNAL_STORAGE", maxSdkVersion: "28" },
      { name: "android.permission.READ_EXTERNAL_STORAGE", maxSdkVersion: "32" },
    ];
    for (const { name, maxSdkVersion } of versionedPerms) {
      const exists = perms.some((p) => p.$?.["android:name"] === name);
      if (!exists) {
        perms.push({
          $: { "android:name": name, "android:maxSdkVersion": maxSdkVersion },
        });
        console.log(`[ZenLens] Added permission: ${name} (maxSdkVersion=${maxSdkVersion})`);
      }
    }

    // Ensure <application> and <service> exist
    const application = manifest.application?.[0];
    if (!application) {
      console.warn("[ZenLens] WARNING: No <application> found in manifest — skipping service injection.");
      return cfg;
    }

    if (!application.service) application.service = [];
    const services = application.service;
    const serviceClass = ".ScreenCaptureService";
    const hasService = services.some(
      (s) => s.$?.["android:name"] === serviceClass
    );

    if (!hasService) {
      services.push({
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

// ─── Step 3: Patch MainApplication.kt ─────────────────────────────────────

function withRegisterZenLensPackage(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const mainAppPath = path.join(
        projectRoot,
        "android",
        "app",
        "src",
        "main",
        "java",
        ...PACKAGE_PATH.split("/"),
        "MainApplication.kt"
      );

      if (!fs.existsSync(mainAppPath)) {
        console.warn("[ZenLens] MainApplication.kt not found — skipping package registration patch.");
        return cfg;
      }

      let src = fs.readFileSync(mainAppPath, "utf8");

      // Already patched?
      if (src.includes("ZenLensPackage")) {
        console.log("[ZenLens] ZenLensPackage already registered in MainApplication.kt");
        return cfg;
      }

      // Add import after the first import line
      if (!src.includes("import com.zenlens.app.ZenLensPackage")) {
        src = src.replace(
          /^(import .+)$/m,
          `$1\nimport com.zenlens.app.ZenLensPackage`
        );
      }

      // Add add(ZenLensPackage()) inside getPackages()
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

// ─── Compose all three steps ───────────────────────────────────────────────

module.exports = function withZenLensNativeModules(config) {
  config = withCopyKotlinModules(config);
  config = withAndroidPermissionsAndService(config);
  config = withRegisterZenLensPackage(config);
  return config;
};
