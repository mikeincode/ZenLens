import AsyncStorage from "@react-native-async-storage/async-storage";

const KEYS = {
  TRANSCRIPT: "zenlens_transcript",
  CROP_RECT: "zenlens_crop_rect",
  SETTINGS: "zenlens_settings",
};

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Settings {
  ocrInterval: number;
  minConfidence: number;
  minTextLength: number;
  dedupeAggressiveness: number;
  autoSave: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  ocrInterval: 1500,
  minConfidence: 0.6,
  minTextLength: 10,
  dedupeAggressiveness: 1,
  autoSave: true,
};

export const DEFAULT_CROP: CropRect = {
  x: 20,
  y: 100,
  width: 300,
  height: 200,
};

export async function loadTranscript(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(KEYS.TRANSCRIPT)) ?? "";
  } catch {
    return "";
  }
}

export async function saveTranscript(text: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.TRANSCRIPT, text);
  } catch {}
}

export async function loadCropRect(): Promise<CropRect> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.CROP_RECT);
    return raw ? JSON.parse(raw) : DEFAULT_CROP;
  } catch {
    return DEFAULT_CROP;
  }
}

export async function saveCropRect(rect: CropRect): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.CROP_RECT, JSON.stringify(rect));
  } catch {}
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.SETTINGS);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  } catch {}
}
