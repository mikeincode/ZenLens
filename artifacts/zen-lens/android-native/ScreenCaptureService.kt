package com.zenlens.app

import android.app.*
import android.content.Intent
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat

private const val TAG = "ZenLensService"

/**
 * ScreenCaptureService
 *
 * Foreground service required by Android for MediaProjection screen capture.
 * This checkpoint implements safe startup and teardown of the projection session.
 * Continuous frame capture (VirtualDisplay / ImageReader) is the next checkpoint.
 *
 * Startup sequence:
 *   1. onCreate()        — create notification channel
 *   2. onStartCommand()  — extract resultCode + resultData from Intent
 *   3.                   — call startForeground() (must happen within 5s on API 26+)
 *   4.                   — create MediaProjectionManager
 *   5.                   — call getMediaProjection(resultCode, resultData)
 *   6.                   — register MediaProjection.Callback
 *   7.                   — set isRunning = true
 *
 * Teardown:
 *   1. stopCaptureService() from JS calls context.stopService()
 *   2. onDestroy() — stop + release MediaProjection, set isRunning = false
 *
 * Android 14+ note:
 *   getMediaProjection() with the same resultData can only be called ONCE.
 *   ScreenCaptureModule.stopCaptureService() clears pendingResultData after stopping,
 *   enforcing that a fresh requestPermission() is required for each capture session.
 *
 * Declare in AndroidManifest.xml:
 *   <service
 *     android:name=".ScreenCaptureService"
 *     android:foregroundServiceType="mediaProjection"
 *     android:exported="false"/>
 */
class ScreenCaptureService : Service() {

    companion object {
        const val CHANNEL_ID = "zenlens_capture_channel"
        const val NOTIFICATION_ID = 42

        /**
         * Thread-safe running flag. Read by ScreenCaptureModule.getCaptureServiceStatus().
         * Set true after startForeground() succeeds. Set false in onDestroy().
         */
        @Volatile var isRunning = false
    }

    private var mediaProjection: MediaProjection? = null
    private var projectionManager: MediaProjectionManager? = null

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "onCreate: service created")
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
        Log.d(TAG, "onStartCommand: MediaProjection.Callback registered — service fully started, isRunning=true")

        // Next checkpoint: set up VirtualDisplay + ImageReader here for frame capture.

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

        @Suppress("DEPRECATION")
        stopForeground(true)

        isRunning = false
        Log.d(TAG, "onDestroy: service destroyed, isRunning=false")

        super.onDestroy()
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
