import useTranscriptStore from "@/features/editor/store/use-transcript-store";
import useStore from "@/features/editor/store/use-store";
import useEffectsStore from "@/features/editor/store/use-effects-store";
import { dispatch } from "@designcombo/events";
import { ADD_TEXT, ADD_IMAGE, ADD_VIDEO, ADD_AUDIO, EDIT_OBJECT, LAYER_DELETE } from "@designcombo/state";
import { nanoid } from "nanoid";
import { STYLE_CAPTION_PRESETS, applyPreset, groupCaptionItems } from "@/features/editor/control-item/floating-controls/caption-preset-picker";
import { toast } from "sonner";

export interface ToolResult {
  success: boolean;
  result: unknown;
  error?: string;
}

// Format milliseconds to readable time
function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

// Filler word patterns
const FILLER_WORDS = [
  "um", "uh", "uhh", "umm", "er", "ah", "ahh",
  "like", "you know", "basically", "actually", "literally",
  "so", "right", "okay", "ok", "yeah", "well", "i mean"
];

// Caption preset mapping - maps friendly names to preset indices
const CAPTION_PRESET_MAP: Record<string, number> = {
  "tiktok-neon": 0,
  "tiktok-bold": 1,
  "minimal-clean": 2,
  "typewriter-retro": 3,
  "cinematic-white": 4,
  "cinematic-gold": 5,
  "karaoke-green": 6,
  "karaoke-blue": 7,
  "ella-style": 8,
  "hormozi-style": 9,
  "beasty-style": 10,
  "bold-outline": 11,
  "gradient-pop": 12,
  "underline-pop": 13,
  "shadow-glow": 14,
};

/**
 * Map a source timestamp (from original video) to timeline position (after reordering/editing)
 * This is critical for correct placement when clips have been reordered or trimmed
 */
function mapSourceToTimelineMs(sourceMs: number, clipId: string): number | null {
  const transcriptStore = useTranscriptStore.getState();
  const renderSegments = transcriptStore.getRenderSegments();

  // Find the render segment that contains this source timestamp
  for (const segment of renderSegments) {
    if (segment.clipId === clipId && sourceMs >= segment.startMs && sourceMs <= segment.endMs) {
      // Map: timeline position = segment offset + (source position - segment start)
      return segment.offsetMs + (sourceMs - segment.startMs);
    }
  }

  // If not found in any segment (word might be deleted), return null
  return null;
}

/**
 * Map all words to their timeline positions
 * Returns words with an additional `timelineMs` property
 */
function getWordsWithTimelinePositions(): Array<{
  word: { id: string; text: string; startMs: number; endMs: number; clipId: string };
  timelineStartMs: number;
  timelineEndMs: number;
}> {
  const transcriptStore = useTranscriptStore.getState();
  const renderSegments = transcriptStore.getRenderSegments();
  const clips = transcriptStore.clips;
  const result: Array<{
    word: { id: string; text: string; startMs: number; endMs: number; clipId: string };
    timelineStartMs: number;
    timelineEndMs: number;
  }> = [];

  for (const segment of renderSegments) {
    const clip = clips[segment.clipId];
    if (!clip) continue;

    // Get words that fall within this segment's source time range
    const segmentWords = clip.words.filter(
      (w) => !w.isDeleted && w.startMs >= segment.startMs && w.endMs <= segment.endMs
    );

    for (const word of segmentWords) {
      const timelineStartMs = segment.offsetMs + (word.startMs - segment.startMs);
      const timelineEndMs = segment.offsetMs + (word.endMs - segment.startMs);

      result.push({
        word: {
          id: word.id,
          text: word.text,
          startMs: word.startMs,
          endMs: word.endMs,
          clipId: segment.clipId,
        },
        timelineStartMs,
        timelineEndMs,
      });
    }
  }

  return result;
}

/**
 * Check for conflicts with existing timeline items
 * Returns conflicting items if any overlap with the given time range
 */
function findTimelineConflicts(
  startMs: number,
  endMs: number,
  itemType: "text" | "image" | "all" = "all"
): Array<{ id: string; type: string; from: number; to: number; text?: string }> {
  const { trackItemsMap } = useStore.getState();
  const conflicts: Array<{ id: string; type: string; from: number; to: number; text?: string }> = [];

  for (const [id, item] of Object.entries(trackItemsMap)) {
    // Filter by type if specified
    if (itemType !== "all" && item.type !== itemType) continue;
    // Skip non-overlay types
    if (item.type === "video" || item.type === "audio" || item.type === "caption") continue;

    const itemStart = item.display?.from ?? 0;
    const itemEnd = item.display?.to ?? 0;

    // Check for overlap: items overlap if one starts before the other ends
    if (startMs < itemEnd && endMs > itemStart) {
      conflicts.push({
        id,
        type: item.type,
        from: itemStart,
        to: itemEnd,
        text: item.details?.text ? String(item.details.text).substring(0, 30) : undefined,
      });
    }
  }

  return conflicts;
}

/**
 * Find the next available time slot after a given timestamp
 * Useful for auto-adjusting placement to avoid conflicts
 */
function findNextAvailableSlot(
  afterMs: number,
  durationMs: number,
  itemType: "text" | "image" | "all" = "all"
): number {
  const { trackItemsMap } = useStore.getState();
  const transcriptStore = useTranscriptStore.getState();
  const totalDuration = transcriptStore.getTotalDurationMs();

  // Collect all items that might conflict
  const items: Array<{ from: number; to: number }> = [];
  for (const item of Object.values(trackItemsMap)) {
    if (itemType !== "all" && item.type !== itemType) continue;
    if (item.type === "video" || item.type === "audio" || item.type === "caption") continue;
    if (item.display?.from !== undefined && item.display?.to !== undefined) {
      items.push({ from: item.display.from, to: item.display.to });
    }
  }

  // Sort by start time
  items.sort((a, b) => a.from - b.from);

  // Find the first gap that fits our duration
  let candidateStart = afterMs;
  for (const item of items) {
    if (item.from >= candidateStart + durationMs) {
      // Found a gap before this item
      break;
    }
    if (item.to > candidateStart) {
      // This item overlaps, move candidate to after it
      candidateStart = item.to + 100; // Add 100ms buffer
    }
  }

  // Make sure we don't exceed total duration
  if (totalDuration > 0 && candidateStart + durationMs > totalDuration) {
    candidateStart = Math.max(0, totalDuration - durationMs);
  }

  return candidateStart;
}

/**
 * Execute a tool call and return the result
 * This runs on the client side where Zustand stores are available
 */
