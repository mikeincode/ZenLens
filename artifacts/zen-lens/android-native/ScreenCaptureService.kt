package com.zenlens.app

import android.app.*
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * ScreenCaptureService
 *
 * A foreground service required by Android to run screen capture in the background.
 * Android 10+ requires FOREGROUND_SERVICE_MEDIA_PROJECTION type.
 *
 * Declare in AndroidManifest.xml:
 *
 *   <uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
 *   <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION"/>
 *
 *   <service
 *     android:name=".ScreenCaptureService"
 *     android:foregroundServiceType="mediaProjection"
 *     android:exported="false"/>
 */
class ScreenCaptureService : Service() {

    companion object {
        const val CHANNEL_ID = "zenlens_capture_channel"
        const val NOTIFICATION_ID = 42
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val cropX = intent?.getIntExtra("cropX", 0) ?: 0
        val cropY = intent?.getIntExtra("cropY", 0) ?: 0
        val cropW = intent?.getIntExtra("cropWidth", 0) ?: 0
        val cropH = intent?.getIntExtra("cropHeight", 0) ?: 0

        val stopIntent = Intent(this, ScreenCaptureService::class.java).apply {
            action = "STOP"
        }
        val stopPendingIntent = PendingIntent.getService(
            this, 0, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val openPendingIntent = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("ZenLens — Capturing")
            .setContentText("Crop: ${cropW}×${cropH} at (${cropX}, ${cropY})")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setContentIntent(openPendingIntent)
            .addAction(
                android.R.drawable.ic_media_pause,
                "Stop",
                stopPendingIntent
            )
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        if (intent?.action == "STOP") {
            stopForeground(true)
            stopSelf()
        }

        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        stopForeground(true)
    }

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
            val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }
}
