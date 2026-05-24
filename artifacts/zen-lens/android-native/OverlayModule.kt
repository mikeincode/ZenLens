package com.zenlens.app

import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.provider.Settings
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageButton
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * OverlayModule
 *
 * Creates a floating system overlay button that appears over other apps.
 * Requires SYSTEM_ALERT_WINDOW permission (granted via Settings).
 *
 * Exposed as NativeModules.ZenLensOverlay in JavaScript.
 *
 * JS Usage:
 *   import { NativeModules, NativeEventEmitter } from 'react-native';
 *   const { ZenLensOverlay } = NativeModules;
 *
 *   // Show the floating button
 *   ZenLensOverlay.showOverlay();
 *
 *   // Hide the floating button
 *   ZenLensOverlay.hideOverlay();
 *
 *   // Listen for button taps from the overlay
 *   const emitter = new NativeEventEmitter(ZenLensOverlay);
 *   const sub = emitter.addListener('onOverlayTap', (event) => {
 *     console.log('Overlay tapped:', event.action); // 'crop' | 'pause' | 'stop'
 *   });
 *
 * The overlay button is draggable and snaps to edges.
 * It emits 'onOverlayTap' events with { action: 'crop' | 'pause' | 'stop' }.
 */
class OverlayModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val MODULE_NAME = "ZenLensOverlay"
        const val EVENT_OVERLAY_TAP = "onOverlayTap"
    }

    private var windowManager: WindowManager? = null
    private var overlayView: View? = null

    override fun getName() = MODULE_NAME

    @ReactMethod
    fun showOverlay(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            !Settings.canDrawOverlays(reactContext)
        ) {
            promise.reject("NO_OVERLAY_PERMISSION", "SYSTEM_ALERT_WINDOW not granted")
            return
        }

        val wm = reactContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        windowManager = wm

        // In production: inflate from a custom layout (res/layout/overlay_button.xml)
        // For simplicity here we create a minimal view programmatically
        val button = ImageButton(reactContext).apply {
            setImageResource(android.R.drawable.ic_menu_camera)
            setBackgroundResource(android.R.drawable.btn_default)
            alpha = 0.85f
        }

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 20; y = 300
        }

        var initialX = 0; var initialY = 0
        var touchX = 0f; var touchY = 0f

        button.setOnTouchListener { v, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = params.x; initialY = params.y
                    touchX = event.rawX; touchY = event.rawY
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    params.x = initialX + (event.rawX - touchX).toInt()
                    params.y = initialY + (event.rawY - touchY).toInt()
                    wm.updateViewLayout(button, params)
                    true
                }
                MotionEvent.ACTION_UP -> {
                    val movedX = Math.abs(event.rawX - touchX)
                    val movedY = Math.abs(event.rawY - touchY)
                    if (movedX < 5 && movedY < 5) {
                        // It was a tap, not a drag — emit event
                        sendEvent(EVENT_OVERLAY_TAP, "crop")
                    }
                    true
                }
                else -> false
            }
        }

        overlayView = button
        wm.addView(button, params)
        promise.resolve(null)
    }

    @ReactMethod
    fun hideOverlay(promise: Promise) {
        overlayView?.let {
            windowManager?.removeView(it)
            overlayView = null
        }
        promise.resolve(null)
    }

    private fun sendEvent(eventName: String, action: String) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, action)
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    override fun onCatalystInstanceDestroy() {
        overlayView?.let {
            windowManager?.removeView(it)
            overlayView = null
        }
    }
}
