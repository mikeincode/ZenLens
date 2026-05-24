import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CropBox } from "@/components/CropBox";
import { useCapture } from "@/context/CaptureContext";
import { useColors } from "@/hooks/useColors";
import { DEFAULT_CROP, CropRect } from "@/utils/storage";

export default function CropScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state, startCapture, cropRect, updateCropRect, isSimulated } =
    useCapture();
  const [containerSize, setContainerSize] = useState({ width: 340, height: 500 });
  const [localRect, setLocalRect] = useState<CropRect>(cropRect);
  const [starting, setStarting] = useState(false);

  const isAlreadyCapturing = state === "capturing";

  useEffect(() => {
    setLocalRect(cropRect);
  }, [cropRect]);

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize({ width, height });
  }

  function handleRectChange(rect: CropRect) {
    setLocalRect(rect);
  }

  function handleReset() {
    Haptics.selectionAsync();
    const reset: CropRect = {
      x: containerSize.width * 0.05,
      y: containerSize.height * 0.15,
      width: containerSize.width * 0.9,
      height: containerSize.height * 0.4,
    };
    setLocalRect(reset);
  }

  async function handleStartOCR() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    updateCropRect(localRect);
    if (!isAlreadyCapturing) {
      setStarting(true);
      await startCapture();
      setStarting(false);
    }
    router.replace("/transcript");
  }

  async function handleAdjustOnly() {
    await Haptics.selectionAsync();
    updateCropRect(localRect);
    router.back();
  }

  // Simulated screen content in the crop preview
  const MOCK_LINES = [
    "function buildAccessibleApp() {",
    "  const roles = getRoles();",
    "  return roles.map(r => (",
    "    <Component key={r.id}",
    "      aria-label={r.label}",
    "      role={r.type}",
    "    />",
    "  ));",
    "}",
    "",
    "// Handle focus management",
    "const focus = useFocusTrap();",
    "const ref = useRef<HTMLDivElement>(null);",
    "",
    "useEffect(() => {",
    "  if (isOpen) focus.activate(ref);",
    "}, [isOpen]);",
    "",
    "export default buildAccessibleApp;",
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) + 12,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.headerBtn,
            { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="x" size={18} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Crop Area
          </Text>
          <Text
            style={[styles.headerSub, { color: colors.mutedForeground }]}
          >
            Drag box · resize corners
          </Text>
        </View>
        <Pressable
          onPress={handleReset}
          style={({ pressed }) => [
            styles.headerBtn,
            { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="rotate-ccw" size={16} color={colors.foreground} />
        </Pressable>
      </View>

      {/* Crop preview area */}
      <View
        style={[styles.previewArea, { backgroundColor: "#0A0A12" }]}
        onLayout={onLayout}
      >
        {/* Simulated screen content */}
        <View style={styles.mockContent}>
          {isSimulated && (
            <View style={styles.mockBadge}>
              <Text style={styles.mockBadgeText}>Preview (simulated screen)</Text>
            </View>
          )}
          {MOCK_LINES.map((line, i) => (
            <Text key={i} style={[styles.mockLine, line === "" && styles.mockLineSpacer]}>
              {line}
            </Text>
          ))}
        </View>

        {/* Crop box overlay */}
        <CropBox
          containerWidth={containerSize.width}
          containerHeight={containerSize.height}
          cropRect={localRect}
          onChange={handleRectChange}
        />
      </View>

      {/* Bottom actions */}
      <View
        style={[
          styles.bottomBar,
          {
            paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 12,
            backgroundColor: colors.background,
            borderTopColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.rectInfo, { color: colors.mutedForeground }]}>
          {Math.round(localRect.x)}, {Math.round(localRect.y)} ·{" "}
          {Math.round(localRect.width)} × {Math.round(localRect.height)}
        </Text>

        {isAlreadyCapturing ? (
          <Pressable
            onPress={handleAdjustOnly}
            style={({ pressed }) => [
              styles.startBtn,
              { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Feather name="check" size={18} color="#000" />
            <Text style={[styles.startBtnText, { color: "#000" }]}>
              Apply & Return
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleStartOCR}
            disabled={starting}
            style={({ pressed }) => [
              styles.startBtn,
              {
                backgroundColor: colors.primary,
                opacity: starting || pressed ? 0.8 : 1,
              },
            ]}
          >
            <Feather name="zap" size={18} color="#fff" />
            <Text style={styles.startBtnText}>
              {starting ? "Starting…" : "Start OCR"}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  headerSub: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  previewArea: {
    flex: 1,
    overflow: "hidden",
  },
  mockContent: {
    padding: 16,
    paddingTop: 40,
  },
  mockBadge: {
    position: "absolute",
    top: 8,
    right: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  mockBadgeText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 10,
    fontFamily: "Inter_400Regular",
  },
  mockLine: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#A8DADC",
    lineHeight: 20,
  },
  mockLineSpacer: {
    height: 8,
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  rectInfo: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  startBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    borderRadius: 14,
  },
  startBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
});
