package com.zenlens.app

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

private const val TAG = "ZenLensService"

/**
 * ScreenCaptureService
 *
 * Foreground service required by Android for MediaProjection screen capture.
 *
 * Startup sequence:
 *   1. onCreate()        — create notification channel, store service instance
 *   2. onStartCommand()  — extract resultCode + resultData from Intent
 *   3.                   — call startForeground() (must happen within 5s on API 26+)
 *   4.                   — create MediaProjectionManager
 *   5.                   — call getMediaProjection(resultCode, resultData)
 *   6.                   — register MediaProjection.Callback
 *   7.                   — set isRunning = true
 *
 * Teardown:
 *   1. stopCaptureService() from JS calls context.stopService()
 *   2. onDestroy() — stop + release MediaProjection, clear instance, set isRunning = false
 *
 * Single-frame capture (this checkpoint):
 *   ScreenCaptureService.captureSingleFrame(callback) is called from ScreenCaptureModule.
 *   It creates a VirtualDisplay + ImageReader, waits for one frame (3 s timeout),
 *   extracts metadata (width, height, pixelFormat, timestamp), then releases all resources.
 *   No continuous loop. No OCR. No base64 over the bridge.
 *
 * Android 14+ note:
 *   getMediaProjection() with the same resultData can only be called ONCE.
 *   ScreenCaptureModule.stopCaptureService() clears pendingResultData after stopping.
 *
 * Declare in AndroidManifest.xml:
 *   <service
 *     android:name=".ScreenCaptureService"
 *     android:foregroundServiceType="mediaProjection"
 *     android:exported="false"/>
 */
class ScreenCaptureService : Service() {

    // ── FrameCaptureCallback ─────────────────────────────────────────────────

    /**
     * Callback delivered by captureSingleFrame().
     * Called exactly once — either onSuccess or onError.
     */
    interface FrameCaptureCallback {
        fun onSuccess(width: Int, height: Int, pixelFormat: Int, timestamp: Long)
        fun onError(reason: String)
    }

    // ── RegionCaptureCallback ─────────────────────────────────────────────────

    /**
     * Callback delivered by captureRegion().
     * Called exactly once — either onSuccess or onError.
     *
     * onSuccess fields:
     *   sourceWidth/Height — actual pixel dimensions of the captured full frame
     *   cropX/Y/Width/Height — clamped rectangle that was extracted from the frame
     *   pixelFormat — Android PixelFormat constant (1 = RGBA_8888)
     *   timestamp   — nanosecond timestamp of the captured frame
     */
    interface RegionCaptureCallback {
        fun onSuccess(
            sourceWidth: Int, sourceHeight: Int,
            cropX: Int, cropY: Int, cropWidth: Int, cropHeight: Int,
            pixelFormat: Int, timestamp: Long
        )
        fun onError(reason: String)
    }

    // ── Companion object ─────────────────────────────────────────────────────

    companion object {
        const val CHANNEL_ID = "zenlens_capture_channel"
        const val NOTIFICATION_ID = 42

        /**
         * Thread-safe running flag. Read by ScreenCaptureModule.getCaptureServiceStatus().
         * Set true after startForeground() succeeds. Set false in onDestroy().
         */
        @Volatile var isRunning = false

        /**
         * Reference to the running service instance.
         * Set in onCreate(), cleared in onDestroy().
         * Access only via captureSingleFrame() — do not read fields directly.
         */
        @Volatile private var instance: ScreenCaptureService? = null

        /**
         * Capture exactly one screen frame via VirtualDisplay + ImageReader.
         *
         * Safe to call from any thread (uses a dedicated HandlerThread internally).
         * Blocks the calling thread for at most 3 seconds (timeout path).
         *
         * Resource guarantees:
         *   - Image.close()          always called
         *   - ImageReader.close()    always called
         *   - VirtualDisplay.release() always called
         *   - HandlerThread.quitSafely() always called
         *
         * Returns via callback — never throws.
         */
        fun captureSingleFrame(callback: FrameCaptureCallback) {
            val svc = instance
            if (svc == null || !isRunning) {
                callback.onError("Capture service is not running")
                return
            }
            svc.doCaptureSingleFrame(callback)
        }

        /**
         * Capture exactly one screen frame and extract a rectangular region.
         *
         * x, y must be >= 0.
         * width, height must be > 0.
         * Crop is clamped to source frame bounds — no rejection for partial overlap.
         *
         * Resource guarantees same as captureSingleFrame():
         *   Image.close(), ImageReader.close(), VirtualDisplay.release(),
         *   HandlerThread.quitSafely() — all always called.
         *
         * Timeout: 3 seconds.
         * Returns metadata only — no pixel data transferred over the bridge.
         */
        fun captureRegion(x: Int, y: Int, width: Int, height: Int, callback: RegionCaptureCallback) {
            val svc = instance
            if (svc == null || !isRunning) {
                callback.onError("Capture service is not running")
                return
            }
            svc.doCaptureRegion(x, y, width, height, callback)
        }
    }

