package com.zenlens.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.util.Base64
import android.util.DisplayMetrics
import android.view.WindowManager
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

/**
 * ScreenCaptureModule
 *
 * Bridges the React Native layer to Android's MediaProjection API.
 * Exposed as NativeModules.ZenLensCapture in JavaScript.
 *
 * ── Permission flow ──────────────────────────────────────────────────────────
 *
 * This module implements ActivityEventListener — React Native's built-in
 * mechanism for receiving onActivityResult callbacks.  RN automatically forwards
 * every Activity result to all registered listeners; no MainActivity patching is
 * strictly required, but the config plugin also patches MainActivity as a
 * belt-and-suspenders measure (see withZenLensNativeModules.js).
 *
 * To prevent double-invocation (from both ActivityEventListener AND the explicit
 * MainActivity forward), onMediaProjectionResult() carries a short-lived
 * "resultHandled" guard that makes it idempotent.
 *
 * JS usage:
 *   import { NativeModules } from 'react-native';
 *   const { ZenLensCapture } = NativeModules;
 *
 *   // Verify wiring before attempting capture
 *   const wiring = await ZenLensCapture.checkWiring();
 *   // → { activityListenerRegistered: true, requestCode: 1001, permissionGranted: false }
 *
 *   // Request MediaProjection permission (shows Android system dialog)
 *   const granted: boolean = await ZenLensCapture.requestPermission();
 *
 *   // Start capture with crop rect (coordinates in screen pixels)
 *   await ZenLensCapture.startCapture(x, y, width, height);
 *
 *   // Capture a single frame as base64 PNG of the cropped area
 *   const base64: string | null = await ZenLensCapture.captureFrame();
 *
 *   // Stop capture and release resources
 *   await ZenLensCapture.stopCapture();
 *
 *   // Check overlay permission (SYSTEM_ALERT_WINDOW)
 *   const overlayGranted: boolean = await ZenLensCapture.requestOverlayPermission();
 */
class ScreenCaptureModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        const val MODULE_NAME = "ZenLensCapture"
        /** Request code used with startActivityForResult for MediaProjection. */
        const val MEDIA_PROJECTION_REQUEST = 1001
        const val NOTIFICATION_CHANNEL_ID = "zenlens_capture"
        const val NOTIFICATION_ID = 42
    }

    // ─── State ────────────────────────────────────────────────────────────────

    private var mediaProjectionManager: MediaProjectionManager? = null
    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null

    private var cropX = 0
    private var cropY = 0
    private var cropWidth = 800
    private var cropHeight = 600
    private var screenWidth = 0
    private var screenHeight = 0
    private var screenDensity = 0

    /** Pending JS promise for requestPermission(). Resolved in onMediaProjectionResult(). */
    private var permissionPromise: Promise? = null

    /**
     * Deduplication guard — prevents double-resolving the promise when both
     * ActivityEventListener AND the explicit MainActivity forward fire for the
     * same result.  Reset to false 500ms after first invocation.
     */
    @Volatile private var resultHandled = false

    /**
     * Stored permission grant, used when starting the foreground service later.
     * Non-null means the user has granted MediaProjection for this session.
     */
    private var pendingResultCode: Int = Activity.RESULT_CANCELED
    private var pendingResultData: Intent? = null

    /** True once ActivityEventListener has been registered. */
    private var activityListenerRegistered = false

    // ─── Init ─────────────────────────────────────────────────────────────────

    init {
        reactContext.addActivityEventListener(this)
        activityListenerRegistered = true
    }

    override fun getName() = MODULE_NAME

    // ─── ActivityEventListener ─────────────────────────────────────────────────
    //
    // React Native automatically calls these for every activity result.
    // This is the PRIMARY path for receiving the MediaProjection grant.

    override fun onActivityResult(
        activity: Activity?,
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
        if (requestCode == MEDIA_PROJECTION_REQUEST) {
            onMediaProjectionResult(resultCode, data)
        }
    }

    override fun onNewIntent(intent: Intent?) {
        // No-op — required by ActivityEventListener interface
    }

    // ─── Permission result handler (idempotent) ────────────────────────────────
    //
    // Called from both:
    //   • ActivityEventListener.onActivityResult (primary, always fires)
    //   • MainActivity.onActivityResult patch (belt-and-suspenders)
    //
    // The resultHandled guard ensures only the first call does anything.

    fun onMediaProjectionResult(resultCode: Int, data: Intent?) {
        if (resultHandled) return
        resultHandled = true

        // Reset guard after 500ms so the module can handle a second permission request
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            resultHandled = false
        }, 500)

        if (resultCode == Activity.RESULT_OK && data != null) {
            // Store the grant so startCapture() can use it to create the MediaProjection
            pendingResultCode = resultCode
            pendingResultData = data
            // Create the MediaProjection object immediately (it must be created in the
            // same process that received the result, before the foreground service starts)
            mediaProjection = mediaProjectionManager?.getMediaProjection(resultCode, data)
            permissionPromise?.resolve(true)
        } else {
            pendingResultCode = Activity.RESULT_CANCELED
            pendingResultData = null
            mediaProjection = null
            permissionPromise?.resolve(false)
        }
        permissionPromise = null
    }

    // ─── @ReactMethod: Permission ──────────────────────────────────────────────

    /**
     * Verifies the permission wiring is in place without actually requesting
     * anything from the user.  Call this from the Device Readiness screen.
     *
     * Returns a JS object:
     *   {
     *     activityListenerRegistered: Boolean,  // always true if module loaded correctly
     *     requestCode: Int,                     // MEDIA_PROJECTION_REQUEST constant value
     *     permissionGranted: Boolean            // whether permission is currently held
     *   }
     */
    @ReactMethod
    fun checkWiring(promise: Promise) {
        val result = Arguments.createMap().apply {
            putBoolean("activityListenerRegistered", activityListenerRegistered)
            putInt("requestCode", MEDIA_PROJECTION_REQUEST)
            putBoolean("permissionGranted", mediaProjection != null)
        }
        promise.resolve(result)
    }

    /**
     * Requests MediaProjection permission from Android.
     * Shows the system "Start recording?" dialog.
     *
     * Resolves to:
     *   true  — permission granted, mediaProjection object is stored
     *   false — user denied or activity unavailable
     */
    @ReactMethod
    fun requestPermission(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No activity available — ensure the app is in the foreground")
            return
        }

        mediaProjectionManager = activity.getSystemService(
            Context.MEDIA_PROJECTION_SERVICE
        ) as MediaProjectionManager

        permissionPromise = promise
        resultHandled = false  // Reset so the result can be received

        val intent = mediaProjectionManager!!.createScreenCaptureIntent()
        activity.startActivityForResult(intent, MEDIA_PROJECTION_REQUEST)
        // Result delivered via onMediaProjectionResult() — either through
        // ActivityEventListener (primary) or MainActivity patch (secondary)
    }

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
                // Poll after 3 s — user must manually toggle in Settings
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

    // ─── @ReactMethod: Capture lifecycle ──────────────────────────────────────

    @ReactMethod
    fun startCapture(x: Int, y: Int, width: Int, height: Int, promise: Promise) {
        if (mediaProjection == null) {
            promise.reject(
                "NOT_PERMITTED",
                "MediaProjection not granted — call requestPermission() first and wait for it to resolve true"
            )
            return
        }
        initMetrics()
        cropX = x; cropY = y; cropWidth = width; cropHeight = height

        // Start the foreground service (Android requires it for screen capture)
        val serviceIntent = Intent(reactContext, ScreenCaptureService::class.java).apply {
            putExtra("cropX", cropX)
            putExtra("cropY", cropY)
            putExtra("cropWidth", cropWidth)
            putExtra("cropHeight", cropHeight)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactContext.startForegroundService(serviceIntent)
        } else {
            reactContext.startService(serviceIntent)
        }

        // Create the ImageReader and VirtualDisplay
        imageReader = ImageReader.newInstance(
            screenWidth, screenHeight,
            PixelFormat.RGBA_8888, 2
        )
        virtualDisplay = mediaProjection!!.createVirtualDisplay(
            "ZenLensCapture",
            screenWidth, screenHeight, screenDensity,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader!!.surface, null, null
        )
        promise.resolve(true)
    }

    @ReactMethod
    fun captureFrame(promise: Promise) {
        val reader = imageReader
        if (reader == null) {
            promise.reject("NOT_CAPTURING", "Capture not started — call startCapture() first")
            return
        }

        val image: Image? = reader.acquireLatestImage()
        if (image == null) {
            promise.resolve(null)
            return
        }

        try {
            val planes = image.planes
            val buffer: ByteBuffer = planes[0].buffer
            val pixelStride: Int = planes[0].pixelStride
            val rowStride: Int = planes[0].rowStride
            val rowPadding: Int = rowStride - pixelStride * screenWidth

            val bitmap = Bitmap.createBitmap(
                screenWidth + rowPadding / pixelStride,
                screenHeight,
                Bitmap.Config.ARGB_8888
            )
            bitmap.copyPixelsFromBuffer(buffer)

            val safeCropX = cropX.coerceIn(0, screenWidth - 1)
            val safeCropY = cropY.coerceIn(0, screenHeight - 1)
            val safeCropW = cropWidth.coerceIn(1, screenWidth - safeCropX)
            val safeCropH = cropHeight.coerceIn(1, screenHeight - safeCropY)

            val cropped = Bitmap.createBitmap(bitmap, safeCropX, safeCropY, safeCropW, safeCropH)
            bitmap.recycle()

            val baos = ByteArrayOutputStream()
            cropped.compress(Bitmap.CompressFormat.PNG, 90, baos)
            cropped.recycle()

            val base64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
            promise.resolve(base64)
        } finally {
            image.close()
        }
    }

    @ReactMethod
    fun stopCapture(promise: Promise) {
        virtualDisplay?.release()
        virtualDisplay = null
        imageReader?.close()
        imageReader = null
        mediaProjection?.stop()
        mediaProjection = null
        pendingResultCode = Activity.RESULT_CANCELED
        pendingResultData = null

        val serviceIntent = Intent(reactContext, ScreenCaptureService::class.java)
        reactContext.stopService(serviceIntent)

        promise.resolve(null)
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    private fun initMetrics() {
        val wm = reactContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = wm.currentWindowMetrics.bounds
            screenWidth = bounds.width()
            screenHeight = bounds.height()
            screenDensity = reactContext.resources.displayMetrics.densityDpi
        } else {
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getMetrics(metrics)
            screenWidth = metrics.widthPixels
            screenHeight = metrics.heightPixels
            screenDensity = metrics.densityDpi
        }
    }

    // ─── RN event bridge stubs ────────────────────────────────────────────────

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}
