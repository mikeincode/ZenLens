# ZenLens — Android Native Modules

This folder contains the native Android (Kotlin) modules required for real screen capture,
floating overlay, and on-device OCR. These modules **cannot run in Expo Go** — they require
a custom development build or a production APK.

---

## Modules

| Module | JS Name | Purpose |
|---|---|---|
| `ScreenCaptureModule.kt` | `NativeModules.ZenLensCapture` | MediaProjection screen capture + frame crop |
| `ScreenCaptureService.kt` | — | Foreground service (Android requirement for screen capture) |
| `OverlayModule.kt` | `NativeModules.ZenLensOverlay` | SYSTEM_ALERT_WINDOW floating control |
| `MLKitOCRModule.kt` | `NativeModules.ZenLensOCR` | Google ML Kit text recognition (on-device) |
| `ZenLensPackage.kt` | — | ReactPackage that registers all four modules |

---

## Quick-check: Are native modules loaded?

In the running app: **Home → Device Readiness** shows a live checklist of which
`NativeModules.*` keys are registered. All four must show ✓ for real capture to work.

---

## Integration Steps

### Step 1 — Prebuild (eject to bare workflow)

Native modules require a custom `android/` directory. Generate it once:

```bash
cd artifacts/zen-lens
npx expo prebuild --platform android --clean
```

This creates `android/` alongside `app/`. Do **not** run this again unless you want to
regenerate and lose manual edits to the `android/` folder.

---

### Step 2 — Copy Kotlin files

After prebuild, copy all five `.kt` files from this folder into the generated Android source tree:

```
android/app/src/main/java/com/zenlens/app/
├── ScreenCaptureModule.kt
├── ScreenCaptureService.kt
├── OverlayModule.kt
├── MLKitOCRModule.kt
└── ZenLensPackage.kt
```

The package name at the top of each file (`package com.zenlens.app`) must match
the `android.package` value in `app.json`. If you changed the package name during
prebuild, update the `package` declaration in all five `.kt` files to match.

---

### Step 3 — Register ZenLensPackage

Open `android/app/src/main/java/com/zenlens/app/MainApplication.kt` and add
the package to `getPackages()`:

```kotlin
import com.zenlens.app.ZenLensPackage  // add this import

override fun getPackages(): List<ReactPackage> =
    PackageList(this).packages.apply {
        add(ZenLensPackage())            // add this line
    }
```

---

### Step 4 — Add ML Kit dependency

Open `android/app/build.gradle` and add to the `dependencies` block:

```groovy
dependencies {
    // ... existing entries ...

    // ML Kit text recognition (on-device, no network)
    implementation 'com.google.mlkit:text-recognition:16.0.1'
}
```

To bundle the model in the APK (eliminates first-run ~4 MB download):

```groovy
apply plugin: 'com.google.mlkit.vision.textrecognition'
```

---

### Step 5 — Update AndroidManifest.xml

Open `android/app/src/main/AndroidManifest.xml` and add inside `<manifest>`:

```xml
<!-- Screen capture / foreground service -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION"/>

<!-- System overlay (floating control while ZenLens runs in background) -->
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>

<!-- Notifications — required for foreground service on Android 13+ -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>

<!-- File export (legacy external storage, API ≤ 28/32 only) -->
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"
    android:maxSdkVersion="28"/>
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"
    android:maxSdkVersion="32"/>
```

Inside the `<application>` block, declare the foreground service:

```xml
<service
    android:name=".ScreenCaptureService"
    android:foregroundServiceType="mediaProjection"
    android:exported="false"/>
```

> `foregroundServiceType="mediaProjection"` is **required** on API 29+. Without it,
> Android will crash the service on start with a `MissingForegroundServiceTypeException`.

---

### Step 6 — Handle MediaProjection result in MainActivity

The system delivers the MediaProjection grant back through `onActivityResult`.
Open `android/app/src/main/java/com/zenlens/app/MainActivity.kt`:

