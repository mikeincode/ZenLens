import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { clearDedupeHistory, dedupeAppendText } from "@/utils/dedupe";
import {
  recognizeTextFromCrop,
  requestMediaProjectionPermission,
  requestOverlayPermission,
  resetSimulation,
  startForegroundCapture,
  stopForegroundCapture,
} from "@/utils/ocr";
import {
  CropRect,
  DEFAULT_CROP,
  loadCropRect,
  loadTranscript,
  saveCropRect,
  saveTranscript,
} from "@/utils/storage";
import { useSettings } from "./SettingsContext";

export type CaptureState =
  | "idle"
  | "requesting_permission"
  | "ready"
  | "capturing"
  | "paused";

export type PermissionStatus = "unknown" | "granted" | "denied";

interface CaptureContextType {
  state: CaptureState;
  transcript: string;
  cropRect: CropRect;
  ocrStatus: string;
  frameCount: number;
  appendedCount: number;
  mediaProjectionPermission: PermissionStatus;
  overlayPermission: PermissionStatus;
  isSimulated: boolean;

  requestPermissions: () => Promise<void>;
  startCapture: () => Promise<void>;
  stopCapture: () => Promise<void>;
  pauseCapture: () => void;
  resumeCapture: () => void;
  updateTranscript: (text: string) => void;
  clearTranscript: () => void;
  updateCropRect: (rect: CropRect) => void;
  resetPermissions: () => void;
}

const CaptureContext = createContext<CaptureContextType>({
  state: "idle",
  transcript: "",
  cropRect: DEFAULT_CROP,
  ocrStatus: "Ready",
  frameCount: 0,
  appendedCount: 0,
  mediaProjectionPermission: "unknown",
  overlayPermission: "unknown",
  isSimulated: true,
  requestPermissions: async () => {},
  startCapture: async () => {},
  stopCapture: async () => {},
  pauseCapture: () => {},
  resumeCapture: () => {},
  updateTranscript: () => {},
  clearTranscript: () => {},
  updateCropRect: () => {},
  resetPermissions: () => {},
});

export function CaptureProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const [state, setState] = useState<CaptureState>("idle");
  const [transcript, setTranscript] = useState("");
  const [cropRect, setCropRect] = useState<CropRect>(DEFAULT_CROP);
  const [ocrStatus, setOcrStatus] = useState("Ready");
  const [frameCount, setFrameCount] = useState(0);
  const [appendedCount, setAppendedCount] = useState(0);
  const [mediaProjectionPermission, setMediaProjectionPermission] =
    useState<PermissionStatus>("unknown");
  const [overlayPermission, setOverlayPermission] =
    useState<PermissionStatus>("unknown");

  const captureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const transcriptRef = useRef(transcript);
  const cropRectRef = useRef(cropRect);
  const settingsRef = useRef(settings);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    cropRectRef.current = cropRect;
  }, [cropRect]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Load persisted data on mount
  useEffect(() => {
    loadTranscript().then((t) => {
      setTranscript(t);
    });
    loadCropRect().then((r) => {
      setCropRect(r);
    });
  }, []);

  const stopCaptureLoop = useCallback(() => {
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
  }, []);

  const runOcrFrame = useCallback(async () => {
    setOcrStatus("Scanning...");
    try {
      const result = await recognizeTextFromCrop(
        cropRectRef.current,
        settingsRef.current.minConfidence
      );
      if (!result) {
        setOcrStatus("No text detected");
        setFrameCount((n) => n + 1);
        return;
      }

      const { appended, result: newTranscript } = dedupeAppendText(
        transcriptRef.current,
        result.text,
        {
          minLength: settingsRef.current.minTextLength,
          aggressiveness: settingsRef.current.dedupeAggressiveness,
        }
      );

      if (appended) {
        setTranscript(newTranscript);
        setAppendedCount((n) => n + 1);
        if (settingsRef.current.autoSave) {
          saveTranscript(newTranscript);
        }
        setOcrStatus(
          `Captured · ${result.text.split("\n").filter((l) => l.trim()).length} lines`
        );
      } else {
        setOcrStatus("No new text");
      }
    } catch {
      setOcrStatus("OCR error");
    }
    setFrameCount((n) => n + 1);
  }, []);

  const requestPermissions = useCallback(async () => {
    setState("requesting_permission");
    setOcrStatus("Requesting permissions...");

    const mpGranted = await requestMediaProjectionPermission();
    setMediaProjectionPermission(mpGranted ? "granted" : "denied");

    const overlayGranted = await requestOverlayPermission();
    setOverlayPermission(overlayGranted ? "granted" : "denied");

    if (mpGranted) {
      setState("ready");
      setOcrStatus("Ready to capture");
    } else {
      setState("idle");
      setOcrStatus("Permission denied");
    }
  }, []);

  const startCapture = useCallback(async () => {
    if (mediaProjectionPermission !== "granted") {
      await requestPermissions();
      if (mediaProjectionPermission !== "granted") return;
    }
    resetSimulation();
    clearDedupeHistory();
    await startForegroundCapture(cropRectRef.current);
    setState("capturing");
    setOcrStatus("Capturing...");
    setFrameCount(0);

    stopCaptureLoop();
    captureIntervalRef.current = setInterval(
      runOcrFrame,
      settingsRef.current.ocrInterval
    );
  }, [
    mediaProjectionPermission,
    requestPermissions,
    runOcrFrame,
    stopCaptureLoop,
  ]);

  const stopCapture = useCallback(async () => {
    stopCaptureLoop();
    await stopForegroundCapture();
    setState("idle");
    setOcrStatus("Stopped");
    clearDedupeHistory();
  }, [stopCaptureLoop]);

  const pauseCapture = useCallback(() => {
    stopCaptureLoop();
    setState("paused");
    setOcrStatus("Paused — editing enabled");
  }, [stopCaptureLoop]);

  const resumeCapture = useCallback(() => {
    setState("capturing");
    setOcrStatus("Resumed...");
    captureIntervalRef.current = setInterval(
      runOcrFrame,
      settingsRef.current.ocrInterval
    );
  }, [runOcrFrame]);

  const updateTranscript = useCallback(
    (text: string) => {
      setTranscript(text);
      if (settings.autoSave) saveTranscript(text);
    },
    [settings.autoSave]
  );

  const clearTranscript = useCallback(() => {
    setTranscript("");
    setFrameCount(0);
    setAppendedCount(0);
    saveTranscript("");
    clearDedupeHistory();
  }, []);

  const updateCropRect = useCallback((rect: CropRect) => {
    setCropRect(rect);
    saveCropRect(rect);
  }, []);

  const resetPermissions = useCallback(() => {
    setMediaProjectionPermission("unknown");
    setOverlayPermission("unknown");
    setState("idle");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCaptureLoop();
    };
  }, [stopCaptureLoop]);

  return (
    <CaptureContext.Provider
      value={{
        state,
        transcript,
        cropRect,
        ocrStatus,
        frameCount,
        appendedCount,
        mediaProjectionPermission,
        overlayPermission,
        isSimulated: !false,
        requestPermissions,
        startCapture,
        stopCapture,
        pauseCapture,
        resumeCapture,
        updateTranscript,
        clearTranscript,
        updateCropRect,
        resetPermissions,
      }}
    >
      {children}
    </CaptureContext.Provider>
  );
}

export function useCapture() {
  return useContext(CaptureContext);
}
