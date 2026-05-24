# ZenLens

**A scrolling OCR clipboard for Android.** Capture text from any app by recording your screen,
drawing a crop box over the text area, and letting ZenLens run OCR as you scroll. All processing
is on-device — nothing is uploaded.

---

## Quick Start (Expo Go / Simulation)

```bash
# Install dependencies
pnpm install

# Start the Expo dev server
pnpm --filter @workspace/zen-lens run dev
```

Scan the QR code with **Expo Go** on your Android device. The app runs in simulation mode —
all features work with pre-generated sample text. No screen capture or real OCR occurs.

---

## Feature Status

| Feature | Expo Go | Custom Build |
|---|---|---|
| UI / Navigation | ✅ | ✅ |
| Transcript editor | ✅ | ✅ |
| Dedupe logic | ✅ | ✅ |
| Settings persistence | ✅ | ✅ |
| Export (Copy/Share/.TXT) | ✅ | ✅ |
| Simulated OCR scrolling | ✅ | ✅ |
| MediaProjection screen capture | ❌ | ✅ |
| Foreground service notification | ❌ | ✅ |
| Floating overlay button | ❌ | ✅ |
| Google ML Kit OCR | ❌ | ✅ |

---

## Building for Android (Real Capture)

### Prerequisites

- Node.js 18+, pnpm
- Android Studio with SDK 21+
- A physical Android device (emulators cannot test MediaProjection)

### Steps

1. **Prebuild** (ejects to bare workflow):
   ```bash
   npx expo prebuild --platform android
   ```

2. **Copy native modules** from `android-native/` into
   `android/app/src/main/java/com/zenlens/app/`

3. **Follow** `android-native/README.md` for manifest, dependency, and MainActivity changes.

4. **Run on device:**
   ```bash
   npx expo run:android
   ```

5. **Production APK:**
   ```bash
   npx eas build --platform android --profile production
   ```

---

## Architecture

```
artifacts/zen-lens/
├── app/
│   ├── _layout.tsx          # Root layout — Stack navigation, providers
│   ├── index.tsx            # Home screen
│   ├── setup.tsx            # Permissions screen
│   ├── crop.tsx             # Crop box configuration
│   ├── transcript.tsx       # Live transcript editor
│   └── settings.tsx         # OCR / dedupe / storage settings
├── context/
│   ├── CaptureContext.tsx   # Capture state machine, OCR loop
│   └── SettingsContext.tsx  # Settings with AsyncStorage persistence
├── utils/
│   ├── dedupe.ts            # dedupeAppendText — overlap detection
│   ├── ocr.ts               # OCR bridge (native → simulation fallback)
│   └── storage.ts           # AsyncStorage helpers
├── components/
│   ├── CropBox.tsx          # Draggable/resizable crop rectangle
│   ├── StatusPill.tsx       # Live capture status indicator
│   └── PermissionRow.tsx    # Permission checklist item
└── android-native/          # Kotlin source for native modules
    ├── ScreenCaptureModule.kt
    ├── ScreenCaptureService.kt
    ├── OverlayModule.kt
    ├── MLKitOCRModule.kt
    ├── ZenLensPackage.kt
    └── README.md            # Full integration guide
```

---

## Dedupe Algorithm

`utils/dedupe.ts` implements `dedupeAppendText(existing, newOCR, options)`:

1. Normalize whitespace in both texts
2. Split into lines, filter empty lines
3. Check the last 30 lines of existing against the first 30 lines of new
4. Find the longest suffix/prefix overlap (sliding window)
5. Append only the non-overlapping tail from new OCR
6. Reject frames with < `minLength` meaningful characters
7. Maintain a circular history of the last 5 OCR chunks to prevent looping

Settings:
- `dedupeAggressiveness: 0` — off (always append)
- `dedupeAggressiveness: 1` — normal (overlap detection only)
- `dedupeAggressiveness: 2` — aggressive (also checks full containment)

---

## Privacy

- **No network access.** ZenLens has no API calls and no analytics.
- **On-device OCR only.** ML Kit Text Recognition runs entirely on the device.
- **No screenshot storage.** Frames are processed in memory and immediately recycled.
- **Local transcript only.** Transcript is stored in Android app private storage via AsyncStorage.

---

## Known Limitations

See `android-native/README.md` for the full list. Key ones:

- Expo Go cannot run real screen capture — simulation mode only
- The floating overlay requires manual Settings permission (SYSTEM_ALERT_WINDOW)
- Screen rotation during capture may misalign the crop box
- ML Kit downloads ~4MB model on first real-device run
