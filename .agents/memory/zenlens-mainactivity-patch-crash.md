---
name: ZenLens MainActivity patch crash
description: Why the MainActivity.kt onActivityResult belt-and-suspenders patch causes crashes and must not be re-added
---

The original code patched MainActivity.kt to add an explicit onActivityResult override that forwarded MediaProjection results to ScreenCaptureModule.onMediaProjectionResult() as a "belt-and-suspenders" measure. This caused the app to crash on Android when the user granted the screen capture permission.

**Root cause:** The patch accessed `reactInstanceManager` (a property of ReactActivity) to get the native module. On RN 0.73+, this property is deprecated and may throw instead of returning null, bypassing Kotlin's `?.` safe-call operator.

**Why:** ScreenCaptureModule already implements ActivityEventListener and registers itself via `reactContext.addActivityEventListener(this)` in init. This is confirmed green on device. The MainActivity patch was unnecessary and created a crash-inducing double-forward.

**How to apply:** Never re-add the MainActivity.kt onActivityResult patch. If the ActivityEventListener row goes red on device, fix the ActivityEventListener registration in ScreenCaptureModule.kt instead. The withPatchMainActivity step has been permanently removed from both the config plugin (withZenLensNativeModules.js) and the sync script (sync-native-android.js). The verify script treats MainActivity.kt checks as informational warnings.
