# ZenLens — Android Native Modules

This folder contains the native Android (Kotlin) modules for real screen capture,
floating overlay, and on-device OCR.  **These modules cannot run in Expo Go** — a
custom development build or production APK is required.

---

## Modules

| Module | JS Name | Purpose |
|---|---|---|
| `ScreenCaptureModule.kt` | `NativeModules.ZenLensCapture` | MediaProjection screen capture + frame crop |
| `ScreenCaptureService.kt` | — | Foreground service (Android requirement for screen capture API 29+) |
| `OverlayModule.kt` | `NativeModules.ZenLensOverlay` | SYSTEM_ALERT_WINDOW floating control |
| `MLKitOCRModule.kt` | `NativeModules.ZenLensOCR` | Google ML Kit text recognition (on-device, no network) |
| `ZenLensPackage.kt` | — | ReactPackage that registers all four modules with the RN bridge |

---

## MediaProjection Permission Flow

This is the most critical integration point.  The flow looks like:

```
JS: ZenLensCapture.requestPermission()
        │
        ▼
ScreenCaptureModule.requestPermission()
  · Gets MediaProjectionManager from activity
  · Stores the JS Promise in permissionPromise
  · Calls activity.startActivityForResult(createScreenCaptureIntent(), 1001)
        │
        ▼ Android shows "Start recording?" system dialog
        │
        ├─► User taps "Start now" (RESULT_OK)
        │         │
        │         ▼
        │   TWO PATHS deliver the result (belt-and-suspenders):
        │
        │   PRIMARY — ActivityEventListener
        │     React Native automatically calls
        │     ScreenCaptureModule.onActivityResult(activity, 1001, RESULT_OK, data)
        │     because the module registered itself via
        │     reactContext.addActivityEventListener(this) in its init block.
        │
        │   SECONDARY — MainActivity explicit forward (config plugin patch)
        │     MainActivity.onActivityResult(1001, RESULT_OK, data) is called by Android.
        │     The patched override calls:
        │       reactInstanceManager?.currentReactContext
        │         ?.getNativeModule(ScreenCaptureModule::class.java)
        │         ?.onMediaProjectionResult(resultCode, data)
        │
        │   DEDUPLICATION — onMediaProjectionResult() has a resultHandled guard.
        │     The first caller wins; the second is a no-op.  Both paths can fire
        │     without causing double-resolution of the JS Promise.
        │
        ├─► User taps "Cancel" (RESULT_CANCELED)
        │         │
        │         ▼
        │   Same two paths deliver the result.
        │   permissionPromise?.resolve(false) is called.
        │   JS receives: false
        │
        ▼
ScreenCaptureModule.onMediaProjectionResult(resultCode, data):
  · Checks resultHandled guard (prevents double-invocation)
  · If RESULT_OK: calls mediaProjectionManager.getMediaProjection(resultCode, data)
  · Stores mediaProjection object (used by startCapture())
  · Resolves permissionPromise with true/false
```

### Why not the modern Activity Result API?

The modern `ActivityResultLauncher` (AndroidX Activity Result API) requires registering
a launcher during `onCreate` — before the activity resumes.  React Native native modules
receive their `currentActivity` reference lazily, after the activity has already started,
so they cannot call `registerForActivityResult()` on it.

`ActivityEventListener` is the idiomatic React Native solution.  It is:
- Built into the RN bridge (`ReactContext.addActivityEventListener`)
- Used by dozens of major RN packages (react-native-camera, react-native-image-picker, etc.)
- Compatible with both old and new architecture
- Zero MainActivity modifications needed for the primary path

The explicit MainActivity forward is belt-and-suspenders only.

---

## What Expo Go Cannot Do

| Feature | Why it fails in Expo Go |
|---|---|
| `NativeModules.ZenLensCapture` | Native Kotlin modules are not bundled in the Expo Go client |
| MediaProjection permission dialog | `startActivityForResult` for `MediaProjectionManager` requires a native build |
| SYSTEM_ALERT_WINDOW overlay | Custom overlay windows require `SYSTEM_ALERT_WINDOW` permission, not grantable in Expo Go |
| ML Kit OCR | Native ML Kit SDK is not bundled in Expo Go |
| Foreground service | Cannot start `ScreenCaptureService` without the native module |

ZenLens detects Expo Go via `Constants.appOwnership === "expo"` and falls back to
**simulation mode** — progressive sample text scrolls through the transcript, exercising
all dedupe, export, and UI logic identically to a native build.

---

## Integration Steps

### Automated (recommended)

```bash
# From artifacts/zen-lens/
npm run android:prebuild       # Expo prebuild runs the config plugin automatically
npm run android:verify-native  # Confirm all modules and wiring are in place
npm run android:apk            # Build APK via EAS
```

The config plugin (`plugins/withZenLensNativeModules.js`) does all four steps:
1. Copies all 5 `.kt` files from `android-native/` into the Android source tree
2. Patches `AndroidManifest.xml` with permissions and service declaration
3. Registers `ZenLensPackage` in `MainApplication.kt`
4. Patches `MainActivity.kt` with the belt-and-suspenders `onActivityResult` forward

