package com.zenlens.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * ZenLensPackage registers the native modules for React Native.
 *
 * Registration in MainApplication.kt:
 *   override fun getPackages(): List<ReactPackage> =
 *     PackageList(this).packages.apply {
 *       add(ZenLensPackage())
 *     }
 */
class ZenLensPackage : ReactPackage {
    override fun createNativeModules(
        reactContext: ReactApplicationContext
    ): List<NativeModule> = listOf(
        ScreenCaptureModule(reactContext),
        OverlayModule(reactContext),
        MLKitOCRModule(reactContext)
    )

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> = emptyList()
}