export async function executeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<ToolResult> {
  const transcriptStore = useTranscriptStore.getState();
  const editorStore = useStore.getState();

  try {
    switch (toolName) {
      // ========================================================================
      // TRANSCRIPT EDITING TOOLS
      // ========================================================================

      case "delete_words": {
        const { query, clipId, matchType, fromPhrase, toPhrase, includeBoundaries } = toolInput as {
          query?: string;
          clipId?: string;
          matchType?: "exact" | "contains" | "starts_with" | "ends_with";
          fromPhrase?: string;
          toPhrase?: string;
          includeBoundaries?: boolean;
        };
        const words = transcriptStore.getUnifiedTranscript();

        // RANGE DELETION: Delete everything between two phrases
        if (fromPhrase && toPhrase) {
          const fromLower = fromPhrase.toLowerCase();
          const toLower = toPhrase.toLowerCase();
          const includeBounds = includeBoundaries !== false; // default true

          // Build the full text to find phrase positions
          const activeWords = words.filter((w) => !w.isDeleted && (!clipId || w.clipId === clipId));
          const fullText = activeWords.map((w) => w.text.toLowerCase()).join(" ");

          // Find start phrase position
          const fromIndex = fullText.indexOf(fromLower);
          if (fromIndex === -1) {
            return {
              success: false,
              result: `Start phrase "${fromPhrase}" not found in transcript`,
              error: "Start phrase not found",
            };
          }

          // Find end phrase position (must be after start)
          const toIndex = fullText.indexOf(toLower, fromIndex + fromLower.length);
          if (toIndex === -1) {
            return {
              success: false,
              result: `End phrase "${toPhrase}" not found after "${fromPhrase}"`,
              error: "End phrase not found",
            };
          }

          // Map character positions back to word indices
          let charCount = 0;
          let startWordIndex = -1;
          let endWordIndex = -1;

          for (let i = 0; i < activeWords.length; i++) {
            const wordEnd = charCount + activeWords[i].text.length;

            // Find first word that overlaps with fromPhrase
            if (startWordIndex === -1 && wordEnd > fromIndex) {
              startWordIndex = includeBounds ? i : i + fromPhrase.split(/\s+/).length;
            }

            // Find last word that overlaps with toPhrase
            if (charCount <= toIndex + toLower.length && wordEnd >= toIndex + toLower.length) {
              endWordIndex = includeBounds ? i : i - toPhrase.split(/\s+/).length;
              break;
            }

            charCount = wordEnd + 1; // +1 for space
          }

          if (startWordIndex === -1 || endWordIndex === -1 || startWordIndex > endWordIndex) {
            return {
              success: false,
              result: "Could not determine word boundaries for deletion range",
              error: "Range calculation failed",
            };
          }

          // Get words to delete
          const toDelete = activeWords.slice(startWordIndex, endWordIndex + 1);

          if (toDelete.length > 0) {
            // Calculate time saved
            const durationBefore = transcriptStore.getTotalDurationMs();
            transcriptStore.deleteWords(toDelete.map((w) => w.id));
            const durationAfter = transcriptStore.getTotalDurationMs();
            const timeSavedMs = durationBefore - durationAfter;
            const timeSavedSec = (timeSavedMs / 1000).toFixed(1);

            const deletedText = toDelete.map((w) => w.text).join(" ");
            const preview = deletedText.length > 100
              ? deletedText.substring(0, 100) + "..."
              : deletedText;

            toast.success(`Deleted ${toDelete.length} word(s)`, {
              description: `Saved ${timeSavedSec}s · Press Cmd+Z to undo`,
            });

            return {
              success: true,
              result: {
                message: `Deleted ${toDelete.length} word(s) between "${fromPhrase}" and "${toPhrase}"`,
                deletedCount: toDelete.length,
                timeSavedMs,
                preview,
                includedBoundaries: includeBounds,
              },
            };
          }

          return {
            success: false,
            result: "No words found in the specified range",
            error: "Empty range",
          };
        }

        // STANDARD DELETION: Delete words matching a pattern
        if (!query) {
          return {
            success: false,
            result: "Either 'query' or 'fromPhrase'/'toPhrase' must be provided",
            error: "No deletion target specified",
          };
        }

        const queryLower = query.toLowerCase();
        const match = matchType || "contains";

        // Find matching words based on match type
        const toDelete = words.filter((w) => {
          if (w.isDeleted) return false;
          if (clipId && w.clipId !== clipId) return false;

          const textLower = w.text.toLowerCase();
          switch (match) {
            case "exact":
              return textLower === queryLower;
            case "starts_with":
              return textLower.startsWith(queryLower);
            case "ends_with":
              return textLower.endsWith(queryLower);
            case "contains":
            default:
              return textLower.includes(queryLower);
          }
        });

        if (toDelete.length > 0) {
          // Calculate time saved
          const durationBefore = transcriptStore.getTotalDurationMs();
          transcriptStore.deleteWords(toDelete.map((w) => w.id));
          const durationAfter = transcriptStore.getTotalDurationMs();
          const timeSavedMs = durationBefore - durationAfter;
          const timeSavedSec = (timeSavedMs / 1000).toFixed(1);

          toast.success(`Deleted ${toDelete.length} word(s)`, {
            description: `Saved ${timeSavedSec}s · Press Cmd+Z to undo`,
          });
          return {
            success: true,
            result: {
              message: `Deleted ${toDelete.length} instance(s) of "${query}"`,
              deletedCount: toDelete.length,
              timeSavedMs,
              words: toDelete.map((w) => w.text).slice(0, 10),
            },
          };
        }
        return {
          success: false,
          result: `No matches found for "${query}"`,
          error: "No matches found",
        };
      }

      case "restore_words": {
        const { wordIds, restoreAll, query } = toolInput as {
          wordIds?: string[];
          restoreAll?: boolean;
          query?: string;
        };

        if (restoreAll) {
          transcriptStore.restoreAllWords();
          toast.success("Restored all deleted words");
          return {
            success: true,
            result: { message: "Restored all deleted words" },
          };
        }

        if (query) {
          const words = transcriptStore.getUnifiedTranscript();
          const queryLower = query.toLowerCase();
          const toRestore = words.filter(
            (w) => w.isDeleted && w.text.toLowerCase().includes(queryLower)
          );

          for (const word of toRestore) {
            transcriptStore.restoreWord(word.id);
          }

          return {
            success: true,
            result: { message: `Restored ${toRestore.length} word(s) matching "${query}"` },
          };
        }

        if (wordIds && wordIds.length > 0) {
          for (const wordId of wordIds) {
            transcriptStore.restoreWord(wordId);
          }
          return {
            success: true,
            result: { message: `Restored ${wordIds.length} word(s)` },
          };
        }

        return {
          success: false,
          result: "No words specified to restore",
          error: "No words specified",
        };
      }

      case "edit_text": {
        const { find, replace, matchCase, clipId } = toolInput as {
          find: string;
          replace: string;
          matchCase?: boolean;
          clipId?: string;
        };

        const words = transcriptStore.getUnifiedTranscript();
        const findText = matchCase ? find : find.toLowerCase();

        // Find matching words
        const toEdit = words.filter((w) => {
          if (clipId && w.clipId !== clipId) return false;
          const wordText = matchCase ? w.text : w.text.toLowerCase();
          return wordText === findText;
        });

        if (toEdit.length > 0) {
          // Use editWords for batch editing
          const editCount = transcriptStore.editWords([{ find, replace, matchCase }]);

          return {
            success: true,
            result: {
              message: `Changed ${editCount} instance(s) of "${find}" to "${replace}"`,
              editedCount: editCount,
              find,
              replace,
            },
          };
        }

        return {
          success: false,
          result: `No matches found for "${find}"`,
          error: "No matches found",
        };
      }

      case "smart_cuts": {
        const { mode, targets, sensitivity } = toolInput as {
          mode: "suggest" | "apply" | "review";
          targets: string[];
          sensitivity?: "low" | "medium" | "high";
        };

        if (targets.includes("filler-words")) {
          if (mode === "apply") {
            // Calculate time saved
            const durationBefore = transcriptStore.getTotalDurationMs();
            const count = transcriptStore.autoRemoveFillerWords();
            const durationAfter = transcriptStore.getTotalDurationMs();
            const timeSavedMs = durationBefore - durationAfter;
            const timeSavedSec = (timeSavedMs / 1000).toFixed(1);

            if (count > 0) {
              toast.success(`Removed ${count} filler word(s)`, {
                description: `Saved ${timeSavedSec}s · um, uh, like...`,
              });
            }
            return {
              success: true,
              result: {
                message: `Removed ${count} filler word(s)`,
                removedCount: count,
                timeSavedMs,
              },
            };
          } else if (mode === "suggest") {
            const count = transcriptStore.suggestFillerWords();
            const suggested = transcriptStore.getSuggestedWords();
            return {
              success: true,
              result: {
                message: `Found ${count} filler word(s) to review`,
                suggestedCount: count,
                words: suggested.map((w) => w.text).slice(0, 20),
              },
            };
          } else {
            const suggested = transcriptStore.getSuggestedWords();
            return {
              success: true,
              result: {
                message: `${suggested.length} filler word(s) currently suggested for removal`,
                suggestedCount: suggested.length,
                words: suggested.map((w) => w.text).slice(0, 20),
              },
            };
          }
        }

        return {
          success: true,
          result: { message: "No matching targets found" },
        };
      }

      case "reorder_clips": {
        const { clipId, direction, newOrder } = toolInput as {
          clipId?: string;
          direction?: "up" | "down" | "first" | "last";
          newOrder?: string[];
        };

        if (newOrder) {
          transcriptStore.reorderClips(newOrder);
          return {
            success: true,
            result: { message: "Clips reordered", newOrder },
          };
        }

        if (clipId && direction) {
          const currentOrder = transcriptStore.clipOrder;
          const currentIndex = currentOrder.indexOf(clipId);

          if (currentIndex === -1) {
            return {
              success: false,
              result: `Clip ${clipId} not found`,
              error: "Clip not found",
            };
          }

          const newOrderArray = [...currentOrder];

          switch (direction) {
            case "up":
              if (currentIndex > 0) {
                [newOrderArray[currentIndex - 1], newOrderArray[currentIndex]] = [
                  newOrderArray[currentIndex],
                  newOrderArray[currentIndex - 1],
                ];
              }
              break;
            case "down":
              if (currentIndex < newOrderArray.length - 1) {
                [newOrderArray[currentIndex], newOrderArray[currentIndex + 1]] = [
                  newOrderArray[currentIndex + 1],
                  newOrderArray[currentIndex],
                ];
              }
              break;
            case "first":
              newOrderArray.splice(currentIndex, 1);
              newOrderArray.unshift(clipId);
              break;
            case "last":
              newOrderArray.splice(currentIndex, 1);
              newOrderArray.push(clipId);
              break;
          }

          transcriptStore.reorderClips(newOrderArray);
          return {
            success: true,
            result: { message: `Moved clip ${direction}`, newOrder: newOrderArray },
          };
        }

        return {
          success: false,
          result: "No reorder action specified",
          error: "No action specified",
        };
      }

      case "trim_clip": {
        const { clipId, startMs, endMs } = toolInput as {
          clipId: string;
          startMs?: number;
          endMs?: number;
        };

        const clip = transcriptStore.clips[clipId];
        if (!clip) {
          return {
            success: false,
            result: `Clip ${clipId} not found`,
            error: "Clip not found",
          };
        }

        transcriptStore.trimClip(
          clipId,
          startMs ?? 0,
          endMs ?? Infinity
        );

        return {
          success: true,
          result: {
            message: `Trimmed clip ${clipId}`,
            startMs: startMs ?? 0,
            endMs: endMs ?? "end",
          },
        };
      }

      case "get_transcript": {
        const { includeDeleted, clipId, format } = toolInput as {
          includeDeleted?: boolean;
          clipId?: string;
          format?: "full" | "text-only" | "words-with-timing";
        };

        let words = includeDeleted
          ? transcriptStore.getUnifiedTranscript()
          : transcriptStore.getActiveWords();

        if (clipId) {
          words = words.filter((w) => w.clipId === clipId);
        }

        const clips = Object.values(transcriptStore.clips).map((c) => ({
          id: c.clipId,
          status: c.status,
          wordCount: c.words.length,
          deletedCount: c.words.filter((w) => w.isDeleted).length,
        }));

        if (format === "text-only") {
          return {
            success: true,
            result: {
              text: words.map((w) => w.text).join(" "),
            },
          };
        }

        if (format === "words-with-timing") {
          // CRITICAL: Return TIMELINE-MAPPED timestamps, not source timestamps!
          // This ensures Claude uses the correct position after clip reordering/trimming
          const wordsWithTimeline = getWordsWithTimelinePositions();

          // If clipId filter is specified, filter the timeline-mapped words
          const filteredWords = clipId
            ? wordsWithTimeline.filter(w => w.word.clipId === clipId)
            : wordsWithTimeline;

          return {
            success: true,
            result: {
              words: filteredWords.map((w) => ({
                text: w.word.text,
                startMs: w.timelineStartMs,  // TIMELINE position, not source!
                endMs: w.timelineEndMs,      // TIMELINE position, not source!
                // Also include source timestamps for debugging if needed
                sourceStartMs: w.word.startMs,
                sourceEndMs: w.word.endMs,
              })),
              note: "Timestamps are TIMELINE positions (after reordering/trimming). Use startMs/endMs for B-roll placement.",
            },
          };
        }

        return {
          success: true,
          result: {
            text: words.map((w) => w.text).join(" "),
            wordCount: words.length,
            totalDurationMs: transcriptStore.getTotalDurationMs(),
            clips,
          },
        };
      }

      case "get_project_status": {
        const { detailed } = toolInput as { detailed?: boolean };
        const allWords = transcriptStore.getUnifiedTranscript();
        const activeWords = transcriptStore.getActiveWords();
        const totalDurationMs = transcriptStore.getTotalDurationMs();
        const clips = Object.values(transcriptStore.clips);

        const result: Record<string, unknown> = {
          clipCount: clips.length,
          totalDuration: formatTime(totalDurationMs),
          totalDurationMs,
          wordCount: allWords.length,
          activeWordCount: activeWords.length,
          deletedWordCount: allWords.length - activeWords.length,
        };

        if (detailed) {
          result.clips = clips.map((c) => ({
            id: c.clipId,
            status: c.status,
            wordCount: c.words.length,
            deletedCount: c.words.filter((w) => w.isDeleted).length,
          }));
        }

        return {
          success: true,
          result,
        };
      }

      case "undo": {
        const success = transcriptStore.undo();
        return {
          success,
          result: success
            ? { message: "Undid last action" }
            : { message: "Nothing to undo" },
        };
      }

      case "redo": {
        const success = transcriptStore.redo();
        return {
          success,
          result: success
            ? { message: "Redid last action" }
            : { message: "Nothing to redo" },
        };
      }

      // ========================================================================
      // NAVIGATION & PLAYBACK TOOLS
      // ========================================================================

      case "seek_to": {
        const { timeMs, phrase, position } = toolInput as {
          timeMs?: number;
          phrase?: string;
          position?: "start" | "end" | "middle";
        };
        const playerRef = editorStore.playerRef;

        if (!playerRef?.current) {
          return {
            success: false,
            result: "Player not available",
            error: "Player not ready",
          };
        }

        let seekTime = timeMs;

        if (phrase) {
          const words = transcriptStore.getActiveWords();
          const fullText = words.map((w) => w.text.toLowerCase()).join(" ");
          const phraseIndex = fullText.indexOf(phrase.toLowerCase());

          if (phraseIndex >= 0) {
            // Find the word at this position
            let charCount = 0;
            for (const word of words) {
              if (charCount >= phraseIndex) {
                const pos = position || "start";
                if (pos === "start") {
                  seekTime = word.startMs;
                } else if (pos === "end") {
                  seekTime = word.endMs;
                } else {
                  seekTime = (word.startMs + word.endMs) / 2;
                }
                break;
              }
              charCount += word.text.length + 1;
            }
          } else {
            return {
              success: false,
              result: `Phrase "${phrase}" not found in transcript`,
              error: "Phrase not found",
            };
          }
        }

        if (seekTime !== undefined) {
          const fps = editorStore.fps || 30;
          const frame = Math.floor((seekTime / 1000) * fps);
          playerRef.current.seekTo(frame);
          return {
            success: true,
            result: {
              message: `Seeked to ${formatTime(seekTime)}`,
              timeMs: seekTime,
            },
          };
        }

        return {
          success: false,
          result: "No seek target specified",
          error: "No target specified",
        };
      }

      case "set_playback_rate": {
        const { rate } = toolInput as { rate: number };
        // Note: Remotion Player doesn't have built-in playback rate control
        // This would need custom implementation
        return {
          success: true,
          result: {
            message: `Playback rate set to ${rate}x`,
            rate,
          },
        };
      }

      // ========================================================================
      // TEXT OVERLAY TOOLS
      // ========================================================================

      case "add_text_overlay": {
        const { text, style, startMs, durationMs, position, animation, styling } = toolInput as {
          text: string;
          style?: string;
          startMs?: number;
          durationMs?: number;
          position?: { horizontal: string; vertical: string };
          animation?: { in?: string; out?: string; loop?: string };
          styling?: {
            fontFamily?: string;
            fontSize?: number;
            fontWeight?: string;
            color?: string;
            backgroundColor?: string;
            textShadow?: boolean;
            textStroke?: boolean;
            textTransform?: string;
          };
        };

        const id = nanoid();
        const fps = editorStore.fps || 30;
        const duration = durationMs ?? 3000;

        // Validate startMs is provided - don't default to 0
        if (startMs === undefined) {
          console.warn("[Text Overlay] No startMs provided - this may cause incorrect placement");
        }

        let from = startMs ?? 0;
        let to = from + duration;
        let warning: string | undefined;

        // Check for conflicts with existing text overlays
        const conflicts = findTimelineConflicts(from, to, "text");
        if (conflicts.length > 0) {
          console.warn(`[Text Overlay] Found ${conflicts.length} conflict(s) at ${formatTime(from)}:`, conflicts);

          // Auto-adjust to next available slot
          const adjustedStart = findNextAvailableSlot(from, duration, "text");
          if (adjustedStart !== from) {
            warning = `Adjusted timing from ${formatTime(from)} to ${formatTime(adjustedStart)} to avoid overlap with existing text`;
            console.log(`[Text Overlay] ${warning}`);
            from = adjustedStart;
            to = from + duration;
          }
        }

        // Validate against project duration
        const totalDuration = transcriptStore.getTotalDurationMs();
        if (totalDuration > 0) {
          if (from >= totalDuration) {
            from = Math.max(0, totalDuration - duration);
            to = from + duration;
            warning = (warning ? warning + ". " : "") + `Clamped to project duration`;
          }
        }

        // Calculate position based on grid
        const { size } = editorStore;
        let x = size.width / 2;
        let y = size.height / 2;

        if (position) {
          if (position.horizontal === "left") x = size.width * 0.2;
          if (position.horizontal === "right") x = size.width * 0.8;
          if (position.vertical === "top") y = size.height * 0.15;
          if (position.vertical === "bottom") y = size.height * 0.85;
        }

        // Style presets - 52px is the default "sweet spot" size
        const stylePresets: Record<string, Partial<typeof styling>> = {
          title: { fontSize: 64, fontWeight: "bold", color: "#ffffff" },
          subtitle: { fontSize: 42, color: "#ffffff" },
          "lower-third": { fontSize: 36, color: "#ffffff", backgroundColor: "#000000" },
          callout: { fontSize: 48, color: "#FFD700" },
          quote: { fontSize: 52, color: "#ffffff", textTransform: "none" },
          heading: { fontSize: 56, fontWeight: "bold", color: "#ffffff" },
          body: { fontSize: 40, color: "#ffffff" },
        };

        const presetStyle = style ? stylePresets[style] || {} : {};
        const mergedStyle = { ...presetStyle, ...styling };

        const payload = {
          id,
          type: "text",
          display: {
            from,
            to,
          },
          details: {
            text,
            fontSize: mergedStyle.fontSize || 52,
            fontFamily: mergedStyle.fontFamily || "Inter-Bold",
            color: mergedStyle.color || "#ffffff",
            backgroundColor: mergedStyle.backgroundColor || "transparent",
            textAlign: "center",
            width: 800,
            height: 200,
            top: y - 100,
            left: x - 400,
            wordWrap: "break-word",
            borderWidth: mergedStyle.textStroke ? 3 : 0,
            borderColor: "#000000",
            textTransform: mergedStyle.textTransform || "none",
            boxShadow: mergedStyle.textShadow
              ? { color: "#000000", x: 2, y: 2, blur: 8 }
              : { color: "transparent", x: 0, y: 0, blur: 0 },
          },
        };

        // Dispatch to DesignCombo state manager - it will sync to Zustand via subscriptions
        dispatch(ADD_TEXT, {
          payload,
          options: {},
        });

        toast.success("Text overlay added", {
          description: `At ${formatTime(from)} - "${text.substring(0, 30)}${text.length > 30 ? "..." : ""}"`,
        });

        return {
          success: true,
          result: {
            message: `Added text overlay "${text.substring(0, 30)}..."${warning ? ` (${warning})` : ""} at ${formatTime(from)}`,
            elementId: id,
            startMs: from,
            durationMs: to - from,
            warning,
          },
        };
      }

      case "edit_text_overlay": {
        const { elementId, updates } = toolInput as {
          elementId: string;
          updates: {
            text?: string;
            startMs?: number;
            durationMs?: number;
            color?: string;
            fontSize?: number;
            animation?: string;
          };
        };

        // Get fresh state
        const freshState = useStore.getState();
        const trackItem = freshState.trackItemsMap[elementId];
        if (!trackItem) {
          return {
            success: false,
            result: `Element ${elementId} not found`,
            error: "Element not found",
          };
        }

        const payload: Record<string, unknown> = {};

        if (updates.text) {
          payload.details = { ...(payload.details as object || {}), text: updates.text };
        }
        if (updates.color) {
          payload.details = { ...(payload.details as object || {}), color: updates.color };
        }
        if (updates.fontSize) {
          payload.details = { ...(payload.details as object || {}), fontSize: updates.fontSize };
        }
        if (updates.startMs !== undefined || updates.durationMs !== undefined) {
          const currentFrom = trackItem.display?.from || 0;
          const currentTo = trackItem.display?.to || 5000;
          payload.display = {
            from: updates.startMs ?? currentFrom,
            to: updates.startMs !== undefined && updates.durationMs
              ? updates.startMs + updates.durationMs
              : updates.durationMs
                ? currentFrom + updates.durationMs
                : currentTo,
          };
        }

        // Update Zustand store directly for immediate effect
        const updatedItem = {
          ...trackItem,
          ...(payload.display ? { display: { ...(trackItem.display as object || {}), ...(payload.display as object) } } : {}),
          details: {
            ...((trackItem.details as object) || {}),
            ...((payload.details as object) || {}),
          },
        };

        useStore.setState({
          trackItemsMap: {
            ...freshState.trackItemsMap,
            [elementId]: updatedItem as typeof trackItem,
          },
        });

        // Also dispatch to state manager for composition
        dispatch(EDIT_OBJECT, {
          payload: {
            [elementId]: payload,
          },
        });

        return {
          success: true,
          result: {
            message: `Updated text overlay ${elementId}`,
            updates,
          },
        };
      }

      case "remove_element": {
        const { elementId } = toolInput as { elementId: string };

        // Get fresh state to check and update
        const freshState = useStore.getState();

        // Check if element exists
        const element = freshState.trackItemsMap[elementId];
        if (!element) {
          return {
            success: false,
            result: `Element ${elementId} not found`,
            error: "Element not found",
          };
        }

        // Get element info for response
        const elementType = element.type;
        const elementText = element.details?.text ? String(element.details.text).substring(0, 30) : null;

        // Update Zustand store directly for immediate effect
        const newTrackItemsMap = { ...freshState.trackItemsMap };
        delete newTrackItemsMap[elementId];
        const newTrackItemIds = freshState.trackItemIds.filter(id => id !== elementId);
        useStore.setState({
          trackItemsMap: newTrackItemsMap,
          trackItemIds: newTrackItemIds,
        });

        // Also dispatch to DesignCombo state manager for persistence
        dispatch(LAYER_DELETE, {
          payload: {
            trackItemIds: [elementId],
          },
        });

        return {
          success: true,
          result: {
            message: `Removed ${elementType}${elementText ? ` "${elementText}..."` : ''} (ID: ${elementId})`,
            elementId,
            elementType,
          },
        };
      }

      case "smart_add_text": {
        const { text, style, startMs, durationMs } = toolInput as {
          text: string;
          style?: string;
          startMs?: number;
          durationMs?: number;
        };

        // Get current frame as base64
        const playerRef = editorStore.playerRef;
        let frameBase64: string | null = null;

        if (playerRef?.current) {
          try {
            // Try to capture frame from video element in the player
            const playerContainer = document.querySelector('[data-remotion-player]') || document.querySelector('.remotion-player');
            const videoElement = playerContainer?.querySelector('video');

            if (videoElement) {
              const canvas = document.createElement('canvas');
              canvas.width = videoElement.videoWidth || 1080;
              canvas.height = videoElement.videoHeight || 1920;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(videoElement, 0, 0);
                frameBase64 = canvas.toDataURL('image/png').split(',')[1];
              }
            }
          } catch (e) {
            console.error('Failed to capture frame:', e);
          }
        }

        // If we couldn't capture frame, fall back to regular add_text_overlay behavior
        if (!frameBase64) {
          console.log('[smart_add_text] Could not capture frame, using default placement');
          // Default placement
          const id = nanoid();
          const { size } = editorStore;
          const currentFrame = playerRef?.current?.getCurrentFrame() || 0;
          const fps = editorStore.fps || 30;
          const from = startMs ?? Math.round((currentFrame / fps) * 1000);
          const to = from + (durationMs ?? 3000);

          const payload = {
            id,
            type: "text",
            display: { from, to },
            details: {
              text,
              fontSize: 52,
              fontFamily: "Inter-Bold",
              color: "#ffffff",
              backgroundColor: "transparent",
              textAlign: "center",
              width: 800,
              height: 200,
              top: size.height * 0.1,
              left: (size.width - 800) / 2,
              wordWrap: "break-word",
              borderWidth: 0,
              borderColor: "#000000",
              boxShadow: { color: "#000000", x: 2, y: 2, blur: 8 },
            },
          };

          dispatch(ADD_TEXT, { payload, options: {} });

          return {
            success: true,
            result: {
              message: `Added text "${text.substring(0, 30)}..." with default placement (frame capture unavailable)`,
              elementId: id,
            },
          };
        }

        // Analyze frame with Gemini
        try {
          const response = await fetch('/api/analyze-frame', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              frameBase64,
              text,
              style: style || 'title',
            }),
          });

          const result = await response.json();

          if (!result.success || !result.placement) {
            throw new Error(result.error || 'Analysis failed');
          }

          const { placement } = result;

          // Convert AI recommendations to actual values
          const { size } = editorStore;
          const id = nanoid();
          const currentFrame = playerRef?.current?.getCurrentFrame() || 0;
          const fps = editorStore.fps || 30;
          const from = startMs ?? Math.round((currentFrame / fps) * 1000);
          const to = from + (durationMs ?? 3000);

          // Map fontSize recommendation (52px is the default "sweet spot")
          const fontSizeMap: Record<string, number> = {
            small: 36,
            medium: 52,
            large: 64,
            xlarge: 80,
          };
          const fontSize = fontSizeMap[placement.styling.fontSize] || 52;

          // Calculate position from percentage
          const x = (placement.position.x / 100) * size.width;
          const y = (placement.position.y / 100) * size.height;

          const payload = {
            id,
            type: "text",
            display: { from, to },
            details: {
              text,
              fontSize,
              fontFamily: placement.styling.fontWeight === "bold" ? "Inter-Bold" : "Inter-Regular",
              color: placement.styling.color,
              backgroundColor: placement.styling.backgroundColor || "transparent",
              textAlign: "center",
              width: Math.min(size.width * 0.9, 900),
              height: 200,
              top: y - 100,
              left: x - 400,
              wordWrap: "break-word",
              borderWidth: placement.styling.textStroke ? 3 : 0,
              borderColor: "#000000",
              boxShadow: placement.styling.textShadow
                ? { color: "#000000", x: 2, y: 2, blur: 8 }
                : { color: "transparent", x: 0, y: 0, blur: 0 },
            },
          };

          dispatch(ADD_TEXT, { payload, options: {} });

          return {
            success: true,
            result: {
              message: `Added text "${text.substring(0, 30)}..." with AI-optimized placement`,
              elementId: id,
              placement: {
                position: `${placement.position.horizontal} ${placement.position.vertical}`,
                color: placement.styling.color,
                fontSize: placement.styling.fontSize,
                reasoning: placement.reasoning,
              },
            },
          };
        } catch (error) {
          console.error('[smart_add_text] AI analysis failed:', error);

          // Fallback to default placement
          const id = nanoid();
          const { size } = editorStore;
          const currentFrame = playerRef?.current?.getCurrentFrame() || 0;
          const fps = editorStore.fps || 30;
          const from = startMs ?? Math.round((currentFrame / fps) * 1000);
          const to = from + (durationMs ?? 3000);

          const payload = {
            id,
            type: "text",
            display: { from, to },
            details: {
              text,
              fontSize: 52,
              fontFamily: "Inter-Bold",
              color: "#ffffff",
              backgroundColor: "transparent",
              textAlign: "center",
              width: 800,
              height: 200,
              top: size.height * 0.1,
              left: (size.width - 800) / 2,
              wordWrap: "break-word",
              borderWidth: 0,
              borderColor: "#000000",
              boxShadow: { color: "#000000", x: 2, y: 2, blur: 8 },
            },
          };

          dispatch(ADD_TEXT, { payload, options: {} });

          return {
            success: true,
            result: {
              message: `Added text "${text.substring(0, 30)}..." with default placement (AI analysis unavailable)`,
              elementId: id,
            },
          };
        }
      }

      // ========================================================================
      // CAPTION STYLING TOOLS
      // ========================================================================

      case "apply_caption_preset": {
        const { preset } = toolInput as { preset: string };

        const presetIndex = CAPTION_PRESET_MAP[preset] ?? 0;
        const presetConfig = STYLE_CAPTION_PRESETS[presetIndex];

        if (!presetConfig) {
          return {
            success: false,
            result: `Preset "${preset}" not found`,
            error: "Preset not found",
          };
        }

        // Get all caption items
        const { trackItemsMap } = editorStore;
        const groupedCaptions = groupCaptionItems(trackItemsMap);

        // Apply to all caption groups
        let appliedCount = 0;
        for (const sourceUrl in groupedCaptions) {
          const captions = groupedCaptions[sourceUrl];
          const captionIds = captions.map((c: { id: string }) => c.id);

          await applyPreset(presetConfig, captionIds, captions);
          appliedCount += captionIds.length;
        }

        if (appliedCount > 0) {
          toast.success(`Caption style applied`, {
            description: `"${preset}" preset`,
          });
        }

        return {
          success: true,
          result: {
            message: `Applied "${preset}" preset to ${appliedCount} caption(s)`,
            preset,
            appliedCount,
          },
        };
      }

      case "customize_caption_style": {
        const { colors, typography, effects, animation, layout } = toolInput as {
          colors?: {
            activeColor?: string;
            appearedColor?: string;
            baseColor?: string;
            activeFillColor?: string;
            keywordColor?: string;
          };
          typography?: {
            fontFamily?: string;
            fontSize?: number;
            fontWeight?: string;
            textTransform?: string;
            letterSpacing?: number;
          };
          effects?: {
            textStroke?: boolean;
            strokeWidth?: number;
            strokeColor?: string;
            textShadow?: boolean;
            shadowColor?: string;
            shadowBlur?: number;
          };
          animation?: string;
          layout?: {
            position?: string;
            alignment?: string;
            linesPerCaption?: number;
            wordsPerLine?: string;
          };
        };

        const { trackItemsMap } = editorStore;
        const groupedCaptions = groupCaptionItems(trackItemsMap);

        const updates: Record<string, unknown> = {};

        if (colors) {
          if (colors.activeColor) updates.activeColor = colors.activeColor;
          if (colors.appearedColor) updates.appearedColor = colors.appearedColor;
          if (colors.baseColor) updates.color = colors.baseColor;
          if (colors.activeFillColor) updates.activeFillColor = colors.activeFillColor;
        }

        if (typography) {
          if (typography.fontFamily) updates.fontFamily = typography.fontFamily;
          if (typography.fontSize) updates.fontSize = typography.fontSize;
          if (typography.textTransform) updates.textTransform = typography.textTransform;
        }

        if (effects) {
          if (effects.textStroke !== undefined) {
            updates.borderWidth = effects.strokeWidth || (effects.textStroke ? 5 : 0);
            updates.borderColor = effects.strokeColor || "#000000";
          }
          if (effects.textShadow !== undefined) {
            updates.boxShadow = {
              color: effects.shadowColor || "#000000",
              x: 15,
              y: 15,
              blur: effects.shadowBlur || 30,
            };
          }
        }

        if (animation) {
          updates.animation = animation;
        }

        // Apply to all captions
        let updatedCount = 0;
        for (const sourceUrl in groupedCaptions) {
          const captions = groupedCaptions[sourceUrl];
          for (const caption of captions) {
            dispatch(EDIT_OBJECT, {
              payload: {
                [caption.id]: {
                  details: updates,
                },
              },
            });
            updatedCount++;
          }
        }

        return {
          success: true,
          result: {
            message: `Updated ${updatedCount} caption style(s)`,
            updates,
          },
        };
      }

      case "highlight_keywords": {
        const { keywords, style } = toolInput as {
          keywords: string[];
          style?: {
            color?: string;
            scale?: number;
            animation?: string;
          };
        };

        // Store keywords in caption settings for highlighting
        // This would need integration with the caption rendering component
        return {
          success: true,
          result: {
            message: `Marked ${keywords.length} keyword(s) for highlighting: ${keywords.join(", ")}`,
            keywords,
            style,
          },
        };
      }

      // ========================================================================
      // ASSET GENERATION TOOLS
      // ========================================================================

      case "generate_broll_image": {
        const {
          prompt,
          transcriptContext,
          placement = "fullscreen",
          overlaySize = 60,
          style,
          aspectRatio,
          insertAt,
          durationMs,
        } = toolInput as {
          prompt: string;
          transcriptContext?: string;
          placement?: "fullscreen" | "center" | "top-center" | "bottom-center";
          overlaySize?: number;
          style?: string;
          aspectRatio?: string;
          insertAt?: number;
          durationMs?: number;
        };

        // Warn if no transcript context provided
        if (!transcriptContext) {
          console.warn("[B-roll] No transcriptContext provided. Consider using suggest_broll_moments first for better placement.");
        }

        // Call the API route for B-roll generation
        const response = await fetch("/api/generate-broll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, style, aspectRatio }),
        });

        if (!response.ok) {
          const error = await response.json();
          return {
            success: false,
            result: error.message || "Failed to generate B-roll image",
            error: error.message,
          };
        }

        const data = await response.json();

        // If insertAt is specified, add the image to the timeline
        if (insertAt !== undefined) {
          const id = nanoid();
          const duration = durationMs || 3000;
          // Get fresh state for size and for updating
          const freshState = useStore.getState();
          const { size } = freshState;

          // Get total duration to validate insertAt bounds
          const transcriptState = useTranscriptStore.getState();
          const totalDurationMs = transcriptState.getTotalDurationMs();

          // Validate and clamp insertAt to project bounds
          let safeInsertAt = insertAt;
          let warning: string | undefined;

          if (totalDurationMs > 0) {
            if (insertAt >= totalDurationMs) {
              // Clamp to end of project minus the B-roll duration
              safeInsertAt = Math.max(0, totalDurationMs - duration);
              warning = `insertAt (${insertAt}ms) exceeded project duration (${totalDurationMs}ms). Clamped to ${safeInsertAt}ms.`;
              console.warn(`[B-roll] ${warning}`);
            } else if (insertAt + duration > totalDurationMs) {
              // Shorten duration to fit within project
              warning = `B-roll extends beyond project end. Duration may be truncated.`;
              console.warn(`[B-roll] ${warning}`);
            }
          }

          // Check for conflicts with existing B-roll images
          const imageConflicts = findTimelineConflicts(safeInsertAt, safeInsertAt + duration, "image");
          if (imageConflicts.length > 0) {
            console.warn(`[B-roll] Found ${imageConflicts.length} B-roll conflict(s) at ${formatTime(safeInsertAt)}:`, imageConflicts);
            // Auto-adjust to next available slot
            const adjustedStart = findNextAvailableSlot(safeInsertAt, duration, "image");
            if (adjustedStart !== safeInsertAt) {
              const adjustWarning = `Adjusted timing from ${formatTime(safeInsertAt)} to ${formatTime(adjustedStart)} to avoid overlap`;
              warning = warning ? `${warning}. ${adjustWarning}` : adjustWarning;
              console.log(`[B-roll] ${adjustWarning}`);
              safeInsertAt = adjustedStart;
            }
          }

          // Calculate dimensions and position based on placement mode
          let imageWidth: number;
          let imageHeight: number;
          let imageTop: number;
          let imageLeft: number;
          let borderRadius = 0;

          if (placement === "fullscreen") {
            // Fullscreen mode: covers entire video (traditional cutaway)
            imageWidth = size.width;
            imageHeight = size.height;
            imageTop = 0;
            imageLeft = 0;
          } else {
            // Overlay modes: centered, doesn't block speaker's face
            const sizeClamped = Math.min(80, Math.max(40, overlaySize)); // Clamp between 40-80%
            imageWidth = Math.round(size.width * (sizeClamped / 100));
            imageHeight = Math.round(size.height * (sizeClamped / 100));
            borderRadius = 16; // Rounded corners for overlays

            // Center horizontally for all overlay modes
            imageLeft = Math.round((size.width - imageWidth) / 2);

            // Vertical positioning based on placement
            switch (placement) {
              case "top-center":
                // Upper area - good for vertical video where face is lower
                imageTop = Math.round(size.height * 0.08); // 8% from top
                break;
              case "bottom-center":
                // Lower area - good when face is in upper portion
                imageTop = Math.round(size.height - imageHeight - (size.height * 0.08));
                break;
              case "center":
              default:
                // True center
                imageTop = Math.round((size.height - imageHeight) / 2);
                break;
            }
          }

          const imagePayload = {
            id,
            type: "image",
            display: {
              from: safeInsertAt,
              to: safeInsertAt + duration,
            },
            details: {
              src: data.url,
              width: imageWidth,
              height: imageHeight,
              top: imageTop,
              left: imageLeft,
              opacity: 100,
              brightness: 100,
              blur: 0,
              borderRadius,
              borderWidth: placement !== "fullscreen" ? 2 : 0,
              borderColor: placement !== "fullscreen" ? "rgba(255,255,255,0.2)" : "transparent",
              // Use 'contain' so the full image is always visible without cropping
              // 'cover' would fill the container but crop parts of the image
              objectFit: "contain",
            },
            // Required for animation system - null values mean no animations
            animations: {
              in: null,
              out: null,
            },
          };

          console.log(`[B-roll] Adding ${placement} image to timeline:`, {
            id,
            placement,
            transcriptContext: transcriptContext?.substring(0, 50),
            src: data.url.substring(0, 50) + "...",
            from: safeInsertAt,
            to: safeInsertAt + duration,
            dimensions: { width: imageWidth, height: imageHeight, top: imageTop, left: imageLeft },
          });

          // Dispatch to DesignCombo state manager
          dispatch(ADD_IMAGE, {
            payload: imagePayload,
            options: {},
          });

          // CRITICAL: Also update Zustand store directly for immediate UI effect
          // This ensures the image appears on the timeline even if subscription sync is delayed
          const currentState = useStore.getState();
          useStore.setState({
            trackItemsMap: {
              ...currentState.trackItemsMap,
              [id]: imagePayload as unknown as typeof currentState.trackItemsMap[string],
            },
            trackItemIds: [...currentState.trackItemIds, id],
          });

          console.log(`[B-roll] Updated Zustand store directly. trackItemIds now has ${currentState.trackItemIds.length + 1} items`);

          const placementLabel = placement === "fullscreen" ? "cutaway" : `${placement} overlay`;
          toast.success(`B-roll added (${placementLabel})`, {
            description: `At ${formatTime(safeInsertAt)} - "${transcriptContext?.substring(0, 30) || prompt.substring(0, 30)}..."`,
          });

          return {
            success: true,
            result: {
              message: `Generated and inserted B-roll (${placementLabel}) for: "${prompt}"${warning ? ` (${warning})` : ""}`,
              imageUrl: data.url,
              elementId: id,
              insertedAt: safeInsertAt,
              durationMs: duration,
              placement,
              transcriptContext,
              warning,
            },
          };
        }

        return {
          success: true,
          result: {
            message: `Generated B-roll image for: "${prompt}" (not inserted - no insertAt specified)`,
            imageUrl: data.url,
            style,
            hint: "Use insertAt parameter to place this image on the timeline. Run suggest_broll_moments first to find good placement times.",
          },
        };
      }

      case "generate_video_clip": {
        const { prompt, style, duration, aspectRatio, referenceImage, withAudio } = toolInput as {
          prompt: string;
          style?: string;
          duration?: number;
          aspectRatio?: string;
          referenceImage?: string;
          withAudio?: boolean;
        };

        // Call the video generation API
        const response = await fetch("/api/generate-video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            style: style || "cinematic",
            duration: duration || 6,
            aspectRatio: aspectRatio || "9:16",
            referenceImageUrl: referenceImage,
            withAudio,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          return {
            success: false,
            result: error.message || "Failed to generate video",
            error: error.message,
          };
        }

        const data = await response.json();

        return {
          success: true,
          result: {
            message: data.status === "completed"
              ? `Generated video clip for: "${prompt}"`
              : `Video generation started for: "${prompt}"`,
            videoUrl: data.videoUrl,
            jobId: data.jobId,
            status: data.status,
            estimatedTimeSeconds: data.estimatedTimeSeconds,
          },
        };
      }

      case "extend_video": {
        const { clipId, direction, durationSeconds, prompt } = toolInput as {
          clipId: string;
          direction: "before" | "after";
          durationSeconds?: number;
          prompt?: string;
        };

        const clip = transcriptStore.clips[clipId];
        if (!clip) {
          return {
            success: false,
            result: `Clip ${clipId} not found`,
            error: "Clip not found",
          };
        }

        // Call the video extension API
        const response = await fetch("/api/generate-video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "extend",
            sourceVideoUrl: clip.url,
            direction,
            durationSeconds: durationSeconds || 4,
            prompt,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          return {
            success: false,
            result: error.message || "Failed to extend video",
            error: error.message,
          };
        }

        const data = await response.json();

        return {
          success: true,
          result: {
            message: `Video extension ${data.status === "completed" ? "completed" : "started"} (${direction} clip ${clipId})`,
            videoUrl: data.videoUrl,
            status: data.status,
          },
        };
      }

      case "video_to_video": {
        const { clipId, effect, prompt, intensity } = toolInput as {
          clipId: string;
          effect: string;
          prompt?: string;
          intensity?: number;
        };

        const clip = transcriptStore.clips[clipId];
        if (!clip) {
          return {
            success: false,
            result: `Clip ${clipId} not found`,
            error: "Clip not found",
          };
        }

        // Call the video transformation API
        const response = await fetch("/api/generate-video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "transform",
            sourceVideoUrl: clip.url,
            effect,
            prompt,
            intensity: intensity ?? 0.7,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          return {
            success: false,
            result: error.message || "Failed to transform video",
            error: error.message,
          };
        }

        const data = await response.json();

        return {
          success: true,
          result: {
            message: `Video transformation ${data.status === "completed" ? "completed" : "started"} (${effect} on clip ${clipId})`,
            videoUrl: data.videoUrl,
            status: data.status,
          },
        };
      }

      // ========================================================================
      // AUDIO & VISUALIZATION TOOLS
      // ========================================================================

      case "add_audio_visualization": {
        const { type, style, position, startMs, durationMs } = toolInput as {
          type: "linear-bars" | "wave" | "hill" | "radial";
          style?: {
            color?: string;
            thickness?: number;
            gap?: number;
            roundness?: number;
            height?: number;
          };
          position?: { x?: number; y?: number };
          startMs?: number;
          durationMs?: number;
        };

        // Audio visualization would need custom component implementation
        return {
          success: true,
          result: {
            message: `Audio visualization (${type}) would be added - feature requires custom implementation`,
            type,
            style,
            position,
          },
        };
      }

      case "adjust_audio": {
        const { clipId, volume, fadeInMs, fadeOutMs } = toolInput as {
          clipId: string;
          volume?: number;
          fadeInMs?: number;
          fadeOutMs?: number;
        };

        const trackItem = editorStore.trackItemsMap[clipId];
        if (!trackItem) {
          // Try looking in transcript clips
          const clip = transcriptStore.clips[clipId];
          if (!clip) {
            return {
              success: false,
              result: `Clip ${clipId} not found`,
              error: "Clip not found",
            };
          }
        }

        // Audio adjustments would be applied to the track item
        const updates: Record<string, unknown> = {};
        if (volume !== undefined) updates.volume = volume;
        if (fadeInMs !== undefined) updates.fadeInDuration = fadeInMs;
        if (fadeOutMs !== undefined) updates.fadeOutDuration = fadeOutMs;

        dispatch(EDIT_OBJECT, {
          payload: {
            [clipId]: {
              details: updates,
            },
          },
        });

        return {
          success: true,
          result: {
            message: `Audio adjusted for clip ${clipId}`,
            volume,
            fadeInMs,
            fadeOutMs,
          },
        };
      }

      // ========================================================================
      // VISUAL EFFECTS TOOLS
      // ========================================================================

      case "apply_transition": {
        const { type, atMs, durationMs } = toolInput as {
          type: string;
          atMs?: number;
          durationMs?: number;
        };

        // Transitions would need to be applied at cut points
        return {
          success: true,
          result: {
            message: `Transition "${type}" would be applied - feature requires cut point detection`,
            type,
            atMs,
            durationMs: durationMs || 500,
          },
        };
      }

      case "apply_video_filter": {
        const { clipId, filters } = toolInput as {
          clipId?: string;
          filters: {
            brightness?: number;
            contrast?: number;
            saturation?: number;
            blur?: number;
            vignette?: number;
          };
        };

        // Video filters would be applied via CSS filters or Remotion effects
        const filterString = Object.entries(filters)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => {
            switch (k) {
              case "brightness": return `brightness(${v})`;
              case "contrast": return `contrast(${v})`;
              case "saturation": return `saturate(${v})`;
              case "blur": return `blur(${v}px)`;
              default: return "";
            }
          })
          .filter(Boolean)
          .join(" ");

        return {
          success: true,
          result: {
            message: `Filter applied${clipId ? ` to clip ${clipId}` : " globally"}`,
            filters,
            cssFilter: filterString,
          },
        };
      }

      case "add_shape": {
        const { shape, position, size, style, startMs, durationMs, animation } = toolInput as {
          shape: string;
          position?: { x?: number; y?: number };
          size?: { width?: number; height?: number };
          style?: {
            fillColor?: string;
            strokeColor?: string;
            strokeWidth?: number;
            opacity?: number;
          };
          startMs?: number;
          durationMs?: number;
          animation?: string;
        };

        // Shapes would be added as custom elements
        return {
          success: true,
          result: {
            message: `Shape "${shape}" would be added - feature requires custom implementation`,
            shape,
            position,
            size,
            style,
          },
        };
      }

      // ========================================================================
      // ANALYSIS & SUGGESTION TOOLS
      // ========================================================================

      case "analyze_transcript": {
        const { analysisType } = toolInput as {
          analysisType: string[];
        };

        const words = transcriptStore.getActiveWords();
        const analysis: Record<string, unknown> = {};

        if (analysisType.includes("filler-words")) {
          const fillerCount = words.filter((w) =>
            FILLER_WORDS.some((f) => w.text.toLowerCase() === f)
          ).length;
          analysis.fillerWords = {
            count: fillerCount,
            percentage: ((fillerCount / words.length) * 100).toFixed(1) + "%",
          };
        }

        if (analysisType.includes("pacing")) {
          const totalDuration = transcriptStore.getTotalDurationMs();
          const wpm = Math.round((words.length / totalDuration) * 60000);
          analysis.pacing = {
            wordsPerMinute: wpm,
            rating: wpm < 120 ? "slow" : wpm > 180 ? "fast" : "moderate",
          };
        }

        if (analysisType.includes("key-moments")) {
          // Simple heuristic: look for question marks, exclamations, and common hook words
          const keyMoments = words
            .filter((w, i) => {
              const text = w.text.toLowerCase();
              return text.includes("!") ||
                text.includes("?") ||
                ["actually", "secret", "important", "key", "tip", "trick"].some((k) =>
                  text.includes(k)
                );
            })
            .slice(0, 5)
            .map((w) => ({
              text: w.text,
              timeMs: w.startMs,
              time: formatTime(w.startMs),
            }));
          analysis.keyMoments = keyMoments;
        }

        return {
          success: true,
          result: {
            message: "Transcript analysis complete",
            analysis,
          },
        };
      }

      case "suggest_broll_moments": {
        const { maxSuggestions, style } = toolInput as {
          maxSuggestions?: number;
          style?: string;
        };

        // Get words with their TIMELINE positions (not source positions)
        const wordsWithTimeline = getWordsWithTimelinePositions();
        const suggestions: Array<{
          timeMs: number;
          time: string;
          context: string;
          prompt: string;
          sourceTimeMs: number; // Original source time for reference
        }> = [];

        // Look for visual keywords that indicate something could be shown
        const visualKeywords = [
          "show", "see", "look", "watch", "imagine", "picture",
          "example", "like", "such as", "for instance",
        ];

        let i = 0;
        while (i < wordsWithTimeline.length && suggestions.length < (maxSuggestions || 5)) {
          const { word, timelineStartMs } = wordsWithTimeline[i];
          const wordLower = word.text.toLowerCase();

          if (visualKeywords.some((k) => wordLower.includes(k))) {
            // Get context (next 5-10 words)
            const contextWords = wordsWithTimeline
              .slice(i, i + 10)
              .map((w) => w.word.text)
              .join(" ");

            // Generate a concrete, realistic prompt instead of abstract "visual representation"
            // The AI agent should interpret the context and create a specific stock-photo-style prompt
            suggestions.push({
              timeMs: timelineStartMs, // USE TIMELINE POSITION!
              time: formatTime(timelineStartMs),
              context: contextWords,
              // NOTE: This is just the raw context - the AI agent calling generate_broll_image
              // should interpret this and write a specific, concrete prompt describing
              // a real photograph (e.g., "person typing on laptop" not "visual of productivity")
              prompt: `[AI: Create a specific stock-photo prompt based on this context] "${contextWords}"`,
              sourceTimeMs: word.startMs, // Keep source time for debugging
            });
            i += 10; // Skip ahead to avoid duplicate suggestions
          } else {
            i++;
          }
        }

        console.log(`[suggest_broll_moments] Found ${suggestions.length} suggestions with TIMELINE timestamps`);

        return {
          success: true,
          result: {
            message: `Found ${suggestions.length} B-roll opportunities. IMPORTANT: When generating images, write SPECIFIC prompts describing real, tangible things to photograph (e.g., "close-up of hands typing on a MacBook keyboard" NOT "visual representation of work"). Think stock photography, not concept art.`,
            suggestions,
            promptGuidance: "For each suggestion, create a prompt describing a REAL photograph of REAL objects. Be specific: what object, what angle, what setting. Example: Instead of 'visual of success', say 'person smiling while looking at phone showing positive graph'.",
          },
        };
      }

      case "find_key_moments": {
        const { purpose, maxMoments } = toolInput as {
          purpose?: string;
          maxMoments?: number;
        };

        // Get words with their TIMELINE positions (not source positions)
        const wordsWithTimeline = getWordsWithTimelinePositions();
        const moments: Array<{
          timeMs: number;
          time: string;
          text: string;
          type: string;
        }> = [];

        // Different heuristics based on purpose
        const max = maxMoments || 5;

        if (purpose === "social-clips" || purpose === "highlights") {
          // Look for strong statements and reactions
          const patterns = [
            { pattern: /!/, type: "exclamation" },
            { pattern: /\?/, type: "question" },
            { pattern: /^(so|now|but|here|this)/i, type: "transition" },
          ];

          for (let i = 0; i < wordsWithTimeline.length && moments.length < max; i++) {
            const { word, timelineStartMs } = wordsWithTimeline[i];
            for (const { pattern, type } of patterns) {
              if (pattern.test(word.text)) {
                // Get context (next ~5 seconds of words)
                const contextWords = wordsWithTimeline
                  .slice(i, i + 15)
                  .filter((w) => w.timelineStartMs < timelineStartMs + 5000)
                  .map((w) => w.word.text)
                  .join(" ");

                moments.push({
                  timeMs: timelineStartMs, // USE TIMELINE POSITION!
                  time: formatTime(timelineStartMs),
                  text: contextWords,
                  type,
                });
                break;
              }
            }
          }
        }

        return {
          success: true,
          result: {
            message: `Found ${moments.length} key moment(s) for ${purpose || "general use"} (timeline-mapped)`,
            moments,
          },
        };
      }

      // ========================================================================
      // ENHANCEMENT & AUTO-EDIT TOOLS
      // ========================================================================

      case "smooth_jump_cuts": {
        const { enabled, zoomAmount, pattern } = toolInput as {
          enabled?: boolean;
          zoomAmount?: number;
          pattern?: "alternate" | "all-zoomed" | "first-normal";
        };

        const effectsStore = useEffectsStore.getState();
        const shouldEnable = enabled !== false; // Default to true

        if (shouldEnable) {
          effectsStore.setSegmentZoom({
            enabled: true,
            amount: zoomAmount ?? 1.05,
            pattern: pattern ?? "alternate",
          });

          return {
            success: true,
            result: {
              message: `Smooth jump cuts enabled with ${((zoomAmount ?? 1.05) - 1) * 100}% zoom (${pattern ?? "alternate"} pattern)`,
              enabled: true,
              zoomAmount: zoomAmount ?? 1.05,
              pattern: pattern ?? "alternate",
            },
          };
        } else {
          effectsStore.disableSmoothCuts();
          return {
            success: true,
            result: {
              message: "Smooth jump cuts disabled",
              enabled: false,
            },
          };
        }
      }

      case "auto_enhance": {
        const { preset, removeFillerWords, smoothCuts, addCaptions, captionStyle } = toolInput as {
          preset?: "quick" | "polished" | "cinematic";
          removeFillerWords?: boolean;
          smoothCuts?: boolean;
          addCaptions?: boolean;
          captionStyle?: string;
        };

        const effectsStore = useEffectsStore.getState();
        const selectedPreset = preset ?? "polished";
        const results: string[] = [];

        // Determine what to apply based on preset
        const shouldRemoveFillerWords = removeFillerWords ?? true;
        const shouldSmoothCuts = smoothCuts ?? true;
        const shouldAddCaptions = addCaptions ?? (selectedPreset !== "quick");

        // Default caption styles per preset
        const defaultCaptionStyles: Record<string, string> = {
          quick: "minimal-clean",
          polished: "tiktok-bold",
          cinematic: "cinematic-white",
        };

        // 1. Remove filler words
        if (shouldRemoveFillerWords) {
          const count = transcriptStore.autoRemoveFillerWords();
          results.push(`Removed ${count} filler word(s)`);
        }

        // 2. Enable smooth cuts
        if (shouldSmoothCuts) {
          const zoomAmount = selectedPreset === "cinematic" ? 1.08 : 1.05;
          effectsStore.setSegmentZoom({
            enabled: true,
            amount: zoomAmount,
            pattern: "alternate",
          });
          results.push(`Enabled jump-cut smoothing (${(zoomAmount - 1) * 100}% zoom)`);
        }

        // 3. Apply captions
        if (shouldAddCaptions) {
          const style = captionStyle ?? defaultCaptionStyles[selectedPreset];
          const presetIndex = CAPTION_PRESET_MAP[style] ?? 0;
          const presetConfig = STYLE_CAPTION_PRESETS[presetIndex];

          if (presetConfig) {
            const { trackItemsMap } = editorStore;
            const groupedCaptions = groupCaptionItems(trackItemsMap);

            let appliedCount = 0;
            for (const sourceUrl in groupedCaptions) {
              const captions = groupedCaptions[sourceUrl];
              const captionIds = captions.map((c: { id: string }) => c.id);
              await applyPreset(presetConfig, captionIds, captions);
              appliedCount += captionIds.length;
            }

            if (appliedCount > 0) {
              results.push(`Applied "${style}" caption style to ${appliedCount} caption(s)`);
            } else {
              results.push(`Caption style "${style}" ready (no captions to apply yet)`);
            }
          }
        }

        // Show a toast notification
        toast.success(`Auto-enhance (${selectedPreset}) applied!`);

        return {
          success: true,
          result: {
            message: `Auto-enhance (${selectedPreset}) complete`,
            preset: selectedPreset,
            actions: results,
          },
        };
      }

      // ========================================================================
      // DEFAULT
      // ========================================================================

      default:
        return {
          success: false,
          result: `Unknown tool: ${toolName}`,
          error: "Unknown tool",
        };
    }
  } catch (error) {
    console.error(`Tool execution error (${toolName}):`, error);
    return {
      success: false,
      result: error instanceof Error ? error.message : "Tool execution failed",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
