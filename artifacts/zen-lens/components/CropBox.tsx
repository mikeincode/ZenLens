import React, { useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { CropRect } from "@/utils/storage";

interface CropBoxProps {
  containerWidth: number;
  containerHeight: number;
  cropRect: CropRect;
  onChange: (rect: CropRect) => void;
}

const MIN_SIZE = 60;
const HANDLE_SIZE = 20;

export function CropBox({
  containerWidth,
  containerHeight,
  cropRect,
  onChange,
}: CropBoxProps) {
  const colors = useColors();
  const [dragging, setDragging] = useState<
    "move" | "tl" | "tr" | "bl" | "br" | null
  >(null);
  const rectRef = useRef(cropRect);

  function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  function makePanResponder(
    mode: "move" | "tl" | "tr" | "bl" | "br"
  ) {
    let startX = 0;
    let startY = 0;
    let startRect = { ...cropRect };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (_, gs) => {
        startX = gs.x0;
        startY = gs.y0;
        startRect = { ...rectRef.current };
        setDragging(mode);
      },
      onPanResponderMove: (_, gs) => {
        const dx = gs.moveX - startX;
        const dy = gs.moveY - startY;
        let { x, y, width, height } = startRect;

        if (mode === "move") {
          x = clamp(x + dx, 0, containerWidth - width);
          y = clamp(y + dy, 0, containerHeight - height);
        } else if (mode === "br") {
          width = clamp(width + dx, MIN_SIZE, containerWidth - x);
          height = clamp(height + dy, MIN_SIZE, containerHeight - y);
        } else if (mode === "tr") {
          const newY = clamp(y + dy, 0, y + height - MIN_SIZE);
          height = clamp(height - dy, MIN_SIZE, containerHeight);
          y = newY;
          width = clamp(width + dx, MIN_SIZE, containerWidth - x);
        } else if (mode === "bl") {
          const newX = clamp(x + dx, 0, x + width - MIN_SIZE);
          width = clamp(width - dx, MIN_SIZE, containerWidth);
          x = newX;
          height = clamp(height + dy, MIN_SIZE, containerHeight - y);
        } else if (mode === "tl") {
          const newX = clamp(x + dx, 0, x + width - MIN_SIZE);
          const newY = clamp(y + dy, 0, y + height - MIN_SIZE);
          width = clamp(width - dx, MIN_SIZE, containerWidth);
          height = clamp(height - dy, MIN_SIZE, containerHeight);
          x = newX;
          y = newY;
        }

        const next = { x, y, width, height };
        rectRef.current = next;
        onChange(next);
      },
      onPanResponderRelease: () => setDragging(null),
    });
  }

  const moveResponder = makePanResponder("move");
  const tlResponder = makePanResponder("tl");
  const trResponder = makePanResponder("tr");
  const blResponder = makePanResponder("bl");
  const brResponder = makePanResponder("br");

  const { x, y, width, height } = cropRect;
  const accent = colors.accent;
  const isActive = dragging !== null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Dimmed areas around crop box */}
      <View style={[styles.dimArea, { top: 0, left: 0, right: 0, height: y }]} />
      <View style={[styles.dimArea, { top: y + height, left: 0, right: 0, bottom: 0 }]} />
      <View style={[styles.dimArea, { top: y, left: 0, width: x, height }]} />
      <View style={[styles.dimArea, { top: y, left: x + width, right: 0, height }]} />

      {/* Crop border */}
      <View
        {...moveResponder.panHandlers}
        style={[
          styles.cropBorder,
          {
            left: x,
            top: y,
            width,
            height,
            borderColor: isActive ? accent : "rgba(255,255,255,0.8)",
          },
        ]}
      >
        {/* Grid lines */}
        <View style={[styles.gridLineH, { top: height / 3, borderColor: `${accent}44` }]} />
        <View style={[styles.gridLineH, { top: (height * 2) / 3, borderColor: `${accent}44` }]} />
        <View style={[styles.gridLineV, { left: width / 3, borderColor: `${accent}44` }]} />
        <View style={[styles.gridLineV, { left: (width * 2) / 3, borderColor: `${accent}44` }]} />

        {/* Dimension label */}
        <View style={[styles.dimLabel, { backgroundColor: accent }]}>
          <Text style={styles.dimLabelText}>
            {Math.round(width)} × {Math.round(height)}
          </Text>
        </View>
      </View>

      {/* Corner handles */}
      <View
        {...tlResponder.panHandlers}
        style={[styles.handle, { left: x - HANDLE_SIZE / 2, top: y - HANDLE_SIZE / 2, borderColor: accent }]}
      />
      <View
        {...trResponder.panHandlers}
        style={[styles.handle, { left: x + width - HANDLE_SIZE / 2, top: y - HANDLE_SIZE / 2, borderColor: accent }]}
      />
      <View
        {...blResponder.panHandlers}
        style={[styles.handle, { left: x - HANDLE_SIZE / 2, top: y + height - HANDLE_SIZE / 2, borderColor: accent }]}
      />
      <View
        {...brResponder.panHandlers}
        style={[styles.handle, { left: x + width - HANDLE_SIZE / 2, top: y + height - HANDLE_SIZE / 2, borderColor: accent }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dimArea: {
    position: "absolute",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  cropBorder: {
    position: "absolute",
    borderWidth: 1.5,
    borderStyle: "dashed",
    overflow: "hidden",
  },
  gridLineH: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  gridLineV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  dimLabel: {
    position: "absolute",
    bottom: 4,
    right: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  dimLabelText: {
    color: "#000",
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  handle: {
    position: "absolute",
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderWidth: 2,
  },
});