```kotlin
import android.content.Intent
import com.zenlens.app.ScreenCaptureModule

class MainActivity : ReactActivity() {
    // ... existing code ...

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == ScreenCaptureModule.MEDIA_PROJECTION_REQUEST) {
            reactInstanceManager
                .currentReactContext
                ?.getNativeModule(ScreenCaptureModule::class.java)
                ?.handlePermissionResult(resultCode, data)
        }
    }
}
```

---

### Step 7 — minSdkVersion

In `android/build.gradle` (root), ensure:

```groovy
buildscript {
    ext {
        minSdkVersion = 21   // MediaProjection requires API 21+
        targetSdkVersion = 34
    }
}
```

---

## Building and Running

### Development build — run directly on a connected Android device

```bash
# From the artifacts/zen-lens directory:
npx expo run:android
```

This builds a debug APK and installs it on any connected device (via USB, with
USB debugging enabled). It opens a Metro bundler connection so JS hot reloads still work.

### Development APK — install without a computer (shareable debug build)

```bash
cd android
./gradlew assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

### Release APK via EAS Build (recommended for testing/sharing)

Install EAS CLI if not already installed:

```bash
npm install -g eas-cli
eas login
```

Configure EAS (first time only):

```bash
eas build:configure
```

Build a release APK (signed, installable on any Android device):

```bash
eas build --platform android --profile preview
```

The `preview` profile in `eas.json` should be:

```json
{
  "build": {
    "preview": {
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "android": {
        "buildType": "aab"
      }
    }
  }
}
```

The EAS dashboard provides a download link and QR code for the APK once the build
completes (~5–10 minutes).

---

## Verifying native modules loaded

After installing the dev build or APK on a real device, open ZenLens and navigate to:

**Home → Device Readiness**

All four rows should show a green ✓:
- MediaProjection Capture (`NativeModules.ZenLensCapture`)
- ML Kit OCR (`NativeModules.ZenLensOCR`)
- System Overlay (`NativeModules.ZenLensOverlay`)
- File Export (always available in native build)

If any row shows ✗, check:
1. The `.kt` file is in the correct package directory
2. `ZenLensPackage` is registered in `MainApplication.kt`
3. The build was rebuilt after adding the files (`npx expo run:android` again)

---

## Simulation Mode (Expo Go)

When running in Expo Go (no native modules registered), ZenLens automatically falls back to
**simulation mode**:
- The home screen shows a yellow "Expo Go Demo Mode" banner
- `requestPermission()` always returns `true` after a brief delay
- `captureFrame()` is never called; `recognizeTextFromCrop()` in `utils/ocr.ts`
  returns pre-written sample text that scrolls progressively across 10 pages
- The crop box, dedupe logic, transcript auto-save, and all export actions are fully functional
- Device Readiness screen shows all modules as ✗ (unavailable)

This allows complete UI and logic testing without a physical Android device.

---

## Known Limitations

1. **Expo Go incompatibility** — MediaProjection, SYSTEM_ALERT_WINDOW, and ML Kit require
   a custom build. Expo Go sandboxes native modules and `NativeModules.ZenLens*` will
   always be `undefined`.

2. **Android 10+ foreground service type** — `foregroundServiceType="mediaProjection"` is
   required on API 29+. Without it, `startForeground()` throws on start.

3. **Overlay permission UX** — `SYSTEM_ALERT_WINDOW` cannot be requested via the standard
   `ActivityCompat.requestPermissions()` flow. The user must be sent to
   `Settings.ACTION_MANAGE_OVERLAY_PERMISSION` manually. The Setup screen handles this.

4. **Screen rotation** — `screenWidth`/`screenHeight` in `ScreenCaptureModule` are captured
   at the time `startCapture()` is called. If the device rotates mid-session, the virtual
   display dimensions may mismatch the actual screen. Stop and restart capture after rotation.

5. **ML Kit first-run latency** — On first launch, ML Kit downloads the text recognition
   model (~4 MB on-device). Bundle it via the `com.google.mlkit.vision.textrecognition`
   plugin (see Step 4) to eliminate this delay.

6. **Privacy** — MediaProjection captures the entire screen into a `VirtualDisplay`.
   Only the requested crop region (`x, y, width, height`) is extracted and passed to OCR.
   The full frame is never written to disk and is recycled immediately after cropping.