    // ── Instance state ────────────────────────────────────────────────────────

    private var mediaProjection: MediaProjection? = null
    private var projectionManager: MediaProjectionManager? = null

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        instance = this
        Log.d(TAG, "onCreate: service created, instance registered")
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand: received")

        // ── Handle STOP action (from notification "Stop" button) ──────────────
        if (intent?.action == "STOP") {
            Log.d(TAG, "onStartCommand: STOP action received — stopping self")
            stopSelf()
            return START_NOT_STICKY
        }

        // ── Extract MediaProjection grant from Intent extras ───────────────────
        val resultCode = intent?.getIntExtra("resultCode", Activity.RESULT_CANCELED)
            ?: Activity.RESULT_CANCELED

        val resultData: Intent? = if (Build.VERSION.SDK_INT >= 33) {
            intent?.getParcelableExtra("resultData", Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent?.getParcelableExtra("resultData")
        }

        Log.d(TAG, "onStartCommand: resultCode=$resultCode, hasResultData=${resultData != null}")

        if (resultCode != Activity.RESULT_OK || resultData == null) {
            Log.e(TAG, "onStartCommand: invalid grant extras — stopping service")
            stopSelf()
            return START_NOT_STICKY
        }

        // ── Build persistent notification ─────────────────────────────────────
        val stopPendingIntent = PendingIntent.getService(
            this, 0,
            Intent(this, ScreenCaptureService::class.java).apply { action = "STOP" },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val openPendingIntent = PendingIntent.getActivity(
            this, 0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("ZenLens — Screen Capture Active")
            .setContentText("Tap to return to ZenLens. Tap Stop to end capture.")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setContentIntent(openPendingIntent)
            .addAction(android.R.drawable.ic_media_pause, "Stop", stopPendingIntent)
            .build()

        // ── startForeground() — MUST happen within 5s of service start ─────────
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        Log.d(TAG, "onStartCommand: startForeground() called")

        // ── Create MediaProjection ─────────────────────────────────────────────
        projectionManager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager

        try {
            mediaProjection = projectionManager!!.getMediaProjection(resultCode, resultData)
            Log.d(TAG, "onStartCommand: MediaProjection created — ${mediaProjection != null}")
        } catch (e: Exception) {
            Log.e(TAG, "onStartCommand: getMediaProjection() failed: ${e.message}")
            stopSelf()
            return START_NOT_STICKY
        }

        if (mediaProjection == null) {
            Log.e(TAG, "onStartCommand: getMediaProjection() returned null — stopping")
            stopSelf()
            return START_NOT_STICKY
        }

        // ── Register MediaProjection.Callback ─────────────────────────────────
        // Required to be notified when the system or user ends the projection
        // (e.g. user taps "Stop sharing" in the Android status bar).
        mediaProjection!!.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                Log.d(TAG, "MediaProjection.Callback.onStop: projection stopped by system")
                isRunning = false
                stopSelf()
            }
        }, null)

        isRunning = true
        Log.d(TAG, "onStartCommand: MediaProjection.Callback registered — isRunning=true")

        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        Log.d(TAG, "onDestroy: cleaning up")

        try {
            mediaProjection?.stop()
            Log.d(TAG, "onDestroy: MediaProjection stopped")
        } catch (e: Exception) {
            Log.e(TAG, "onDestroy: error stopping MediaProjection: ${e.message}")
        }
        mediaProjection = null
        projectionManager = null
        instance = null

        @Suppress("DEPRECATION")
        stopForeground(true)

