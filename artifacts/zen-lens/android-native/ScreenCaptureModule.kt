package com.zenlens.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.*

private const val TAG = "ZenLensCapture"

/**
 * ScreenCaptureModule — NativeModules.ZenLensCapture
 *
 * JS API:
 *
 *   requestPermission()
 *     → { granted: boolean, permissionCached: boolean, reason?: string }
 *
 *   startCaptureService()
 *     → { started: boolean, reason?: string }
 *
 *   stopCaptureService()
 *     → { stopped: boolean }
 *
 *   getCaptureServiceStatus()
 *     → { permissionGranted: boolean, serviceRunning: boolean, hasProjectionToken: boolean }
 *
 *   checkWiring()
 *     → { activityListenerRegistered: boolean, requestCode: number,
 *          permissionGranted: boolean, serviceMethodsPresent: boolean,
 *          singleFrameWiringPresent: boolean }
 *
 *   captureSingleFrame()
 *     → { success: true, width: number, height: number,
 *          pixelFormat: number, timestamp: number }
 *       | { success: false, reason: string }
 *
 *   requestOverlayPermission() → boolean
 *
 *   getNativeDebugStatus()
 *     → { lastNativeEvent: string, lastNativeError: string,
 *          permissionRequestInFlight: boolean, permissionGranted: boolean,
 *          hasProjectionToken: boolean, serviceRunning: boolean }
 */
class ScreenCaptureModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        const val MODULE_NAME = "ZenLensCapture"
        const val MEDIA_PROJECTION_REQUEST = 1001
    }

    // ── State ─────────────────────────────────────────────────────────────────

    private var mediaProjectionManager: android.media.projection.MediaProjectionManager? = null

    /** Pending JS promise from requestPermission(). Resolved in onMediaProjectionResult(). */
    private var permissionPromise: Promise? = null

    /**
     * Dedup guard — prevents double-resolution when ActivityEventListener fires.
     * Reset to false before each new requestPermission() call.
     */
    @Volatile private var resultHandled = false

    /**
     * True while requestPermission() has been called and we are waiting for the
     * Android permission dialog to return a result.
     */
    @Volatile private var permissionRequestInFlight = false

    /**
     * Stored grant from the last successful requestPermission().
     * Cleared by stopCaptureService() — Android 14+ tokens are one-session-use.
     */
    private var pendingResultCode: Int = Activity.RESULT_CANCELED
    private var pendingResultData: Intent? = null

    private var activityListenerRegistered = false

    // ── Debug state (persists across app resumes so the UI can read it) ─────────

    @Volatile private var lastNativeEvent: String = "none"
    @Volatile private var lastNativeError: String = ""

    // ── Init ──────────────────────────────────────────────────────────────────

    init {
        try {
            reactContext.addActivityEventListener(this)
            activityListenerRegistered = true
            Log.d(TAG, "ScreenCaptureModule init — ActivityEventListener registered")
        } catch (e: Exception) {
            Log.e(TAG, "ScreenCaptureModule init — addActivityEventListener failed: ${e.message}")
            lastNativeError = "init/addActivityEventListener: ${e.message}"
        }
    }

    override fun getName() = MODULE_NAME

    // ── ActivityEventListener (primary + only result path) ────────────────────

    override fun onActivityResult(
        activity: Activity,
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
        try {
            if (requestCode == MEDIA_PROJECTION_REQUEST) {
                Log.d(TAG, "onActivityResult: requestCode=$requestCode resultCode=$resultCode data=${data != null}")
                lastNativeEvent = "onActivityResult: requestCode=$requestCode resultCode=$resultCode hasData=${data != null}"
                onMediaProjectionResult(resultCode, data)
            }
        } catch (e: Exception) {
            Log.e(TAG, "onActivityResult: uncaught exception — ${e.message}", e)
            lastNativeError = "onActivityResult: ${e.message}"
            safeRejectPermissionPromise("onActivityResult threw: ${e.message}")
        }
    }

    override fun onNewIntent(intent: Intent) {}

    // ── Permission result (idempotent — resolves promise exactly once) ─────────

    fun onMediaProjectionResult(resultCode: Int, data: Intent?) {
        try {
            Log.d(TAG, "onMediaProjectionResult: called — resultHandled=$resultHandled resultCode=$resultCode hasData=${data != null}")

            if (resultHandled) {
                Log.d(TAG, "onMediaProjectionResult: already handled — skipping duplicate")
                return
            }
            resultHandled = true
            permissionRequestInFlight = false

            val result = Arguments.createMap()

            when {
                resultCode == Activity.RESULT_OK && data != null -> {
                    Log.d(TAG, "onMediaProjectionResult: GRANTED — storing pendingResultCode/Data")
                    lastNativeEvent = "permissionGranted: resultCode=$resultCode"
                    pendingResultCode = resultCode
                    pendingResultData = data
                    result.putBoolean("granted", true)
                    result.putBoolean("permissionCached", true)
                    safeResolvePermissionPromise(result)
                }
                resultCode == Activity.RESULT_CANCELED -> {
                    Log.d(TAG, "onMediaProjectionResult: CANCELED by user")
                    lastNativeEvent = "permissionCanceled"
                    pendingResultCode = Activity.RESULT_CANCELED
                    pendingResultData = null
                    result.putBoolean("granted", false)
                    result.putBoolean("permissionCached", false)
                    result.putString("reason", "User cancelled the MediaProjection permission dialog")
                    safeResolvePermissionPromise(result)
                }
                data == null -> {
                    Log.e(TAG, "onMediaProjectionResult: resultCode=$resultCode but resultData Intent was null")
                    lastNativeError = "resultData Intent was null (resultCode=$resultCode)"
                    pendingResultCode = Activity.RESULT_CANCELED
                    pendingResultData = null
                    result.putBoolean("granted", false)
                    result.putBoolean("permissionCached", false)
                    result.putString("reason", "MediaProjection result Intent was null (resultCode=$resultCode)")
                    safeResolvePermissionPromise(result)
                }
                else -> {
                    Log.e(TAG, "onMediaProjectionResult: unexpected resultCode=$resultCode, data=${data != null}")
                    lastNativeError = "unexpected result: resultCode=$resultCode"
                    pendingResultCode = Activity.RESULT_CANCELED
                    pendingResultData = null
                    result.putBoolean("granted", false)
                    result.putBoolean("permissionCached", false)
                    result.putString("reason", "Unexpected MediaProjection result: resultCode=$resultCode")
                    safeResolvePermissionPromise(result)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "onMediaProjectionResult: uncaught exception — ${e.message}", e)
            lastNativeError = "onMediaProjectionResult: ${e.message}"
            permissionRequestInFlight = false
            safeRejectPermissionPromise("onMediaProjectionResult threw: ${e.message}")
        }
    }

    // ── Promise safety helpers ─────────────────────────────────────────────────

    /**
     * Resolve permissionPromise exactly once. Clears permissionPromise after resolving.
     * Never throws.
     */
    private fun safeResolvePermissionPromise(result: WritableMap) {
        try {
            val p = permissionPromise
            permissionPromise = null
            p?.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "safeResolvePermissionPromise: resolve threw — ${e.message}", e)
            lastNativeError = "promise.resolve threw: ${e.message}"
        }
    }

    /**
     * Reject permissionPromise exactly once as an error map (not a JS exception).
     * Resolves with { granted:false, reason } so JS does not throw.
     * Never throws.
     */
    private fun safeRejectPermissionPromise(reason: String) {
        try {
            val p = permissionPromise
            permissionPromise = null
            if (p != null) {
                val err = Arguments.createMap().apply {
                    putBoolean("granted", false)
                    putBoolean("permissionCached", false)
                    putString("reason", reason)
                }
                p.resolve(err)
            }
        } catch (e: Exception) {
            Log.e(TAG, "safeRejectPermissionPromise: threw — ${e.message}", e)
        }
    }

    // ── @ReactMethod: requestPermission ───────────────────────────────────────

    /**
     * Opens the Android "Start recording?" system dialog.
     * Returns { granted: boolean, permissionCached: boolean, reason?: string }.
     * The resultCode + resultData are stored for startCaptureService().
     */
    @ReactMethod
    fun requestPermission(promise: Promise) {
        try {
            Log.d(TAG, "requestPermission: called")
            lastNativeEvent = "requestPermission: called"

            val activity = reactContext.currentActivity
            if (activity == null) {
                Log.e(TAG, "requestPermission: currentActivity is null")
                lastNativeError = "requestPermission: currentActivity null"
                val err = Arguments.createMap().apply {
                    putBoolean("granted", false)
                    putBoolean("permissionCached", false)
                    putString("reason", "No activity available — ensure the app is fully foregrounded")
                }
                promise.resolve(err)
                return
            }

            mediaProjectionManager = try {
                activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE)
                    as android.media.projection.MediaProjectionManager
            } catch (e: Exception) {
                Log.e(TAG, "requestPermission: getSystemService failed — ${e.message}")
                lastNativeError = "getSystemService(MEDIA_PROJECTION_SERVICE): ${e.message}"
                val err = Arguments.createMap().apply {
                    putBoolean("granted", false)
                    putBoolean("permissionCached", false)
                    putString("reason", "Could not get MediaProjectionManager: ${e.message}")
                }
                promise.resolve(err)
                return
            }

            // Store promise BEFORE launching intent so result handler can resolve it
            permissionPromise = promise
            resultHandled = false
            permissionRequestInFlight = true

            Log.d(TAG, "requestPermission: launching MediaProjection intent (request=$MEDIA_PROJECTION_REQUEST)")
            lastNativeEvent = "requestPermission: startActivityForResult launched"

            val intent = mediaProjectionManager!!.createScreenCaptureIntent()
            activity.startActivityForResult(intent, MEDIA_PROJECTION_REQUEST)

        } catch (e: Exception) {
            Log.e(TAG, "requestPermission: uncaught exception — ${e.message}", e)
            lastNativeError = "requestPermission: ${e.message}"
            permissionRequestInFlight = false
            permissionPromise = null
            val err = Arguments.createMap().apply {
                putBoolean("granted", false)
                putBoolean("permissionCached", false)
                putString("reason", "requestPermission threw: ${e.message}")
            }
            try { promise.resolve(err) } catch (_: Exception) {}
        }
    }

    // ── @ReactMethod: startCaptureService ─────────────────────────────────────

    /**
     * Starts ScreenCaptureService with the stored MediaProjection grant.
     * Returns { started: boolean, reason?: string }.
     */
    @ReactMethod
    fun startCaptureService(promise: Promise) {
        if (pendingResultCode != Activity.RESULT_OK || pendingResultData == null) {
            val err = Arguments.createMap().apply {
                putBoolean("started", false)
                putString("reason", "MediaProjection permission not granted — call requestPermission() first")
            }
            promise.resolve(err)
            return
        }

        if (ScreenCaptureService.isRunning) {
            val err = Arguments.createMap().apply {
                putBoolean("started", false)
                putString("reason", "ScreenCaptureService is already running — call stopCaptureService() first")
            }
            promise.resolve(err)
            return
        }

        try {
            Log.d(TAG, "startCaptureService: starting ScreenCaptureService")
            val serviceIntent = Intent(reactContext, ScreenCaptureService::class.java).apply {
                putExtra("resultCode", pendingResultCode)
                putExtra("resultData", pendingResultData)
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(serviceIntent)
            } else {
                reactContext.startService(serviceIntent)
            }

            val ok = Arguments.createMap().apply {
                putBoolean("started", true)
            }
            promise.resolve(ok)
        } catch (e: Exception) {
            Log.e(TAG, "startCaptureService failed: ${e.message}")
            val err = Arguments.createMap().apply {
                putBoolean("started", false)
                putString("reason", e.message ?: "Unknown error starting service")
            }
            promise.resolve(err)
        }
    }

    // ── @ReactMethod: stopCaptureService ──────────────────────────────────────

    /**
     * Stops ScreenCaptureService and clears the one-session MediaProjection token.
     * Android 14+ does not allow reusing the same token — a fresh requestPermission()
     * is required before the next startCaptureService() call.
     */
    @ReactMethod
    fun stopCaptureService(promise: Promise) {
        try {
            Log.d(TAG, "stopCaptureService: stopping ScreenCaptureService")
            val serviceIntent = Intent(reactContext, ScreenCaptureService::class.java)
            reactContext.stopService(serviceIntent)

            // Clear the one-session token per Android 14+ requirements
            pendingResultCode = Activity.RESULT_CANCELED
            pendingResultData = null

            val ok = Arguments.createMap().apply {
                putBoolean("stopped", true)
            }
            promise.resolve(ok)
        } catch (e: Exception) {
            Log.e(TAG, "stopCaptureService failed: ${e.message}")
            val ok = Arguments.createMap().apply {
                putBoolean("stopped", false)
            }
            promise.resolve(ok)
        }
    }

    // ── @ReactMethod: getCaptureServiceStatus ──────────────────────────────────

    /**
     * Returns live status without any side effects.
     * { permissionGranted: boolean, serviceRunning: boolean, hasProjectionToken: boolean }
     */
    @ReactMethod
    fun getCaptureServiceStatus(promise: Promise) {
        val result = Arguments.createMap().apply {
            putBoolean("permissionGranted", pendingResultCode == Activity.RESULT_OK && pendingResultData != null)
            putBoolean("serviceRunning", ScreenCaptureService.isRunning)
            putBoolean("hasProjectionToken", pendingResultData != null)
        }
        promise.resolve(result)
    }

    // ── @ReactMethod: checkWiring ──────────────────────────────────────────────

    /**
     * Returns wiring diagnostics without side effects.
     * Used by the Device Readiness screen.
     */
    @ReactMethod
    fun checkWiring(promise: Promise) {
        val result = Arguments.createMap().apply {
            putBoolean("activityListenerRegistered", activityListenerRegistered)
            putInt("requestCode", MEDIA_PROJECTION_REQUEST)
            putBoolean("permissionGranted", pendingResultCode == Activity.RESULT_OK && pendingResultData != null)
            putBoolean("serviceMethodsPresent", true)
            putBoolean("singleFrameWiringPresent", true)
        }
        promise.resolve(result)
    }

    // ── @ReactMethod: getNativeDebugStatus ────────────────────────────────────

    /**
     * Returns low-level debug state useful after a crash or failed permission flow.
     * All fields are safe to read at any time — no side effects.
     *
     * {
     *   lastNativeEvent:          string  — last lifecycle event logged by the module
     *   lastNativeError:          string  — last error message (empty if no error)
     *   permissionRequestInFlight: boolean — true if requestPermission() launched but no result yet
     *   permissionGranted:         boolean — true if a valid MediaProjection token is stored
     *   hasProjectionToken:        boolean — true if pendingResultData is non-null
     *   serviceRunning:            boolean — ScreenCaptureService.isRunning
     * }
     */
    @ReactMethod
    fun getNativeDebugStatus(promise: Promise) {
        try {
            val result = Arguments.createMap().apply {
                putString("lastNativeEvent", lastNativeEvent)
                putString("lastNativeError", lastNativeError)
                putBoolean("permissionRequestInFlight", permissionRequestInFlight)
                putBoolean("permissionGranted", pendingResultCode == Activity.RESULT_OK && pendingResultData != null)
                putBoolean("hasProjectionToken", pendingResultData != null)
                putBoolean("serviceRunning", ScreenCaptureService.isRunning)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "getNativeDebugStatus: threw — ${e.message}")
            val err = Arguments.createMap().apply {
                putString("lastNativeEvent", "getNativeDebugStatus threw")
                putString("lastNativeError", e.message ?: "unknown")
                putBoolean("permissionRequestInFlight", false)
                putBoolean("permissionGranted", false)
                putBoolean("hasProjectionToken", false)
                putBoolean("serviceRunning", false)
            }
            promise.resolve(err)
        }
    }

    // ── @ReactMethod: captureSingleFrame ──────────────────────────────────────

    /**
     * Capture exactly one screen frame via VirtualDisplay + ImageReader in ScreenCaptureService.
     *
     * Requires:
     *   - ScreenCaptureService to be running (isRunning = true)
     *   - MediaProjection permission to have been granted
     *
     * Returns:
     *   { success: true, width, height, pixelFormat, timestamp }
     *   { success: false, reason: string }
     *
     * Does NOT:
     *   - Start a continuous capture loop
     *   - Run OCR
     *   - Send base64 image data over the bridge
     *   - Modify service state
     */
    @ReactMethod
    fun captureSingleFrame(promise: Promise) {
        if (!ScreenCaptureService.isRunning) {
            val err = Arguments.createMap().apply {
                putBoolean("success", false)
                putString("reason", "Capture service is not running — start it first")
            }
            promise.resolve(err)
            return
        }

        if (pendingResultCode != Activity.RESULT_OK || pendingResultData == null) {
            val err = Arguments.createMap().apply {
                putBoolean("success", false)
                putString("reason", "MediaProjection permission not granted")
            }
            promise.resolve(err)
            return
        }

        Log.d(TAG, "captureSingleFrame: delegating to ScreenCaptureService")

        // Runs on RN background thread — blocks up to 3 s inside doCaptureSingleFrame
        ScreenCaptureService.captureSingleFrame(object : ScreenCaptureService.FrameCaptureCallback {
            override fun onSuccess(width: Int, height: Int, pixelFormat: Int, timestamp: Long) {
                Log.d(TAG, "captureSingleFrame: success ${width}x${height} format=$pixelFormat")
                val result = Arguments.createMap().apply {
                    putBoolean("success", true)
                    putInt("width", width)
                    putInt("height", height)
                    putInt("pixelFormat", pixelFormat)
                    // JS bridge doesn't support Long directly — use Double (safe for timestamps)
                    putDouble("timestamp", timestamp.toDouble())
                }
                promise.resolve(result)
            }

            override fun onError(reason: String) {
                Log.e(TAG, "captureSingleFrame: error — $reason")
                val err = Arguments.createMap().apply {
                    putBoolean("success", false)
                    putString("reason", reason)
                }
                promise.resolve(err)
            }
        })
    }

    // ── @ReactMethod: requestOverlayPermission ────────────────────────────────

    @ReactMethod
    fun requestOverlayPermission(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val granted = android.provider.Settings.canDrawOverlays(reactContext)
            if (!granted) {
                val intent = Intent(
                    android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    android.net.Uri.parse("package:${reactContext.packageName}")
                )
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactContext.startActivity(intent)
                android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                    promise.resolve(android.provider.Settings.canDrawOverlays(reactContext))
                }, 3000)
            } else {
                promise.resolve(true)
            }
        } else {
            promise.resolve(true)
        }
    }

    // ── Legacy frame capture stubs (kept for CaptureContext compatibility) ────
    // Not yet wired — continuous capture is a future checkpoint.

    @ReactMethod
    fun startCapture(x: Int, y: Int, width: Int, height: Int, promise: Promise) {
        promise.reject("NOT_IMPLEMENTED", "Continuous frame capture not yet implemented — use captureSingleFrame() for this checkpoint")
    }

    @ReactMethod
    fun captureFrame(promise: Promise) {
        promise.reject("NOT_IMPLEMENTED", "Use captureSingleFrame() for the current checkpoint")
    }

    @ReactMethod
    fun stopCapture(promise: Promise) {
        stopCaptureService(promise)
    }

    // ── RN bridge stubs ───────────────────────────────────────────────────────

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}