Each step is idempotent — running prebuild multiple times will not duplicate anything.

### Manual (fallback)

If you are building with Android Studio and already have an `android/` directory:

```bash
npm run android:sync-native    # copies Kotlin files + patches manifests
npm run android:verify-native  # check everything is in place
```

Then add ML Kit manually (not done by the sync script):

```gradle
// android/app/build.gradle
dependencies {
    implementation "com.google.mlkit:text-recognition:16.0.1"
}
```

---

## Required AndroidManifest.xml Entries

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION"/>
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28"/>
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32"/>

<application ...>
    <service
        android:name=".ScreenCaptureService"
        android:foregroundServiceType="mediaProjection"
        android:exported="false"/>
</application>
```

`foregroundServiceType="mediaProjection"` is **required on API 29+**.  Without it,
`startForegroundService()` will throw a `MissingForegroundServiceTypeException` on Android 14+.

---

## Required MainApplication.kt Addition

```kotlin
override fun getPackages(): List<ReactPackage> =
    PackageList(this).packages.apply {
        add(ZenLensPackage())   // ← added by config plugin / sync script
    }
```

---

## Required MainActivity.kt Addition (belt-and-suspenders)

```kotlin
import android.content.Intent                          // add if missing
import com.zenlens.app.ScreenCaptureModule             // add if missing

// ZENLENS_ACTIVITY_RESULT_PATCH
// Belt-and-suspenders: forward MediaProjection results to ScreenCaptureModule.
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
```

The `// ZENLENS_ACTIVITY_RESULT_PATCH` sentinel is used by the config plugin and sync
script to detect whether this block has already been injected.  If you add it manually,
keep the sentinel comment so the scripts remain idempotent.

---

## Testing Native Capture Test on Device

1. Install the APK on a physical Android device (emulators cannot use MediaProjection)
2. Open ZenLens → tap **Device Readiness** on the home screen
3. Verify the checklist:
   - **ZenLensCapture Module** — ✓ (module registered)
   - **ML Kit OCR Module** — ✓
   - **System Overlay Module** — ✓
   - **File Export** — ✓
   - **MediaProjection Permission Wiring** — ✓ with "Wired ✓ — ActivityEventListener registered"
4. Tap **Test MediaProjection Permission**
5. Android displays a system dialog: **"ZenLens will start capturing everything that's displayed on your screen"**
6. Tap **Start now** → the button changes to "Permission granted — native capture ready ✓"
7. The wiring row updates to show `permissionGranted=true`

### What success looks like

```
✓ All 4 module rows show ✓
✓ MediaProjection Permission Wiring shows: "Wired ✓ — ActivityEventListener registered, requestCode 1001"
✓ Native Capture Test shows: "Permission granted — native capture ready ✓"
✓ Wiring row updates to: "Wired ✓ — permission already granted for this session"
```

### What failure looks like and what to do

| Symptom | Cause | Fix |
|---|---|---|
| All 4 module rows show ✗ | Expo Go or modules not registered | Run `android:prebuild && android:apk` |
| ZenLensCapture ✓ but wiring row shows "wiring is incomplete" | Old `ScreenCaptureModule.kt` without `checkWiring()` | Rebuild APK with updated module |
| Dialog appears but promise never resolves | `ActivityEventListener` not registered | Check `init { reactContext.addActivityEventListener(this) }` in `ScreenCaptureModule.kt` |
| Dialog appears, user grants, JS gets `false` | Wrong result handling branch | Check `onMediaProjectionResult()` — must check `resultCode == Activity.RESULT_OK && data != null` |
| "No activity available" error | Module called before activity starts | Ensure app is fully foregrounded before calling `requestPermission()` |

---

## Build Verification Checklist

Run `npm run android:verify-native` — it checks all of the following:

**Kotlin files:**
- [ ] ScreenCaptureModule.kt — implements ActivityEventListener, has `addActivityEventListener`, `onMediaProjectionResult`, `resultHandled`, `checkWiring`
- [ ] ScreenCaptureService.kt — Service + startForeground
- [ ] OverlayModule.kt — SYSTEM_ALERT_WINDOW + WindowManager
- [ ] MLKitOCRModule.kt — TextRecognition + recognizeText
- [ ] ZenLensPackage.kt — ReactPackage + createNativeModules

**AndroidManifest.xml:**
- [ ] 6 permissions present
- [ ] ScreenCaptureService declared with foregroundServiceType="mediaProjection"

**MainApplication.kt:**
- [ ] ZenLensPackage registered (no duplicates)

**MainActivity.kt:**
- [ ] ZENLENS_ACTIVITY_RESULT_PATCH sentinel present
- [ ] onActivityResult override calls onMediaProjectionResult
- [ ] Imports android.content.Intent and ScreenCaptureModule

**build.gradle:**
- [ ] ML Kit text-recognition dependency