        isRunning = false
        Log.d(TAG, "onDestroy: service destroyed, isRunning=false, instance cleared")

        super.onDestroy()
    }

    // ── Single-frame capture ──────────────────────────────────────────────────

    /**
     * Capture exactly one screen frame.
     *
     * Steps:
     *   1. Read screen dimensions from WindowManager
     *   2. Create ImageReader (RGBA_8888, 2 buffers)
     *   3. Create VirtualDisplay from the active MediaProjection
     *   4. Wait up to 3 seconds for the ImageReader listener to fire
     *   5. Extract metadata from the Image (width, height, pixelFormat, timestamp)
     *   6. Close Image, release VirtualDisplay, close ImageReader, quit HandlerThread
     *   7. Deliver result via callback
     *
     * Threading: safe to call from any thread.
     * The caller thread is blocked for at most 3 seconds by CountDownLatch.await().
     * The ImageReader listener is posted to a dedicated HandlerThread (never main thread).
     */
    private fun doCaptureSingleFrame(callback: FrameCaptureCallback) {
        val mp = mediaProjection
        if (mp == null) {
            Log.e(TAG, "doCaptureSingleFrame: mediaProjection is null")
            callback.onError("MediaProjection not available — service may be stopping")
            return
        }

        // ── Get screen dimensions ─────────────────────────────────────────────
        val wm = getSystemService(WINDOW_SERVICE) as WindowManager
        val width: Int
        val height: Int
        val density: Int

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = wm.currentWindowMetrics.bounds
            width = bounds.width()
            height = bounds.height()
            density = resources.configuration.densityDpi
        } else {
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getMetrics(metrics)
            width = metrics.widthPixels
            height = metrics.heightPixels
            density = metrics.densityDpi
        }

        Log.d(TAG, "doCaptureSingleFrame: screen ${width}x${height} density=$density")

        var imageReader: ImageReader? = null
        var virtualDisplay: VirtualDisplay? = null
        var handlerThread: HandlerThread? = null

        fun releaseAll() {
            try { virtualDisplay?.release() } catch (e: Exception) {
                Log.w(TAG, "releaseAll: VirtualDisplay.release() error: ${e.message}")
            }
            try { imageReader?.close() } catch (e: Exception) {
                Log.w(TAG, "releaseAll: ImageReader.close() error: ${e.message}")
            }
            try { handlerThread?.quitSafely() } catch (e: Exception) {
                Log.w(TAG, "releaseAll: HandlerThread.quitSafely() error: ${e.message}")
            }
            virtualDisplay = null
            imageReader = null
            handlerThread = null
        }

        try {
            // ── Dedicated handler thread for ImageReader listener ─────────────
            // Using a HandlerThread avoids posting to the main looper,
            // which would deadlock if this method was ever called from main thread.
            handlerThread = HandlerThread("ZenLensFrameCapture")
            handlerThread!!.start()
            val handler = Handler(handlerThread!!.looper)

            val latch = CountDownLatch(1)
            var capturedWidth = 0
            var capturedHeight = 0
            var capturedFormat = 0
            var capturedTimestamp = 0L
            var captureError: String? = null

            // ── Create ImageReader ────────────────────────────────────────────
            imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)

            imageReader!!.setOnImageAvailableListener({ reader ->
                // Called on HandlerThread — not main thread
                if (latch.count > 0L) {
                    var img: Image? = null
                    try {
                        img = reader.acquireLatestImage()
                        if (img != null) {
                            capturedWidth = img.width
                            capturedHeight = img.height
                            capturedFormat = img.format
                            capturedTimestamp = img.timestamp
                            Log.d(TAG, "doCaptureSingleFrame: frame received ${capturedWidth}x${capturedHeight} format=$capturedFormat ts=$capturedTimestamp")
                        } else {
                            captureError = "acquireLatestImage() returned null"
                            Log.w(TAG, "doCaptureSingleFrame: acquireLatestImage() returned null")
                        }
                    } catch (e: Exception) {
                        captureError = "Error acquiring image: ${e.message}"
                        Log.e(TAG, "doCaptureSingleFrame: image acquire error: ${e.message}")
                    } finally {
                        try { img?.close() } catch (e: Exception) {
                            Log.w(TAG, "doCaptureSingleFrame: Image.close() error: ${e.message}")
                        }
                        latch.countDown()
                    }
                }
            }, handler)

            // ── Create VirtualDisplay ─────────────────────────────────────────
            virtualDisplay = mp.createVirtualDisplay(
                "ZenLensSingleFrame",
                width, height, density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader!!.surface,
                null, null
            )
            Log.d(TAG, "doCaptureSingleFrame: VirtualDisplay created, waiting for frame...")

            // ── Wait for exactly one frame (3 s timeout) ──────────────────────
            val gotFrame = latch.await(3, TimeUnit.SECONDS)

            releaseAll()

            when {
                !gotFrame -> {
                    Log.w(TAG, "doCaptureSingleFrame: timed out waiting for frame")
                    callback.onError("Timed out waiting for frame")
                }
                captureError != null -> {
                    Log.e(TAG, "doCaptureSingleFrame: capture error — $captureError")
                    callback.onError(captureError!!)
                }
                capturedWidth == 0 || capturedHeight == 0 -> {
                    Log.e(TAG, "doCaptureSingleFrame: zero-size frame")
                    callback.onError("Frame had zero dimensions — unexpected error")
                }
                else -> {
                    Log.d(TAG, "doCaptureSingleFrame: success ${capturedWidth}x${capturedHeight}")
                    callback.onSuccess(capturedWidth, capturedHeight, capturedFormat, capturedTimestamp)
                }
            }

        } catch (e: Exception) {
            Log.e(TAG, "doCaptureSingleFrame: exception — ${e.message}")
            releaseAll()
            callback.onError(e.message ?: "Unknown error during frame capture")
        }
    }

    // ── doCaptureRegion ───────────────────────────────────────────────────────

    /**
     * Capture exactly one screen frame and return metadata for a cropped rectangle.
     *
     * Same HandlerThread + CountDownLatch + releaseAll() idiom as doCaptureSingleFrame().
     * No pixel data is transferred over the JS bridge — metadata only.
     *
     * Crop clamp rules:
     *   • x, y clamped to [0, sourceWidth/Height - 1]
     *   • width clamped to (sourceWidth - clampedX), height clamped to (sourceHeight - clampedY)
     *   • If the clamped rect has zero area, onError is called instead of onSuccess
     *
     * Resource cleanup: Image.close(), ImageReader.close(), VirtualDisplay.release(),
     * HandlerThread.quitSafely() all called from releaseAll() before returning.
     */
    private fun doCaptureRegion(
        x: Int,
        y: Int,
        cropW: Int,
        cropH: Int,
        callback: RegionCaptureCallback
    ) {
        val mp = mediaProjection
        if (mp == null) {
            Log.e(TAG, "doCaptureRegion: mediaProjection is null")
            callback.onError("MediaProjection not available — service may be stopping")
            return
        }

        // ── Validate raw inputs before allocating resources ───────────────────
        if (cropW <= 0 || cropH <= 0) {
            callback.onError("Invalid crop dimensions: width=$cropW height=$cropH — both must be > 0")
            return
        }
        if (x < 0 || y < 0) {
            callback.onError("Invalid crop origin: x=$x y=$y — must be >= 0")
            return
        }

        // ── Get screen dimensions ─────────────────────────────────────────────
        val wm = getSystemService(WINDOW_SERVICE) as WindowManager
        val screenW: Int
        val screenH: Int
        val density: Int

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = wm.currentWindowMetrics.bounds
            screenW = bounds.width()
            screenH = bounds.height()
            density = resources.configuration.densityDpi
        } else {
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getMetrics(metrics)
            screenW = metrics.widthPixels
            screenH = metrics.heightPixels
            density = metrics.densityDpi
        }

        Log.d(TAG, "doCaptureRegion: screen ${screenW}x${screenH} density=$density crop=($x,$y) ${cropW}x${cropH}")

        var imageReader: ImageReader? = null
        var virtualDisplay: VirtualDisplay? = null
        var handlerThread: HandlerThread? = null

        fun releaseAll() {
            try { virtualDisplay?.release() } catch (e: Exception) {
                Log.w(TAG, "doCaptureRegion releaseAll: VirtualDisplay.release() error: ${e.message}")
            }
            try { imageReader?.close() } catch (e: Exception) {
                Log.w(TAG, "doCaptureRegion releaseAll: ImageReader.close() error: ${e.message}")
            }
            try { handlerThread?.quitSafely() } catch (e: Exception) {
                Log.w(TAG, "doCaptureRegion releaseAll: HandlerThread.quitSafely() error: ${e.message}")
            }
            virtualDisplay = null
            imageReader = null
            handlerThread = null
        }

        try {
            handlerThread = HandlerThread("ZenLensRegionCapture")
            handlerThread!!.start()
            val handler = Handler(handlerThread!!.looper)

            val latch = CountDownLatch(1)
            var capturedWidth = 0
            var capturedHeight = 0
            var capturedFormat = 0
            var capturedTimestamp = 0L
            var captureError: String? = null

            imageReader = ImageReader.newInstance(screenW, screenH, PixelFormat.RGBA_8888, 2)

            imageReader!!.setOnImageAvailableListener({ reader ->
                if (latch.count > 0L) {
                    var img: Image? = null
                    try {
                        img = reader.acquireLatestImage()
                        if (img != null) {
                            capturedWidth = img.width
                            capturedHeight = img.height
                            capturedFormat = img.format
                            capturedTimestamp = img.timestamp
                            Log.d(TAG, "doCaptureRegion: frame received ${capturedWidth}x${capturedHeight}")
                        } else {
                            captureError = "acquireLatestImage() returned null"
                            Log.w(TAG, "doCaptureRegion: acquireLatestImage() returned null")
                        }
                    } catch (e: Exception) {
                        captureError = "Error acquiring image: ${e.message}"
                        Log.e(TAG, "doCaptureRegion: image acquire error: ${e.message}")
                    } finally {
                        try { img?.close() } catch (e: Exception) {
                            Log.w(TAG, "doCaptureRegion: Image.close() error: ${e.message}")
                        }
                        latch.countDown()
                    }
                }
            }, handler)

            virtualDisplay = mp.createVirtualDisplay(
                "ZenLensRegionCapture",
                screenW, screenH, density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader!!.surface,
                null, null
            )
            Log.d(TAG, "doCaptureRegion: VirtualDisplay created, waiting for frame...")

            val gotFrame = latch.await(3, TimeUnit.SECONDS)
            releaseAll()

            when {
                !gotFrame -> {
                    Log.w(TAG, "doCaptureRegion: timed out waiting for frame")
                    callback.onError("Timed out waiting for frame during region capture")
                }
                captureError != null -> {
                    Log.e(TAG, "doCaptureRegion: capture error — $captureError")
                    callback.onError(captureError!!)
                }
                capturedWidth == 0 || capturedHeight == 0 -> {
                    Log.e(TAG, "doCaptureRegion: zero-size frame")
                    callback.onError("Frame had zero dimensions — unexpected error")
                }
                else -> {
                    // ── Clamp crop rect to actual frame bounds ────────────────
                    val clampedX = x.coerceIn(0, capturedWidth - 1)
                    val clampedY = y.coerceIn(0, capturedHeight - 1)
                    val clampedW = cropW.coerceAtMost(capturedWidth - clampedX)
                    val clampedH = cropH.coerceAtMost(capturedHeight - clampedY)

                    if (clampedW <= 0 || clampedH <= 0) {
                        val msg = "Crop rectangle is entirely outside the source frame: " +
                            "source=${capturedWidth}x${capturedHeight} " +
                            "requested=($x,$y) ${cropW}x${cropH}"
                        Log.e(TAG, "doCaptureRegion: $msg")
                        callback.onError(msg)
                    } else {
                        Log.d(TAG, "doCaptureRegion: success — source=${capturedWidth}x${capturedHeight} crop=($clampedX,$clampedY) ${clampedW}x${clampedH}")
                        callback.onSuccess(
                            capturedWidth, capturedHeight,
                            clampedX, clampedY, clampedW, clampedH,
                            capturedFormat, capturedTimestamp
                        )
                    }
                }
            }

        } catch (e: Exception) {
            Log.e(TAG, "doCaptureRegion: exception — ${e.message}")
            releaseAll()
            callback.onError(e.message ?: "Unknown error during region capture")
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "ZenLens Screen Capture",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shown while ZenLens is capturing your screen"
                setShowBadge(false)
            }
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
            Log.d(TAG, "createNotificationChannel: channel created")
        }
    }
}
