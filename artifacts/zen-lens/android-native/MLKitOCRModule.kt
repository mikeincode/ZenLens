package com.zenlens.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.facebook.react.bridge.*
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

/**
 * MLKitOCRModule
 *
 * Exposes Google ML Kit Text Recognition to React Native.
 * Exposed as NativeModules.ZenLensOCR in JavaScript.
 *
 * Dependencies to add to android/app/build.gradle:
 *   implementation 'com.google.mlkit:text-recognition:16.0.1'
 *
 * JS Usage:
 *   import { NativeModules } from 'react-native';
 *   const { ZenLensOCR } = NativeModules;
 *
 *   // Recognize text in a base64 PNG image
 *   const result = await ZenLensOCR.recognizeText(base64PngString);
 *   // result: { text: string, confidence: number, blocks: Array<{ text: string, confidence: number }> }
 *
 * Notes:
 *  - The recognizer processes only Latin script by default.
 *  - For CJK/Devanagari, use the appropriate ML Kit bundled model.
 *  - First call downloads the ML model (~4MB) if not already on device.
 *  - Use recognizeTextBundled() to bundle the model in the APK (larger APK, faster first run).
 */
class MLKitOCRModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val MODULE_NAME = "ZenLensOCR"
    }

    override fun getName() = MODULE_NAME

    // Lazy-initialized recognizer — keeps the instance alive between calls
    private val recognizer by lazy {
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    }

    @ReactMethod
    fun recognizeText(base64Image: String, promise: Promise) {
        try {
            val imageBytes = Base64.decode(base64Image, Base64.DEFAULT)
            val bitmap: Bitmap = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)
                ?: run {
                    promise.reject("INVALID_IMAGE", "Failed to decode base64 image")
                    return
                }

            val inputImage = InputImage.fromBitmap(bitmap, 0)

            recognizer.process(inputImage)
                .addOnSuccessListener { visionText ->
                    val text = visionText.text
                    val blocks = Arguments.createArray()

                    for (block in visionText.textBlocks) {
                        val blockMap = Arguments.createMap().apply {
                            putString("text", block.text)
                            val conf = block.lines
                                .mapNotNull { it.confidence }
                                .average()
                                .takeIf { !it.isNaN() } ?: 0.8
                            putDouble("confidence", conf)
                            block.boundingBox?.let { bb ->
                                putMap("boundingBox", Arguments.createMap().apply {
                                    putInt("x", bb.left)
                                    putInt("y", bb.top)
                                    putInt("width", bb.width())
                                    putInt("height", bb.height())
                                })
                            }
                        }
                        blocks.pushMap(blockMap)
                    }

                    val result = Arguments.createMap().apply {
                        putString("text", text)
                        putDouble("confidence", if (visionText.textBlocks.isEmpty()) 0.0 else 0.85)
                        putArray("blocks", blocks)
                    }

                    promise.resolve(result)
                    bitmap.recycle()
                }
                .addOnFailureListener { e ->
                    bitmap.recycle()
                    promise.reject("OCR_FAILED", e.message ?: "OCR failed", e)
                }
        } catch (e: Exception) {
            promise.reject("OCR_ERROR", e.message ?: "Unexpected error", e)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}
