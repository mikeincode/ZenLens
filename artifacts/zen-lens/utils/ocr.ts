import Constants from "expo-constants";
import { Platform } from "react-native";

export interface OcrResult {
  text: string;
  confidence: number;
  blocks: OcrBlock[];
}

export interface OcrBlock {
  text: string;
  confidence: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

// Simulated document chunks that scroll progressively
const SIMULATED_PAGES: string[] = [
  `Building Accessible Software
The foundation of accessible design starts
with semantic structure and clear hierarchy.
Every element should communicate its purpose
without relying on color alone.`,

  `Focus management is critical in single-page
applications. When routes change, focus must
be programmatically moved to the main content
or the new page heading.`,

  `Keyboard navigation allows users to tab through
interactive elements in a logical order. Use
tabIndex=0 for focusable elements and avoid
positive tabIndex values wherever possible.`,

  `Screen readers interpret the DOM structure.
ARIA labels, roles, and descriptions fill gaps
where native semantics are insufficient.
Test with NVDA, VoiceOver, and TalkBack.`,

  `Color contrast ratios must meet WCAG AA at
minimum. Text on backgrounds should achieve
4.5:1 for normal text, 3:1 for large text.
Use tools like WebAIM's contrast checker.`,

  `Alternative text for images should convey
meaning, not just describe appearance.
Decorative images use empty alt attributes.
Complex charts need textual summaries.`,

  `Motion and animation should respect the
prefers-reduced-motion media query. Parallax,
auto-playing videos, and large transitions
can trigger vestibular disorders.`,

  `Touch targets on mobile should be at least
44x44 points. Spacing between targets
prevents accidental activation. Gestures
should have tap alternatives.`,

  `Time limits must be adjustable or removable.
Users with cognitive disabilities may need
more time to complete forms, read content,
or respond to dynamic updates.`,

  `Error messages should identify the field,
describe the issue, and suggest correction.
Inline validation helps users catch mistakes
before form submission.`,
];

let simulatedPageIndex = 0;
let simulatedLineOffset = 0;

export function resetSimulation(): void {
  simulatedPageIndex = 0;
  simulatedLineOffset = 0;
}

function getSimulatedOcrResult(minConfidence: number): OcrResult {
  const page = SIMULATED_PAGES[simulatedPageIndex % SIMULATED_PAGES.length];
  const lines = page.split("\n").filter((l) => l.trim().length > 0);

  const windowSize = 4;
  const start = simulatedLineOffset;
  const end = Math.min(start + windowSize, lines.length);
  const visibleLines = lines.slice(start, end);

  simulatedLineOffset += 2;
  if (simulatedLineOffset >= lines.length - 1) {
    simulatedLineOffset = 0;
    simulatedPageIndex++;
  }

  const text = visibleLines.join("\n");
  const confidence = 0.85 + Math.random() * 0.1;

  return {
    text,
    confidence,
    blocks: visibleLines.map((line) => ({
      text: line,
      confidence: confidence - Math.random() * 0.05,
    })),
  };
}

// ─── Native module accessors ──────────────────────────────────────────────────

function getNativeOcrModule(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeModules } = require("react-native");
    return NativeModules.ZenLensOCR ?? null;
  } catch {
    return null;
  }
}

function getNativeCaptureModule(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeModules } = require("react-native");
    return NativeModules.ZenLensCapture ?? null;
  } catch {
    return null;
  }
}

// ─── Mode detection ───────────────────────────────────────────────────────────

export function isExpoGo(): boolean {
  return (
    Constants.appOwnership === "expo" ||
    Constants.executionEnvironment === "storeClient"
  );
}

