# ZenLens

**ZenLens** is an Android-first scrolling OCR clipboard built for capturing text from your screen while you work.

The goal is simple: open ZenLens, grant screen capture permission, select/crop the text area you care about, scroll through content, and build a clean running transcript without copying duplicated text over and over.

ZenLens is being built as a real native Android app, not a PWA.

---

## Current Status

ZenLens is currently an early native Android prototype.

The project has successfully reached the first major native milestone:

- Native Android APK builds through Expo/EAS
- Real installed Android app
- MediaProjection permission dialog opens
- Native modules are detected in the app
- Foreground service wiring exists
- Single-frame capture wiring exists
- ML Kit OCR module is included
- Device Readiness screen verifies native module availability

Current active bug:

- Granting Android screen capture permission can currently crash the app before the permission token is safely cached.

The next development milestone is fixing the MediaProjection permission-result handoff so ZenLens can safely move from:

```txt
Permission dialog → token cached → foreground service → single frame capture

Once that is stable, the next milestones are crop-region capture, OCR, and deduped scrolling transcript capture.


---

Why ZenLens Exists

Copying text from mobile screens is still clunky.

During app builds, research, debugging, and AI-assisted workflows, I often need to capture long responses or threads from:

Replit Agent

ChatGPT

Claude

StackOverflow

GitHub

Reddit

Browser pages

App screens


Normal screenshots and copy/paste are not enough when the text is long, partially visible, or split across scrolls.

ZenLens is meant to become a focused tool for:

1. Starting screen capture


2. Selecting only the text area that matters


3. Scrolling manually


4. OCRing only the selected region


5. Ignoring duplicated text already captured


6. Letting the user pause, edit, resume, copy, and export the transcript




---

Planned Workflow

Final intended workflow:

1. Open ZenLens


2. Tap Start Capture


3. Grant Android screen capture permission


4. Drag a crop box over the text area


5. Tap Start OCR


6. Scroll the original app/page manually


7. ZenLens OCRs the crop region every 1–2 seconds


8. Duplicate visible text is skipped


9. New text is appended to a running transcript


10. Tap Pause to manually edit the transcript


11. Resume capture from the same or another screen


12. Copy, share, or export the final transcript




---

Features Implemented So Far

Native Android

Android APK build through EAS

MediaProjection permission request wiring

Foreground capture service wiring

Single-frame capture checkpoint wiring

Native module readiness checks

ML Kit OCR module registration

Overlay module registration

File export module availability


App UI

Home screen

Native build mode banner

Device Readiness screen

Native Handoff Test panel

Transcript screen

Settings screen

OCR interval setting

Confidence setting

Minimum text length setting

Deduplication aggressiveness setting

Auto-save toggle

Privacy card


Build Tooling

Expo / React Native project

EAS build configuration

Android native config plugin

Native sync script

Native verification script

GitHub-ready build flow



---

Device Readiness Checks

ZenLens includes a Device Readiness screen that checks whether the native Android pieces are present.

Current checks include:

ZenLensCapture module

MediaProjection permission wiring

MediaProjection permission granted

Foreground capture service wiring

Foreground capture service running

Single-frame capture wiring

System overlay module

ML Kit OCR module

File export availability



---

Tech Stack

React Native

Expo

EAS Build

Kotlin native Android modules

Android MediaProjection

Android Foreground Service

Android VirtualDisplay

Android ImageReader

Google ML Kit Text Recognition

TypeScript



---

Local Development

Install dependencies:

npm install

Run TypeScript check:

node_modules/.bin/tsc -p tsconfig.json --noEmit

Generate the Android project:

npm run android:prebuild

Sync native Android files:

npm run android:sync-native

Verify native Android wiring:

npm run android:verify-native

Expected successful verify output:

140/140 checks passed


---

Build Android APK

ZenLens uses Expo EAS Build.

Log in to EAS:

eas login

Or use an Expo token:

export EXPO_TOKEN="your_token_here"

Then build the Android APK:

npm run android:apk

The APK can be downloaded from the Expo build page after the build completes.


---

Native APK Test Order

After installing the APK on a real Android device:

1. Open ZenLens


2. Go to Device Readiness


3. Tap Test MediaProjection Permission


4. Android should show the screen capture permission dialog


5. Choose Share entire screen


6. Grant permission


7. Tap Test Foreground Capture Service


8. Confirm persistent ZenLens notification appears


9. Tap Test Single Frame Capture


10. Confirm frame metadata appears, such as screen width × height


11. Tap Stop Capture Service


12. Confirm service stops cleanly



Current known issue:

The app may crash immediately after granting MediaProjection permission. This is the current active bug being fixed.



---

Privacy

ZenLens is designed to process screen content locally on-device.

The intended privacy model:

No backend required

No login required

No screenshots uploaded

No transcript uploaded

OCR runs on-device using Google ML Kit

Captured frames are processed in memory and discarded


ZenLens is currently an early prototype, so privacy behavior should continue to be verified as native capture features are completed.


---

Roadmap

Current Milestone

Fix MediaProjection permission-result crash

Safely cache permission token after Android grant

Confirm foreground service can start without crashing

Confirm single-frame capture returns real dimensions


Next Milestones

Crop-region frame capture

OCR single cropped frame

Repeated OCR loop

Scroll-based duplicate detection

Editable running transcript

Pause / resume workflow

Copy all

Share transcript

Export .txt

Crash-safe autosave

Floating overlay controls



---

Project Philosophy

ZenLens is being built fast and iteratively.

The priority is:

1. Prove the native Android capture pipeline


2. Prove OCR on one frame


3. Prove cropped OCR


4. Prove scrolling dedupe


5. Polish the UX



Speed first. Validation first. Polish after the core workflow works.


---

Disclaimer

ZenLens is experimental software.

It uses Android screen capture APIs and native modules that require careful permission handling. Do not use it for sensitive information until the capture, storage, and privacy behavior has been fully tested.
