# ZenLens

A personal productivity OCR tool for Android. Captures text from your phone screen while you move between apps — a scrolling OCR clipboard with crop box, dedupe, and export.

## Run & Operate

- `pnpm --filter @workspace/zen-lens run dev` — start the Expo dev server
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000, not needed for MVP)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Mobile: Expo 54 / React Native 0.81 (Android-first)
- Navigation: Expo Router (Stack, no tabs)
- State: React Context + AsyncStorage
- OCR: Simulated in Expo Go; Google ML Kit via native module in production
- Export: expo-clipboard, expo-file-system, expo-sharing

## Where things live

- `artifacts/zen-lens/` — Expo mobile app
- `artifacts/zen-lens/app/` — Screens (index, setup, crop, transcript, settings)
- `artifacts/zen-lens/context/` — CaptureContext, SettingsContext
- `artifacts/zen-lens/utils/` — dedupe.ts, ocr.ts, storage.ts
- `artifacts/zen-lens/components/` — CropBox, StatusPill, PermissionRow
- `artifacts/zen-lens/android-native/` — Kotlin native modules + integration README
- `artifacts/zen-lens/README.md` — Full setup, build notes, known limitations

## Architecture decisions

- Simulation mode: `utils/ocr.ts` auto-detects missing native modules and falls back to progressive sample text. All UI, dedupe, and export logic is fully exercised in Expo Go.
- CaptureContext is the single state machine for the capture lifecycle (idle → requesting_permission → ready → capturing → paused).
- CropBox uses PanResponder for drag-move and four corner handles for resize — no third-party gesture libraries.
- dedupeAppendText compares last 30 existing lines with first 30 new lines, finds longest overlap, appends only the new tail. Maintains a circular history of 5 chunks to break loops.
- All transcript and settings are persisted via AsyncStorage (no backend needed for MVP).

## Product

- Home screen: Start/Stop capture, transcript link, settings
- Setup screen: Permission checklist (MediaProjection, overlay, foreground service)
- Crop screen: Draggable/resizable crop box over a simulated screen preview
- Transcript screen: Live auto-scrolling OCR output, pause/edit/resume, Copy/Share/.TXT/Clear
- Settings screen: OCR interval, confidence threshold, text length, dedupe aggressiveness, auto-save

## User preferences

- Android-first. iOS is secondary.
- All OCR on-device — no network calls, no uploads.
- Simulation mode in Expo Go for development; native modules in production build.

## Gotchas

- MediaProjection, SYSTEM_ALERT_WINDOW, and ML Kit all require a custom development build or production APK. They cannot run in Expo Go.
- The floating overlay requires the user to manually grant SYSTEM_ALERT_WINDOW in Settings — it cannot be requested via the standard permissions dialog.
- Run `npx expo prebuild --platform android` before copying native modules from `android-native/`.
- See `artifacts/zen-lens/android-native/README.md` for the full integration guide.

## Pointers

- See `artifacts/zen-lens/README.md` for the full architecture and APK build notes
- See `artifacts/zen-lens/android-native/README.md` for Kotlin module integration
- See the `pnpm-workspace` skill for workspace structure details
