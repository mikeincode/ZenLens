import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import * as Sharing from "expo-sharing";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusPill } from "@/components/StatusPill";
import { useCapture } from "@/context/CaptureContext";
import { useColors } from "@/hooks/useColors";

export default function TranscriptScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    state,
    transcript,
    ocrStatus,
    frameCount,
    appendedCount,
    updateTranscript,
    clearTranscript,
    pauseCapture,
    resumeCapture,
  } = useCapture();
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const prevTranscriptLen = useRef(transcript.length);

  const isCapturing = state === "capturing";
  const isPaused = state === "paused";
  const isEditable = isPaused || state === "idle";

  const lineCount = transcript.trim()
    ? transcript.trim().split("\n").filter((l) => l.trim()).length
    : 0;
  const wordCount = transcript.trim()
    ? transcript.trim().split(/\s+/).length
    : 0;
  const charCount = transcript.length;

  // Auto-scroll when new text is appended
  useEffect(() => {
    if (transcript.length > prevTranscriptLen.current && isCapturing) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
    prevTranscriptLen.current = transcript.length;
  }, [transcript, isCapturing]);

  async function handleCopy() {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await Clipboard.setStringAsync(transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    if (Platform.OS === "web") {
      Alert.alert("Share", "Use the Copy button to share on web.");
      return;
    }
    await Haptics.selectionAsync();
    const path = `${FileSystem.cacheDirectory}zenlens_transcript_${Date.now()}.txt`;
    await FileSystem.writeAsStringAsync(path, transcript, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(path, {
        mimeType: "text/plain",
        dialogTitle: "Share ZenLens Transcript",
      });
    } else {
      Alert.alert("Sharing unavailable on this device.");
    }
  }

  async function handleDownload() {
    if (Platform.OS === "web") {
      Alert.alert("Download", "Use the Copy button and paste into a text editor.");
      return;
    }
    await Haptics.selectionAsync();
    const filename = `zenlens_${new Date().toISOString().slice(0, 10)}.txt`;
    const path = `${FileSystem.documentDirectory}${filename}`;
    await FileSystem.writeAsStringAsync(path, transcript, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    Alert.alert("Saved", `Transcript saved to:\n${path}`);
  }

  function handleClear() {
    Alert.alert(
      "Clear Transcript",
      "This will permanently delete the entire transcript. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            await Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Warning
            );
            clearTranscript();
          },
        },
      ]
    );
  }

  function handlePause() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    pauseCapture();
  }

  function handleResume() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    resumeCapture();
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) + 10,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.headerIconBtn,
            { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </Pressable>

        <View style={styles.headerCenter}>
          <StatusPill state={state} label={ocrStatus} />
        </View>

        {isCapturing ? (
          <Pressable
            onPress={handlePause}
            style={({ pressed }) => [
              styles.pauseBtn,
              { backgroundColor: `${colors.warning}22`, borderColor: `${colors.warning}55`, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="pause" size={16} color={colors.warning} />
          </Pressable>
        ) : isPaused ? (
          <Pressable
            onPress={handleResume}
            style={({ pressed }) => [
              styles.pauseBtn,
              { backgroundColor: `${colors.accent}22`, borderColor: `${colors.accent}55`, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="play" size={16} color={colors.accent} />
          </Pressable>
        ) : (
          <View style={{ width: 36 }} />
        )}
      </View>

      {/* Stats bar */}
      <View
        style={[
          styles.statsBar,
          { backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.stat}>
          <Text style={[styles.statVal, { color: colors.foreground }]}>
            {lineCount}
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
            lines
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.stat}>
          <Text style={[styles.statVal, { color: colors.foreground }]}>
            {wordCount}
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
            words
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.stat}>
          <Text style={[styles.statVal, { color: colors.foreground }]}>
            {charCount}
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
            chars
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.stat}>
          <Text style={[styles.statVal, { color: colors.accent }]}>
            {appendedCount}
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
            appended
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.stat}>
          <Text style={[styles.statVal, { color: colors.foreground }]}>
            {frameCount}
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
            frames
          </Text>
        </View>
      </View>

      {/* Transcript area */}
      {isEditable ? (
        <TextInput
          value={transcript}
          onChangeText={updateTranscript}
          multiline
          style={[
            styles.transcriptInput,
            {
              color: colors.foreground,
              backgroundColor: colors.background,
            },
          ]}
          placeholder="Transcript will appear here as OCR captures text…"
          placeholderTextColor={colors.mutedForeground}
          textAlignVertical="top"
        />
      ) : (
        <ScrollView
          ref={scrollRef}
          style={[styles.transcriptScroll, { backgroundColor: colors.background }]}
          contentContainerStyle={styles.transcriptContent}
          showsVerticalScrollIndicator={false}
        >
          {transcript.trim().length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="file-text" size={32} color={colors.mutedForeground} />
              <Text
                style={[styles.emptyTitle, { color: colors.mutedForeground }]}
              >
                No text captured yet
              </Text>
              <Text
                style={[styles.emptySubtitle, { color: colors.mutedForeground }]}
              >
                OCR will appear here as you scroll through content
              </Text>
            </View>
          ) : (
            <Text
              style={[styles.transcriptText, { color: colors.foreground }]}
              selectable
            >
              {transcript}
            </Text>
          )}
        </ScrollView>
      )}

      {isPaused && (
        <View
          style={[
            styles.editingBanner,
            { backgroundColor: `${colors.warning}18`, borderTopColor: `${colors.warning}33` },
          ]}
        >
          <Feather name="edit-2" size={12} color={colors.warning} />
          <Text style={[styles.editingText, { color: colors.warning }]}>
            Editing mode — changes are saved automatically
          </Text>
        </View>
      )}

      {/* Action toolbar */}
      <View
        style={[
          styles.toolbar,
          {
            paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 8,
            backgroundColor: colors.card,
            borderTopColor: colors.border,
          },
        ]}
      >
        <Pressable
          onPress={handleCopy}
          style={({ pressed }) => [
            styles.toolBtn,
            { backgroundColor: copied ? `${colors.success}22` : colors.secondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather
            name={copied ? "check" : "copy"}
            size={17}
            color={copied ? colors.success : colors.foreground}
          />
          <Text
            style={[
              styles.toolBtnText,
              { color: copied ? colors.success : colors.foreground },
            ]}
          >
            {copied ? "Copied!" : "Copy"}
          </Text>
        </Pressable>

        <Pressable
          onPress={handleShare}
          style={({ pressed }) => [
            styles.toolBtn,
            { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="share-2" size={17} color={colors.foreground} />
          <Text style={[styles.toolBtnText, { color: colors.foreground }]}>
            Share
          </Text>
        </Pressable>

        <Pressable
          onPress={handleDownload}
          style={({ pressed }) => [
            styles.toolBtn,
            { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="download" size={17} color={colors.foreground} />
          <Text style={[styles.toolBtnText, { color: colors.foreground }]}>
            .TXT
          </Text>
        </Pressable>

        <Pressable
          onPress={handleClear}
          disabled={transcript.trim().length === 0}
          style={({ pressed }) => [
            styles.toolBtn,
            {
              backgroundColor: `${colors.destructive}15`,
              opacity: transcript.trim().length === 0 ? 0.4 : pressed ? 0.7 : 1,
            },
          ]}
        >
          <Feather name="trash-2" size={17} color={colors.destructive} />
          <Text style={[styles.toolBtnText, { color: colors.destructive }]}>
            Clear
          </Text>
        </Pressable>
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
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: { flex: 1, alignItems: "center" },
  pauseBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  statsBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stat: { flex: 1, alignItems: "center", gap: 1 },
  statVal: { fontSize: 14, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 9, fontFamily: "Inter_400Regular" },
  statDivider: { width: 1, height: 24, marginHorizontal: 4 },
  transcriptInput: {
    flex: 1,
    padding: 16,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  transcriptScroll: { flex: 1 },
  transcriptContent: { padding: 16 },
  transcriptText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: "Inter_500Medium",
    marginTop: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    maxWidth: 240,
    lineHeight: 18,
  },
  editingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  editingText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  toolbar: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  toolBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
    gap: 4,
  },
  toolBtnText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
});
