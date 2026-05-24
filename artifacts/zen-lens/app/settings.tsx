import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useSettings } from "@/context/SettingsContext";

function SettingSlider({
  label,
  description,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const colors = useColors();
  const steps = Math.round((max - min) / step);
  const currentStep = Math.round((value - min) / step);

  function increment() {
    const next = Math.min(max, value + step);
    onChange(Math.round(next * 100) / 100);
    Haptics.selectionAsync();
  }

  function decrement() {
    const next = Math.max(min, value - step);
    onChange(Math.round(next * 100) / 100);
    Haptics.selectionAsync();
  }

  const progress = steps > 0 ? currentStep / steps : 0;

  return (
    <View
      style={[
        settingStyles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={settingStyles.cardHeader}>
        <View style={settingStyles.cardText}>
          <Text style={[settingStyles.label, { color: colors.foreground }]}>
            {label}
          </Text>
          <Text
            style={[
              settingStyles.description,
              { color: colors.mutedForeground },
            ]}
          >
            {description}
          </Text>
        </View>
        <Text style={[settingStyles.valueText, { color: colors.primary }]}>
          {format(value)}
        </Text>
      </View>
      <View style={settingStyles.controls}>
        <Pressable
          onPress={decrement}
          disabled={value <= min}
          style={({ pressed }) => [
            settingStyles.stepper,
            {
              backgroundColor: colors.secondary,
              opacity: value <= min ? 0.3 : pressed ? 0.7 : 1,
            },
          ]}
        >
          <Feather name="minus" size={14} color={colors.foreground} />
        </Pressable>
        <View
          style={[settingStyles.track, { backgroundColor: colors.muted }]}
        >
          <View
            style={[
              settingStyles.fill,
              {
                width: `${progress * 100}%`,
                backgroundColor: colors.primary,
              },
            ]}
          />
        </View>
        <Pressable
          onPress={increment}
          disabled={value >= max}
          style={({ pressed }) => [
            settingStyles.stepper,
            {
              backgroundColor: colors.secondary,
              opacity: value >= max ? 0.3 : pressed ? 0.7 : 1,
            },
          ]}
        >
          <Feather name="plus" size={14} color={colors.foreground} />
        </Pressable>
      </View>
    </View>
  );
}

const settingStyles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  cardText: { flex: 1, gap: 2 },
  label: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  description: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
  },
  valueText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    minWidth: 60,
    textAlign: "right",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepper: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  track: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 2,
  },
});

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useSettings();

  const DEDUPE_LABELS = ["Off", "Normal", "Aggressive"];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop:
              insets.top +
              (Platform.OS === "web" ? 67 : 0) +
              16,
            paddingBottom:
              insets.bottom +
              (Platform.OS === "web" ? 34 : 0) +
              32,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.backBtn,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Feather
              name="arrow-left"
              size={18}
              color={colors.mutedForeground}
            />
            <Text
              style={[styles.backText, { color: colors.mutedForeground }]}
            >
              Back
            </Text>
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Settings
          </Text>
        </View>

        {/* Capture section */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: colors.mutedForeground }]}
          >
            CAPTURE
          </Text>
          <SettingSlider
            label="OCR Interval"
            description="How often OCR runs while capturing"
            value={settings.ocrInterval}
            min={500}
            max={5000}
            step={250}
            format={(v) => `${(v / 1000).toFixed(2)}s`}
            onChange={(v) => updateSettings({ ocrInterval: v })}
          />
          <SettingSlider
            label="Min Confidence"
            description="Minimum OCR confidence to accept text (0–1)"
            value={settings.minConfidence}
            min={0.3}
            max={0.95}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => updateSettings({ minConfidence: v })}
          />
          <SettingSlider
            label="Min Text Length"
            description="Minimum characters for OCR result to be accepted"
            value={settings.minTextLength}
            min={5}
            max={50}
            step={5}
            format={(v) => `${v} chars`}
            onChange={(v) => updateSettings({ minTextLength: v })}
          />
        </View>

        {/* Dedupe section */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: colors.mutedForeground }]}
          >
            DEDUPLICATION
          </Text>
          <View
            style={[
              styles.toggleRow,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.toggleText}>
              <Text
                style={[styles.toggleLabel, { color: colors.foreground }]}
              >
                Aggressiveness
              </Text>
              <Text
                style={[
                  styles.toggleDesc,
                  { color: colors.mutedForeground },
                ]}
              >
                How aggressively to skip repeated text
              </Text>
            </View>
            <View style={styles.dedupeBtns}>
              {[0, 1, 2].map((level) => (
                <Pressable
                  key={level}
                  onPress={() => {
                    updateSettings({ dedupeAggressiveness: level });
                    Haptics.selectionAsync();
                  }}
                  style={[
                    styles.dedupeBtn,
                    {
                      backgroundColor:
                        settings.dedupeAggressiveness === level
                          ? colors.primary
                          : colors.secondary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.dedupeBtnText,
                      {
                        color:
                          settings.dedupeAggressiveness === level
                            ? colors.primaryForeground
                            : colors.mutedForeground,
                      },
                    ]}
                  >
                    {DEDUPE_LABELS[level]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        {/* Storage section */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: colors.mutedForeground }]}
          >
            STORAGE
          </Text>
          <View
            style={[
              styles.toggleRow,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.toggleText}>
              <Text
                style={[styles.toggleLabel, { color: colors.foreground }]}
              >
                Auto-Save
              </Text>
              <Text
                style={[
                  styles.toggleDesc,
                  { color: colors.mutedForeground },
                ]}
              >
                Automatically save transcript after each append
              </Text>
            </View>
            <Switch
              value={settings.autoSave}
              onValueChange={(v) => {
                updateSettings({ autoSave: v });
                Haptics.selectionAsync();
              }}
              trackColor={{ true: colors.primary, false: colors.muted }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Privacy section */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: colors.mutedForeground }]}
          >
            PRIVACY
          </Text>
          <View
            style={[
              styles.privacyCard,
              { backgroundColor: colors.card, borderColor: `${colors.accent}33` },
            ]}
          >
            <Feather name="shield" size={18} color={colors.accent} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text
                style={[styles.privacyTitle, { color: colors.foreground }]}
              >
                100% On-Device
              </Text>
              <Text
                style={[
                  styles.privacyDesc,
                  { color: colors.mutedForeground },
                ]}
              >
                All OCR processing happens locally on your device using Google
                ML Kit. Screenshots are processed in memory and immediately
                discarded. No text or images are uploaded to any server.
                ZenLens has no network access by design.
              </Text>
            </View>
          </View>
        </View>

        {/* Version */}
        <Text style={[styles.version, { color: colors.mutedForeground }]}>
          ZenLens v1.0.0 · Android First
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: {
    paddingHorizontal: 20,
    gap: 20,
    flexGrow: 1,
  },
  header: { gap: 8 },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  backText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  section: { gap: 10 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  toggleDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
  },
  dedupeBtns: { flexDirection: "row", gap: 4 },
  dedupeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  dedupeBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  privacyCard: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  privacyTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  privacyDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  version: {
    textAlign: "center",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
});
