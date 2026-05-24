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

  // Return a sliding window of lines (simulate scrolling)
  const windowSize = 4;
  const start = simulatedLineOffset;
  const end = Math.min(start + windowSize, lines.length);
  const visibleLines = lines.slice(start, end);

  // Advance for next call
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

// Native module bridge (only available in custom dev build with ML Kit)
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

export function isExpoGo(): boolean {
  return (
    Constants.appOwnership === "expo" ||
    Constants.executionEnvironment === "storeClient"
  );
}

export function isNativeAvailable(): boolean {
  if (Platform.OS !== "android") return false;
  const mod = getNativeCaptureModule();
  return mod !== null;
}

export interface PermissionWiringStatus {
  /** Module registered and ActivityEventListener wired (always true if native build) */
  activityListenerRegistered: boolean;
  /** MEDIA_PROJECTION_REQUEST constant from the module */
  requestCode: number;
  /** Whether MediaProjection permission is currently held */
  permissionGranted: boolean;
}

/**
 * Calls ScreenCaptureModule.checkWiring() to verify the full MediaProjection
 * permission flow is wired — ActivityEventListener registered, request code
 * constant present, and whether permission is currently held.
 *
 * Returns null in Expo Go (module not available).
 */
export async function checkPermissionWiring(): Promise<PermissionWiringStatus | null> {
  const mod = getNativeCaptureModule();
  if (!mod) return null;
  // checkWiring is only present in the updated module
  if (typeof mod.checkWiring !== "function") return null;
  try {
    return await mod.checkWiring();
  } catch {
    return null;
  }
}

export async function requestMediaProjectionPermission(): Promise<boolean> {
  if (isNativeAvailable()) {
    try {
      const mod = getNativeCaptureModule();
      return await mod.requestPermission();
    } catch {
      return false;
    }
  }
  // Simulation: always grant in dev
  await new Promise((r) => setTimeout(r, 800));
  return true;
}

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

export async function startForegroundCapture(cropRect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Promise<boolean> {
  if (isNativeAvailable()) {
    try {
      const mod = getNativeCaptureModule();
      return await mod.startCapture(
        cropRect.x,
        cropRect.y,
        cropRect.width,
        cropRect.height
      );
    } catch {
      return false;
    }
  }
  return true;
}

export async function stopForegroundCapture(): Promise<void> {
  if (isNativeAvailable()) {
    try {
      const mod = getNativeCaptureModule();
      await mod.stopCapture();
    } catch {}
  }
}

export async function recognizeTextFromCrop(
  _cropRect: { x: number; y: number; width: number; height: number },
  minConfidence: number
): Promise<OcrResult | null> {
  if (isNativeAvailable()) {
    try {
      const captureModule = getNativeCaptureModule();
      const ocrModule = getNativeOcrModule();
      // Capture the crop frame
      const base64Frame = await captureModule.captureFrame();
      if (!base64Frame) return null;
      // Run OCR on the frame
      const result = await ocrModule.recognizeText(base64Frame);
      if (!result || !result.text) return null;
      const confidence = result.confidence ?? 0.8;
      if (confidence < minConfidence) return null;
      return {
        text: result.text,
        confidence,
        blocks: result.blocks ?? [],
      };
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
