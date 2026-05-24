# ZenLens — Android Native Modules

This folder contains the native Android (Kotlin) modules required for real screen capture,
floating overlay, and on-device OCR. These modules **cannot run in Expo Go** — they require
a custom development build or a production APK.

---

## Modules

| Module | JS Name | Purpose |
|---|---|---|
| `ScreenCaptureModule.kt` | `NativeModules.ZenLensCapture` | MediaProjection screen capture |
| `ScreenCaptureService.kt` | — | Foreground service (Android requirement) |
| `OverlayModule.kt` | `NativeModules.ZenLensOverlay` | System overlay / floating button |
| `MLKitOCRModule.kt` | `NativeModules.ZenLensOCR` | Google ML Kit text recognition |
| `ZenLensPackage.kt` | — | Package registration |

---

## Integration Steps

### 1. Eject from Expo managed workflow

Since these require custom native code, you must use the **bare workflow** or **EAS Build**:

```bash
npx expo prebuild --platform android
```

This creates the `android/` directory.

### 2. Copy Kotlin files

Copy the `.kt` files from this folder into:

```
android/app/src/main/java/com/zenlens/app/
```

### 3. Register the package

In `android/app/src/main/java/com/zenlens/app/MainApplication.kt`:

```kotlin
override fun getPackages(): List<ReactPackage> =
    PackageList(this).packages.apply {
        add(ZenLensPackage())
    }
```

### 4. Add dependencies

In `android/app/build.gradle` → `dependencies` block:

```groovy
// ML Kit Text Recognition
implementation 'com.google.mlkit:text-recognition:16.0.1'
```

### 5. Update AndroidManifest.xml

```xml
<!-- Screen capture / foreground service -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION"/>

<!-- System overlay (floating button) -->
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>

<!-- Notifications (required for foreground service on Android 13+) -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>

<!-- File export -->
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"
    android:maxSdkVersion="28"/>
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"
    android:maxSdkVersion="32"/>

<!-- Declare the foreground service -->
<service
    android:name=".ScreenCaptureService"
    android:foregroundServiceType="mediaProjection"
    android:exported="false"/>
```

### 6. Handle MediaProjection result in MainActivity

`android/app/src/main/java/com/zenlens/app/MainActivity.kt`:

```kotlin
import android.content.Intent

class MainActivity : ReactActivity() {
    // ... existing code ...

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == ScreenCaptureModule.MEDIA_PROJECTION_REQUEST) {
            val module = reactInstanceManager
                .currentReactContext
                ?.getNativeModule(ScreenCaptureModule::class.java)
            module?.handlePermissionResult(resultCode, data)
        }
    }
}
```

### 7. minSdkVersion

Ensure `android/build.gradle`:
```groovy
minSdkVersion = 21  // MediaProjection requires API 21+
```

---

## Building the APK

```bash
# Development build
npx expo run:android

# Production APK via EAS
npx eas build --platform android --profile production
```

---

## Simulation Mode

When running in Expo Go (no native modules), ZenLens automatically falls back to
**simulation mode**:
- `requestPermission()` always returns `true` after a brief delay
- `captureFrame()` is never called; instead, `recognizeTextFromCrop()` in
  `utils/ocr.ts` returns pre-written sample text that scrolls progressively
- The crop box, dedupe logic, transcript, and all UI are fully functional

This allows development and UI testing without a physical device.

---

## Known Limitations

1. **Expo Go incompatibility** — MediaProjection, SYSTEM_ALERT_WINDOW, and ML Kit require
   a custom build. Expo Go sandboxes native modules.

2. **Android 10+ foreground service type** — `foregroundServiceType="mediaProjection"` is
   required on API 29+. Without it, the service crashes on start.

3. **Overlay permission UX** — `SYSTEM_ALERT_WINDOW` cannot be requested with the standard
   permissions dialog. The user must be sent to Settings manually
   (`Settings.ACTION_MANAGE_OVERLAY_PERMISSION`). The Setup screen handles this.

4. **Screen rotation** — `screenWidth`/`screenHeight` in `ScreenCaptureModule` are captured
   at start time. If the device rotates, the virtual display dimensions may mismatch.
   Restart capture after rotation.

5. **ML Kit first-run latency** — On first use, ML Kit downloads the text recognition model
   (~4MB). Bundle it in the APK to eliminate this:
   ```groovy
   implementation 'com.google.mlkit:text-recognition:16.0.1'
   // Bundle the model:
   apply plugin: 'com.google.mlkit.vision.textrecognition'
   ```

6. **Privacy** — MediaProjection captures the entire screen into a `VirtualDisplay`.
   Only the requested crop region is extracted and passed to OCR. The full frame
   is never written to disk and is recycled immediately after cropping.