export function isNativeAvailable(): boolean {
  if (Platform.OS !== "android") return false;
  return getNativeCaptureModule() !== null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PermissionWiringStatus {
  activityListenerRegistered: boolean;
  requestCode: number;
  permissionGranted: boolean;
  serviceMethodsPresent: boolean;
  singleFrameWiringPresent?: boolean;
}

export interface SingleFrameSuccess {
  success: true;
  width: number;
  height: number;
  pixelFormat: number;
  timestamp: number;
}

export interface SingleFrameError {
  success: false;
  reason: string;
}

export type SingleFrameResult = SingleFrameSuccess | SingleFrameError;

export interface PermissionResult {
  granted: boolean;
  permissionCached: boolean;
  reason?: string;
}

export interface ServiceStartResult {
  started: boolean;
  reason?: string;
}

export interface ServiceStopResult {
  stopped: boolean;
}

export interface CaptureServiceStatus {
  permissionGranted: boolean;
  serviceRunning: boolean;
  hasProjectionToken: boolean;
}

// ─── Wiring check ─────────────────────────────────────────────────────────────

/**
 * Calls checkWiring() on ZenLensCapture to verify ActivityEventListener
 * registration and service method presence. Returns null in Expo Go.
 */
export async function checkPermissionWiring(): Promise<PermissionWiringStatus | null> {
  const mod = getNativeCaptureModule();
  if (!mod || typeof mod.checkWiring !== "function") return null;
  try {
    return await mod.checkWiring();
  } catch {
    return null;
  }
}

// ─── Permission ───────────────────────────────────────────────────────────────

/**
 * Opens the Android "Start recording?" system dialog.
 * Returns { granted, permissionCached, reason? } in native build.
 * Returns null in Expo Go (module not available).
 */
export async function requestNativeMediaProjectionPermission(): Promise<PermissionResult | null> {
  const mod = getNativeCaptureModule();
  if (!mod || typeof mod.requestPermission !== "function") return null;
  try {
    return await mod.requestPermission();
  } catch (e: any) {
    return { granted: false, permissionCached: false, reason: e?.message ?? "Unknown error" };
  }
}

/**
 * Simulation-aware permission request for CaptureContext.
 * Native build: real MediaProjection dialog.
 * Expo Go / simulation: always returns true after short delay.
 */
export async function requestMediaProjectionPermission(): Promise<boolean> {
  if (isNativeAvailable()) {
    const result = await requestNativeMediaProjectionPermission();
    return result?.granted ?? false;
  }
  await new Promise((r) => setTimeout(r, 800));
  return true;
}

// ─── Foreground service ───────────────────────────────────────────────────────

/**
 * Starts ScreenCaptureService with the stored MediaProjection grant.
 * Returns { started, reason? } in native build.
 * Returns null in Expo Go.
 */
export async function startNativeCaptureService(): Promise<ServiceStartResult | null> {
  const mod = getNativeCaptureModule();
  if (!mod || typeof mod.startCaptureService !== "function") return null;
  try {
    return await mod.startCaptureService();
  } catch (e: any) {
    return { started: false, reason: e?.message ?? "Unknown error" };
  }
}

/**
 * Stops ScreenCaptureService and clears the one-session MediaProjection token.
 * Returns { stopped } in native build. Returns null in Expo Go.
 */
export async function stopNativeCaptureService(): Promise<ServiceStopResult | null> {
  const mod = getNativeCaptureModule();
  if (!mod || typeof mod.stopCaptureService !== "function") return null;
  try {
    return await mod.stopCaptureService();
  } catch {
    return { stopped: false };
  }
}

/**
 * Returns live status without side effects.
 * { permissionGranted, serviceRunning, hasProjectionToken }
 * Returns null in Expo Go.
 */
export async function getNativeCaptureServiceStatus(): Promise<CaptureServiceStatus | null> {
  const mod = getNativeCaptureModule();
  if (!mod || typeof mod.getCaptureServiceStatus !== "function") return null;
  try {
    return await mod.getCaptureServiceStatus();
  } catch {
    return null;
  }
}

// ─── Single-frame capture ─────────────────────────────────────────────────────

/**
 * Capture exactly one screen frame via VirtualDisplay + ImageReader in ScreenCaptureService.
 *
 * Requires:
 *   - ScreenCaptureService to be running
 *   - MediaProjection permission granted
 *
 * Returns null if the native module is unavailable (Expo Go / missing module).
 * Returns { success: false, reason } if the service or permission is not ready.
 * Returns { success: true, width, height, pixelFormat, timestamp } on success.
 *
 * Does NOT transfer image data over the bridge. Metadata only.
 */
export async function captureSingleNativeFrame(): Promise<SingleFrameResult | null> {
  const mod = getNativeCaptureModule();
  if (!mod || typeof mod.captureSingleFrame !== "function") return null;
  try {
    return await mod.captureSingleFrame();
  } catch (e: any) {
    return { success: false, reason: e?.message ?? "Unknown error during frame capture" };
  }
}

// ─── Overlay ──────────────────────────────────────────────────────────────────

export async function requestOverlayPermission(): Promise<boolean> {
  if (isNativeAvailable()) {
    try {
      const mod = getNativeCaptureModule();
      return await mod.requestOverlayPermission();
    } catch {
      return false;
    }
  }
  await new Promise((r) => setTimeout(r, 400));
  return true;
}

// ─── Legacy wrappers (used by CaptureContext simulation path) ─────────────────

export async function startForegroundCapture(_cropRect: {
  x: number; y: number; width: number; height: number;
}): Promise<boolean> {
  // Native frame capture not yet implemented — use startNativeCaptureService() instead.
  // Simulation mode always returns true.
  if (isNativeAvailable()) return false;
  return true;
}

export async function stopForegroundCapture(): Promise<void> {
  if (isNativeAvailable()) {
    await stopNativeCaptureService();
  }
}

// ─── OCR ─────────────────────────────────────────────────────────────────────

export async function recognizeTextFromCrop(
  _cropRect: { x: number; y: number; width: number; height: number },
  minConfidence: number
): Promise<OcrResult | null> {
  if (isNativeAvailable()) {
    try {
      const captureModule = getNativeCaptureModule();
      const ocrModule = getNativeOcrModule();
      const base64Frame = await captureModule.captureFrame();
      if (!base64Frame) return null;
      const result = await ocrModule.recognizeText(base64Frame);
      if (!result?.text) return null;
      const confidence = result.confidence ?? 0.8;
      if (confidence < minConfidence) return null;
      return { text: result.text, confidence, blocks: result.blocks ?? [] };
    } catch {
      return null;
    }
  }

  // Simulation mode
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 80));
  const result = getSimulatedOcrResult(minConfidence);
  if (result.confidence < minConfidence) return null;
  return result;
}
