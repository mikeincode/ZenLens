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
 * JS Usage:
 *   import { NativeModules } from 'react-native';
 *   const { ZenLensCapture } = NativeModules;
 *
 *   // Request permission (shows system dialog)
 *   const granted: boolean = await ZenLensCapture.requestPermission();
 *
 *   // Start capture with crop rect (coordinates in screen pixels)
 *   await ZenLensCapture.startCapture(x, y, width, height);
 *
 *   // Capture a single frame as base64 PNG of the cropped area
 *   const base64: string = await ZenLensCapture.captureFrame();
 *
 *   // Stop capture and release resources
 *   await ZenLensCapture.stopCapture();
 *
 *   // Check if overlay permission is granted (SYSTEM_ALERT_WINDOW)
 *   const overlayGranted: boolean = await ZenLensCapture.requestOverlayPermission();
 *
 * Setup steps:
 *  1. Add ZenLensPackage to MainApplication.kt (see ZenLensPackage.kt)
 *  2. Add permissions to AndroidManifest.xml (see android-native/README.md)
 *  3. Ensure minSdkVersion >= 21 in build.gradle
 */
class ScreenCaptureModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val MODULE_NAME = "ZenLensCapture"
        const val MEDIA_PROJECTION_REQUEST = 1001
        const val NOTIFICATION_CHANNEL_ID = "zenlens_capture"
        const val NOTIFICATION_ID = 42
    }

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

    private var permissionPromise: Promise? = null

    override fun getName() = MODULE_NAME

    private fun initMetrics() {
        val wm = reactContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = wm.currentWindowMetrics.bounds
            screenWidth = bounds.width()
            screenHeight = bounds.height()
            screenDensity = reactContext.resources.displayMetrics.densityDpi
        } else {
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getMetrics(metrics)
            screenWidth = metrics.widthPixels
            screenHeight = metrics.heightPixels
            screenDensity = metrics.densityDpi
        }
    }

    // ─── Permission ────────────────────────────────────────────────────────

    @ReactMethod
    fun requestPermission(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No activity available")
            return
        }
        mediaProjectionManager = activity.getSystemService(
            Context.MEDIA_PROJECTION_SERVICE
        ) as MediaProjectionManager

        permissionPromise = promise
        val intent = mediaProjectionManager!!.createScreenCaptureIntent()
        activity.startActivityForResult(intent, MEDIA_PROJECTION_REQUEST)
        // Result is handled in onActivityResult below (requires ActivityEventListener)
    }

    /**
     * Call this from your Activity.onActivityResult:
     *   if (requestCode == ScreenCaptureModule.MEDIA_PROJECTION_REQUEST) {
     *     screenCaptureModule.handlePermissionResult(resultCode, data)
     *   }
     */
    fun handlePermissionResult(resultCode: Int, data: Intent?) {
        if (resultCode == Activity.RESULT_OK && data != null) {
            val projection = mediaProjectionManager!!.getMediaProjection(resultCode, data)
            mediaProjection = projection
            permissionPromise?.resolve(true)
        } else {
            permissionPromise?.resolve(false)
        }
        permissionPromise = null
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
                // Resolve after short delay — user needs to toggle manually
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

    // ─── Start / Stop ───────────────────────────────────────────────────────

    @ReactMethod
    fun startCapture(x: Int, y: Int, width: Int, height: Int, promise: Promise) {
        if (mediaProjection == null) {
            promise.reject("NOT_PERMITTED", "MediaProjection not granted — call requestPermission first")
            return
        }
        initMetrics()
        cropX = x; cropY = y; cropWidth = width; cropHeight = height

        // Start foreground service first
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

        // Create ImageReader for the full screen
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
            promise.reject("NOT_CAPTURING", "Capture not started")
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

            // Crop to the requested region
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

        val serviceIntent = Intent(reactContext, ScreenCaptureService::class.java)
        reactContext.stopService(serviceIntent)

        promise.resolve(null)
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}
