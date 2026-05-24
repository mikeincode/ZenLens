const RECENT_HISTORY_SIZE = 5;
const recentChunks: string[] = [];

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function findOverlapLength(a: string[], b: string[]): number {
  const maxCheck = Math.min(30, a.length, b.length);
  for (let len = maxCheck; len >= 2; len--) {
    const tailA = a.slice(a.length - len).join("\n");
    const headB = b.slice(0, len).join("\n");
    if (tailA === headB) return len;
  }
  return 0;
}

function hasMeaningfulContent(lines: string[], minLength: number): boolean {
  const joined = lines.join(" ");
  return joined.replace(/\s/g, "").length >= minLength;
}

export function dedupeAppendText(
  existingText: string,
  newText: string,
  options: { minLength?: number; aggressiveness?: number } = {}
): { appended: boolean; result: string; newPart: string } {
  const { minLength = 10, aggressiveness = 1 } = options;

  const normalizedNew = normalizeText(newText);
  const newLines = splitLines(normalizedNew);

  if (!hasMeaningfulContent(newLines, minLength)) {
    return { appended: false, result: existingText, newPart: "" };
  }

  // Check recent history to avoid repeated OCR loops
  const chunkKey = newLines.slice(0, 5).join("|");
  if (recentChunks.includes(chunkKey)) {
    return { appended: false, result: existingText, newPart: "" };
  }

  const existingNormalized = normalizeText(existingText);
  const existingLines = splitLines(existingNormalized);

  if (existingLines.length === 0) {
    recentChunks.unshift(chunkKey);
    if (recentChunks.length > RECENT_HISTORY_SIZE) recentChunks.pop();
    const result = newLines.join("\n");
    return { appended: true, result, newPart: result };
  }

  const overlapLen = findOverlapLength(existingLines, newLines);

  let newUniqueLines: string[];
  if (overlapLen > 0) {
    newUniqueLines = newLines.slice(overlapLen);
  } else {
    // No overlap found — check if new text is fully contained in existing (very aggressive)
    if (aggressiveness >= 2) {
      const existingJoined = existingLines.join(" ").toLowerCase();
      const newJoined = newLines.join(" ").toLowerCase();
      if (existingJoined.includes(newJoined)) {
        return { appended: false, result: existingText, newPart: "" };
      }
    }
    newUniqueLines = newLines;
  }

  if (!hasMeaningfulContent(newUniqueLines, minLength)) {
    return { appended: false, result: existingText, newPart: "" };
  }

  // Update history
  recentChunks.unshift(chunkKey);
  if (recentChunks.length > RECENT_HISTORY_SIZE) recentChunks.pop();

  const separator = existingText.trim().length > 0 ? "\n" : "";
  const newPart = newUniqueLines.join("\n");
  const result = existingText.trim() + separator + newPart;

  return { appended: true, result, newPart };
}

export function clearDedupeHistory(): void {
  recentChunks.length = 0;
}
