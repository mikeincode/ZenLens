# ZenLens

**A scrolling OCR clipboard for Android.** Captures text from any app using screen recording,
a draggable crop box, and on-device OCR — everything stays on your device.

---

## Two Modes

| | Expo Go (demo) | Native APK (real capture) |
|---|---|---|
| UI / Navigation | ✅ | ✅ |
| Transcript editor | ✅ | ✅ |
| Dedupe / auto-save | ✅ | ✅ |
| Export (Copy / Share / .TXT) | ✅ | ✅ |
| Simulated OCR (sample text) | ✅ | ✅ |
| **MediaProjection screen capture** | ❌ | ✅ |
| **Foreground service notification** | ❌ | ✅ |
| **Floating overlay button** | ❌ | ✅ |
| **Google ML Kit OCR** | ❌ | ✅ |

The home screen always shows a banner indicating which mode is active.
Tap **Device Readiness** to see a live checklist of all native module statuses.

---

## Quick Start — Expo Go (UI demo)

```bash
pnpm install
pnpm --filter @workspace/zen-lens run dev
```

Scan the QR code with Expo Go on Android. All screens are fully functional with
simulated scrolling text. No native modules, no screen capture.

---

## Build a Real APK (Native Capture)

### Prerequisites

- Node.js 18+, pnpm (already set up in this repo)
- An [Expo account](https://expo.dev/signup) (free tier works)
- `eas-cli` (installed automatically by the build script if missing)
- A physical Android device — emulators cannot use MediaProjection

### One-command build

```bash
cd artifacts/zen-lens
npm run android:apk
```

This script does the following automatically:
1. Checks for `eas-cli` and installs it if missing
2. Prompts for EAS login if not authenticated
3. Runs `npx expo prebuild --platform android --clean`
   - The **config plugin** (`plugins/withZenLensNativeModules.js`) runs during prebuild and:
     - Copies all 5 Kotlin files from `android-native/` into `android/app/src/main/java/com/zenlens/app/`
     - Injects all required permissions into `AndroidManifest.xml`
     - Declares `ScreenCaptureService` with `foregroundServiceType="mediaProjection"`
     - Registers `ZenLensPackage` in `MainApplication.kt`
4. Verifies every native module, permission, and registration is present
5. Runs `eas build --platform android --profile preview`
6. Prints download link and install instructions

### Download and install the APK

After the EAS build completes (~5-10 min):

```bash
# List your builds and get the download URL
eas build:list --platform android

# Install via USB (requires adb)
adb install path/to/zen-lens.apk
```

Or open the EAS build URL on your Android device and tap **Install**.

### Native APK test order

After installing on a **physical Android device**:

1. Open ZenLens
2. Go to **Device Readiness**
3. Confirm **ZenLensCapture module** row shows ✓
4. Confirm **MediaProjection permission wiring** row shows ✓ (ActivityEventListener registered)
5. Confirm **Foreground capture service wiring** row shows ✓ (all methods present)
6. Confirm **Single-frame capture wiring** row shows ✓ (captureSingleFrame() available)
7. Tap **Test MediaProjection Permission**
   — Android "Start recording?" dialog appears
   — Tap **Start now** → status shows "Granted ✓ — token cached"
8. Tap **Test Foreground Capture Service**
   — Service starts → persistent **ZenLens notification** appears in the status bar
9. Tap **Test Single Frame Capture**
   — Waits up to 3 seconds for one frame via VirtualDisplay + ImageReader
   — Status shows e.g. "Frame captured ✓ — 1080×2340" (your device resolution)
   — Frame pipeline is proven — no OCR yet, metadata only
10. Select a **crop preset** (Center / Top Half / Bottom Half / Custom), then tap **Test Crop Region Capture**
    — Native side captures a full frame, clamps the requested rect, returns crop metadata
    — Status shows e.g. "source 1080×2340 · crop (200,500) 680×680"
    — Crop pipeline is proven — no pixel data transferred, no OCR yet
11. Tap **Stop Capture Service**
    — Notification disappears → token cleared → "Service stopped ✓"
12. If all buttons show green: **the crop-region capture checkpoint is proven**
13. Next build step: **OCR (ML Kit)** on the crop pipeline

> **Android 14+ note:** The MediaProjection token is one-session-use.
> After stop, a fresh **Test MediaProjection Permission** is required before
> starting the service again. This is by Android design, not a bug.

---

## Manual Native Integration (if not using EAS)

If you want to build locally with Android Studio or `npx expo run:android`:

```bash
# 1. Generate android/ directory
npm run android:prebuild

# 2. Copy Kotlin files + patch AndroidManifest + register package
npm run android:sync-native

# 3. Verify everything is in place
npm run android:verify-native

# 4. Add ML Kit to android/app/build.gradle (must be done manually):
#    dependencies {
#      implementation "com.google.mlkit:text-recognition:16.0.1"
#    }

# 5. Build and launch on connected device
npm run android:run
```

---

## npm Scripts Reference

| Script | What it does |
|---|---|
| `npm run dev` | Start Expo dev server (Expo Go / web) |
| `npm run android:prebuild` | `expo prebuild --platform android --clean` |
| `npm run android:sync-native` | Copy Kotlin files + patch manifest (manual fallback) |
| `npm run android:verify-native` | Verify all native modules are present and correct |
| `npm run android:apk` | Full end-to-end APK build via EAS (preview profile) |
| `npm run android:apk:dev` | EAS development build (with dev client) |
| `npm run android:apk:prod` | EAS production AAB for Play Store |
| `npm run android:run` | Build and install on connected USB device |

---

## EAS Build Profiles (`eas.json`)

| Profile | Type | Use case |
|---|---|---|
| `development` | APK (debug) | Dev client build with hot reload |
| `preview` | APK (release) | Internal testing, direct install |
| `production` | AAB | Google Play Store submission |

---

## Native Module Architecture

```
android-native/                      Source of truth for Kotlin
├── ScreenCaptureModule.kt           MediaProjection + frame crop → base64
├── ScreenCaptureService.kt          Foreground service (Android requirement)
├── OverlayModule.kt                 SYSTEM_ALERT_WINDOW floating control
├── MLKitOCRModule.kt                Google ML Kit text recognition
└── ZenLensPackage.kt                ReactPackage that registers all 4 modules

plugins/
└── withZenLensNativeModules.js      Config plugin — copies + patches during prebuild

scripts/
├── build-apk.sh                     End-to-end EAS build with verification
├── sync-native-android.js           Manual copy + manifest patch (fallback)
└── verify-native-android.js         Checks all native integration points
```

JS ↔ Native bridge names:
- `NativeModules.ZenLensCapture` — screen frame capture, MediaProjection permission
- `NativeModules.ZenLensOCR` — ML Kit text recognition
- `NativeModules.ZenLensOverlay` — system overlay show/hide

---

## Architecture Notes

- **Simulation mode**: `utils/ocr.ts` checks `NativeModules.ZenLensCapture` at runtime.
  If absent (Expo Go), falls back to progressive sample text — all dedupe, transcript,
  and export logic runs identically.
- **CaptureContext**: single state machine (`idle → requesting_permission → ready → capturing → paused`).
  Auto-saves transcript on every append (if `autoSave` on) and every 10 seconds while capturing.
- **CropBox**: PanResponder drag-move + 4 corner resize handles. No third-party gesture libraries.
- **dedupeAppendText**: compares last 30 lines of existing transcript with first 30 lines of new
  text, finds longest overlap, appends only the new tail. Maintains circular history of 5 chunks.

---

## Known Limitations

1. **Expo Go** — MediaProjection, SYSTEM_ALERT_WINDOW, and ML Kit require a custom build.
   `NativeModules.ZenLens*` will always be `undefined` in Expo Go.
2. **Android 10+ foreground service type** — `foregroundServiceType="mediaProjection"` is required
   on API 29+. The config plugin and sync script both ensure this is present.
3. **Overlay permission UX** — `SYSTEM_ALERT_WINDOW` cannot use the standard permissions dialog.
   ZenLens's Setup screen sends the user to `Settings.ACTION_MANAGE_OVERLAY_PERMISSION`.
4. **Screen rotation** — Capture dimensions are fixed at start time. Stop and restart if the device rotates.
5. **ML Kit first-run** — ~4 MB model download on first launch unless bundled via the ML Kit plugin.
6. **Physical device required** — Android emulators cannot use the MediaProjection API.

---

## File Map

```
artifacts/zen-lens/
├── app/
│   ├── _layout.tsx          Root layout, providers, font loading
│   ├── index.tsx            Home screen (mode banner, capture button, native test)
│   ├── setup.tsx            Permission checklist + grant flow
│   ├── crop.tsx             Draggable/resizable crop box
│   ├── transcript.tsx       Live OCR output, edit, export
│   ├── settings.tsx         OCR interval, confidence, dedupe, auto-save
│   └── readiness.tsx        Native module checklist + build guide
├── context/
│   ├── CaptureContext.tsx   Capture state machine + OCR loop + auto-save
│   └── SettingsContext.tsx  Settings persistence
├── utils/
│   ├── ocr.ts               Native bridge + simulation fallback + isExpoGo()
│   ├── dedupe.ts            dedupeAppendText with overlap detection
│   └── storage.ts           AsyncStorage wrappers
├── components/
│   ├── CropBox.tsx          PanResponder crop UI
│   ├── StatusPill.tsx       Capture state indicator
│   └── PermissionRow.tsx    Permission checklist row
├── plugins/
│   └── withZenLensNativeModules.js   Expo config plugin
├── scripts/
│   ├── build-apk.sh                  End-to-end EAS build
│   ├── sync-native-android.js        Manual native sync
│   └── verify-native-android.js      Integration verification
├── android-native/
│   ├── ScreenCaptureModule.kt
│   ├── ScreenCaptureService.kt
│   ├── OverlayModule.kt
│   ├── MLKitOCRModule.kt
│   ├── ZenLensPackage.kt
│   └── README.md            Detailed manual integration guide
├── app.json                 Expo config (registers config plugin)
└── eas.json                 EAS build profiles
```
