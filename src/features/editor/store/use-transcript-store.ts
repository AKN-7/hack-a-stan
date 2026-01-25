import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";
import { dispatch } from "@designcombo/events";
import { ADD_TEXT, ADD_VIDEO } from "@designcombo/state";
import { nanoid } from "nanoid";
// NOTE: We no longer dispatch to DesignCombo for video clips.
// The transcript store IS the source of truth.

// Import effects store for smooth cuts (lazy to avoid circular deps)
const getEffectsStore = () => import("./use-effects-store").then(m => m.default);

// Get editor store for video dimensions (lazy to avoid circular deps)
const getEditorStore = () => import("./use-store").then(m => m.default);

// Debounce timer for auto-magic processing (wait for all clips to finish)
let autoMagicDebounceTimer: NodeJS.Timeout | null = null;
const AUTO_MAGIC_DEBOUNCE_MS = 500; // Wait 500ms after last transcription (reduced from 2s)

// Word with timing and clip association
export interface TranscriptWord {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  clipId: string;
  confidence: number;
  isDeleted?: boolean; // Soft delete for undo support
  isSuggested?: boolean; // Suggested for deletion (user must approve)
}

// Clip trim boundaries (for timeline trimming)
export interface ClipTrim {
  startMs: number;  // Trim start (0 = no trim from start)
  endMs: number;    // Trim end (Infinity = no trim from end)
}

// Clip type for distinguishing between different media types
// - "video_with_audio": Standard video clip with speech (default, has transcript)
// - "audio_only": Audio file (m4a, mp3, etc.) - provides audio track + transcript for captions
// - "video_only": Video without audio/speech - used as B-roll over audio clips
// - "background_music": Audio file with no speech - background music track
export type ClipType = "video_with_audio" | "audio_only" | "video_only" | "background_music";

// Clip transcript status
export interface ClipTranscript {
  clipId: string;
  url: string;
  status: "pending" | "transcribing" | "ready" | "error";
  error?: string;
  words: TranscriptWord[];
  text: string;
  trim?: ClipTrim;  // Optional trim boundaries
  isDeleted?: boolean;  // Soft delete for clips (shows as grayed out, can restore)
  deleteReason?: string;  // Why the clip was deleted (e.g., "Duplicate take - better version in Clip 3")
  clipType?: ClipType;  // Type of clip (default: video_with_audio)
  durationMs?: number;  // Duration of the clip in ms (needed for video_only clips without words)
  volume?: number;  // Volume level 0-1 (default: 1 for video, 0.3 for background_music)
}

// Segment to cut from video
export interface CutSegment {
  clipId: string;
  startMs: number;
  endMs: number;
}

// Segment to keep in video (inverse of cut)
export interface KeepSegment {
  clipId: string;
  clipUrl: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

// Unified segment for rendering (with accumulated offset)
export interface RenderSegment extends KeepSegment {
  offsetMs: number; // Where this segment starts in the final timeline
  clipType?: ClipType; // Type of the source clip
}

// B-roll assignment - maps a video_only clip to a time range in the timeline
export interface BrollAssignment {
  clipId: string;
  clipUrl: string;
  startMs: number;      // Where this B-roll starts in the ORIGINAL video
  endMs: number;        // Where this B-roll ends in the ORIGINAL video
  durationMs: number;   // How long this B-roll segment is
  timelineStartMs: number;  // Where this B-roll appears in the OUTPUT timeline
  timelineEndMs: number;    // Where this B-roll ends in the OUTPUT timeline
}

// History snapshot for undo/redo
interface HistorySnapshot {
  clips: Record<string, ClipTranscript>;
  clipOrder: string[];
  gapThresholdMs: number;
}

// Emphasis point for zoom effect
export interface EmphasisPoint {
  clipId: string;
  wordId: string;
  startMs: number;  // Word start time (within clip)
  reason: string;
  text: string;
}

// Magic processing result for display in chat
export interface MagicProcessingResult {
  fillerCount: number;
  aiCutsCount: number;
  clipsRemoved: number;
  timeSavedMs: number;
  textHook?: string;
  removedClipIds?: string[];
  suggestedOrder?: string[];
  reasoning?: string;
  wordCuts?: Array<{ clipId: string; text: string; reason: string }>;
  emphasisPoints?: EmphasisPoint[];  // AI-detected moments for zoom effect
  completedAt: number; // timestamp
}

interface ITranscriptStore {
  // Per-clip transcripts
  clips: Record<string, ClipTranscript>;

  // Clip order for unified view
  clipOrder: string[];

  // Gap threshold for segment merging (ms)
  gapThresholdMs: number;
  setGapThreshold: (ms: number) => void;

  // Auto-magic processing state
  autoProcessEnabled: boolean;
  setAutoProcessEnabled: (enabled: boolean) => void;
  isProcessing: boolean;
  processingStatus: string;
  processingStartTime: number | null; // When processing started (for elapsed time)
  processingStep: number; // Current step (1-4)
  _hasRunMagicProcessing: boolean; // Prevents running twice
  magicProcessingResult: MagicProcessingResult | null; // Latest result for chat display
  clearMagicProcessingResult: () => void;

  // AI-detected emphasis points for zoom effects
  emphasisPoints: EmphasisPoint[];
  getEmphasisPointsForRender: () => Array<{ startMs: number; endMs: number; reason: string }>;

  // Text hook for display (rendered directly, not through DesignCombo)
  textHook: string | null;

  // Auto-process when all clips are transcribed
  _checkAndAutoProcess: () => void;
  runMagicProcessing: () => Promise<{ fillerCount: number; aiCutsCount: number; clipsRemoved: number; timeSavedMs: number }>;
  resetMagicProcessing: () => void; // Reset to allow running again

  // Smart clip ordering based on content analysis
  analyzeClipOrder: () => { suggestedOrder: string[]; confidence: number; reasoning: string };
  applySmartOrder: () => void;

  // History for undo/redo
  _history: HistorySnapshot[];
  _historyIndex: number;
  _maxHistorySize: number;

  // Undo/Redo actions
  undo: () => boolean;
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
  _pushHistory: () => void;

  // Get unified transcript (all clips merged in order)
  getUnifiedTranscript: () => TranscriptWord[];

  // Get active (non-deleted) words only
  getActiveWords: () => TranscriptWord[];

  // Get segments that should be cut
  getCutSegments: () => CutSegment[];

  // Get segments that should be kept (inverse of cut)
  getKeepSegments: () => KeepSegment[];

  // Get render segments with offsets for timeline
  getRenderSegments: () => RenderSegment[];

  // Get total duration of kept segments
  getTotalDurationMs: () => number;

  // Get captions mapped to output timeline for rendering
  getCaptionsForRender: () => { text: string; startMs: number; endMs: number }[];

  // Get clips by type
  getAudioOnlyClips: () => ClipTranscript[];
  getVideoOnlyClips: () => ClipTranscript[];
  getVideoWithAudioClips: () => ClipTranscript[];
  getBackgroundMusicClips: () => ClipTranscript[];
  hasAudioBrollScenario: () => boolean;
  hasAudioClipsNeedingBroll: () => boolean;

  // Get B-roll assignments for audio-primary mode
  // This maps video_only clips as visuals over audio_only segments
  getBrollAssignments: () => BrollAssignment[];

  // Get audio segments for rendering (audio_only clips with transcript)
  getAudioSegments: () => RenderSegment[];

  // Actions
  addClip: (clipId: string, url: string, clipType?: ClipType, durationMs?: number) => void;
  setClipType: (clipId: string, clipType: ClipType) => void;
  setClipDurationMs: (clipId: string, durationMs: number) => void;
  setClipVolume: (clipId: string, volume: number) => void;  // Set clip volume (0-1)
  removeClip: (clipId: string, reason?: string) => void;  // Soft delete with optional reason
  restoreClip: (clipId: string) => void;  // Restore a soft-deleted clip
  hardRemoveClip: (clipId: string) => void;  // Permanently remove a clip
  reorderClips: (clipOrder: string[]) => void;
  trimClip: (clipId: string, startMs: number, endMs: number) => void;
  getClipDuration: (clipId: string) => number;

  setClipStatus: (clipId: string, status: ClipTranscript["status"], error?: string) => void;
  setClipTranscript: (clipId: string, words: TranscriptWord[], text: string, durationMs?: number) => void;

  // Word operations
  deleteWord: (wordId: string) => void;
  deleteWords: (wordIds: string[]) => void;
  restoreWord: (wordId: string) => void;
  restoreAllWords: () => void;
  editWord: (wordId: string, newText: string) => void;
  editWords: (edits: { find: string; replace: string; matchCase?: boolean }[]) => number;

  // Transcribe a clip (calls API)
  transcribeClip: (clipId: string) => Promise<void>;

  // Smart cuts - auto remove filler words
  autoRemoveFillerWords: () => number;

  // Suggested cuts (user reviews before applying)
  suggestFillerWords: () => number;
  suggestSilenceGaps: () => number; // Gaps at start/end/between words
  applySuggestedCuts: () => number;
  rejectSuggestedCuts: () => void;
  getSuggestedWords: () => TranscriptWord[];
  hasSuggestedCuts: () => boolean;
  toggleSuggestedWord: (wordId: string) => void;

  // Get word at specific time (optionally filter by clipId for multi-clip accuracy)
  getWordAtTime: (timeMs: number, clipId?: string) => TranscriptWord | null;

  // Reset
  reset: () => void;
}

const generateWordId = () => Math.random().toString(36).substring(2, 11);

const useTranscriptStore = create<ITranscriptStore>()(
  persist(
    (set, get) => ({
      clips: {},
      clipOrder: [],
      gapThresholdMs: 200, // Balanced - cuts gaps >200ms without being too aggressive

      // Auto-magic processing state
      autoProcessEnabled: true, // Enabled by default!
      setAutoProcessEnabled: (enabled: boolean) => set({ autoProcessEnabled: enabled }),
      isProcessing: false,
      processingStatus: "",
      processingStartTime: null,
      processingStep: 0,
      _hasRunMagicProcessing: false,
      magicProcessingResult: null,
      clearMagicProcessingResult: () => set({ magicProcessingResult: null }),
      resetMagicProcessing: () => set({ _hasRunMagicProcessing: false, magicProcessingResult: null, emphasisPoints: [], textHook: null, processingStep: 0, processingStartTime: null }),

      // AI-detected emphasis points for zoom effects
      emphasisPoints: [],

      // Text hook for display (rendered directly in composition)
      textHook: null,
      getEmphasisPointsForRender: () => {
        const { emphasisPoints, clips } = get();
        const renderSegments = get().getRenderSegments();

        // Map emphasis points to output timeline positions
        const mappedPoints: Array<{ startMs: number; endMs: number; reason: string }> = [];

        for (const point of emphasisPoints) {
          const clip = clips[point.clipId];
          if (!clip) continue;

          // Find the word in the clip to get its timing
          const word = clip.words.find(w => w.id === point.wordId);
          if (!word) continue;

          // Find which render segment contains this word
          for (const segment of renderSegments) {
            if (segment.clipId !== point.clipId) continue;
            if (word.startMs >= segment.startMs && word.startMs < segment.endMs) {
              // Map to output timeline
              const outputStart = segment.offsetMs + (word.startMs - segment.startMs);
              const outputEnd = segment.offsetMs + (word.endMs - segment.startMs);

              // Zoom effect duration: start 200ms before word, end 500ms after
              mappedPoints.push({
                startMs: Math.max(0, outputStart - 200),
                endMs: outputEnd + 500,
                reason: point.reason,
              });
              break;
            }
          }
        }

        // Apply cooldown - minimum 3 seconds between zoom effects
        const cooldownMs = 3000;
        const filteredPoints: Array<{ startMs: number; endMs: number; reason: string }> = [];

        for (const point of mappedPoints) {
          const lastPoint = filteredPoints[filteredPoints.length - 1];
          if (!lastPoint || point.startMs >= lastPoint.endMs + cooldownMs) {
            filteredPoints.push(point);
          }
        }

        return filteredPoints;
      },

      // History state
      _history: [],
      _historyIndex: -1,
      _maxHistorySize: 50,

      // Push current state to history (call before making changes)
      _pushHistory: () => {
        const { clips, clipOrder, gapThresholdMs, _history, _historyIndex, _maxHistorySize } = get();

        // Create a deep copy of the current state
        const snapshot: HistorySnapshot = {
          clips: JSON.parse(JSON.stringify(clips)),
          clipOrder: [...clipOrder],
          gapThresholdMs,
        };

        // Remove any future history if we're not at the end (branching)
        const newHistory = _history.slice(0, _historyIndex + 1);

        // Add new snapshot
        newHistory.push(snapshot);

        // Limit history size
        if (newHistory.length > _maxHistorySize) {
          newHistory.shift();
        }

        set({
          _history: newHistory,
          _historyIndex: newHistory.length - 1,
        });
      },

      // Undo: restore previous state
      undo: () => {
        const { _history, _historyIndex, clips, clipOrder, gapThresholdMs } = get();

        if (_historyIndex < 0) return false;

        // IMPORTANT: Clear any pending auto-magic debounce timers
        // This prevents undo from re-triggering magic processing
        if (autoMagicDebounceTimer) {
          clearTimeout(autoMagicDebounceTimer);
          autoMagicDebounceTimer = null;
        }

        // If we're at the end and haven't saved current state, save it first
        if (_historyIndex === _history.length - 1) {
          // Save current state so we can redo back to it
          const currentSnapshot: HistorySnapshot = {
            clips: JSON.parse(JSON.stringify(clips)),
            clipOrder: [...clipOrder],
            gapThresholdMs,
          };

          const newHistory = [..._history, currentSnapshot];
          const snapshot = _history[_historyIndex];

          set({
            clips: JSON.parse(JSON.stringify(snapshot.clips)),
            clipOrder: [...snapshot.clipOrder],
            gapThresholdMs: snapshot.gapThresholdMs,
            _history: newHistory,
            _historyIndex: _historyIndex, // Stay at same index, which now points to "before" state
          });
        } else if (_historyIndex > 0) {
          // Normal undo - go back one step
          const snapshot = _history[_historyIndex - 1];
          set({
            clips: JSON.parse(JSON.stringify(snapshot.clips)),
            clipOrder: [...snapshot.clipOrder],
            gapThresholdMs: snapshot.gapThresholdMs,
            _historyIndex: _historyIndex - 1,
          });
        } else {
          // At index 0, restore that state
          const snapshot = _history[0];
          set({
            clips: JSON.parse(JSON.stringify(snapshot.clips)),
            clipOrder: [...snapshot.clipOrder],
            gapThresholdMs: snapshot.gapThresholdMs,
            _historyIndex: -1, // Before first recorded state
          });
        }

        return true;
      },

      // Redo: restore next state
      redo: () => {
        const { _history, _historyIndex } = get();

        if (_historyIndex >= _history.length - 1) return false;

        // Clear any pending auto-magic debounce timers
        if (autoMagicDebounceTimer) {
          clearTimeout(autoMagicDebounceTimer);
          autoMagicDebounceTimer = null;
        }

        const snapshot = _history[_historyIndex + 1];
        set({
          clips: JSON.parse(JSON.stringify(snapshot.clips)),
          clipOrder: [...snapshot.clipOrder],
          gapThresholdMs: snapshot.gapThresholdMs,
          _historyIndex: _historyIndex + 1,
        });

        return true;
      },

      canUndo: () => {
        const { _history, _historyIndex } = get();
        return _history.length > 0 && _historyIndex >= 0;
      },

      canRedo: () => {
        const { _history, _historyIndex } = get();
        return _historyIndex < _history.length - 1;
      },

      setGapThreshold: (ms: number) => {
        get()._pushHistory();
        set({ gapThresholdMs: Math.max(0, ms) });
      },

      getUnifiedTranscript: () => {
        const { clips, clipOrder } = get();
        const allWords: TranscriptWord[] = [];

        for (const clipId of clipOrder) {
          const clip = clips[clipId];
          if (clip && clip.status === "ready") {
            allWords.push(...clip.words);
          }
        }

        return allWords;
      },

      getActiveWords: () => {
        return get().getUnifiedTranscript().filter(w => !w.isDeleted);
      },

      getCutSegments: () => {
        const { clips, clipOrder, gapThresholdMs } = get();
        const segments: CutSegment[] = [];

        for (const clipId of clipOrder) {
          const clip = clips[clipId];
          if (!clip || clip.status !== "ready") continue;

          // Find deleted words and group them into segments
          let currentSegment: CutSegment | null = null;

          for (const word of clip.words) {
            if (word.isDeleted) {
              if (!currentSegment) {
                currentSegment = {
                  clipId,
                  startMs: word.startMs,
                  endMs: word.endMs,
                };
              } else {
                // Extend segment if words are close together (within gap threshold)
                if (word.startMs - currentSegment.endMs < gapThresholdMs) {
                  currentSegment.endMs = word.endMs;
                } else {
                  segments.push(currentSegment);
                  currentSegment = {
                    clipId,
                    startMs: word.startMs,
                    endMs: word.endMs,
                  };
                }
              }
            } else {
              if (currentSegment) {
                segments.push(currentSegment);
                currentSegment = null;
              }
            }
          }

          if (currentSegment) {
            segments.push(currentSegment);
          }
        }

        return segments;
      },

      getKeepSegments: () => {
        const { clips, clipOrder, gapThresholdMs } = get();
        const keepSegments: KeepSegment[] = [];

        for (const clipId of clipOrder) {
          const clip = clips[clipId];
          // Skip deleted clips, non-ready clips, or empty clips
          if (!clip || clip.isDeleted || clip.status !== "ready" || clip.words.length === 0) continue;

          // Get trim boundaries (relative to clip's first word)
          const trimStart = clip.trim?.startMs ?? 0;
          const trimEnd = clip.trim?.endMs ?? Infinity;

          // Get active (non-deleted) words for this clip
          const activeWords = clip.words.filter(w => !w.isDeleted);
          if (activeWords.length === 0) continue;

          // Get the clip's base time (first word start) for trim calculations
          const clipBaseTime = clip.words[0]?.startMs ?? 0;

          // Group consecutive active words into segments, respecting trim
          let currentSegment: KeepSegment | null = null;

          for (const word of activeWords) {
            // Calculate word position relative to clip start
            const wordRelativeStart = word.startMs - clipBaseTime;
            const wordRelativeEnd = word.endMs - clipBaseTime;

            // Skip words outside trim boundaries
            if (wordRelativeEnd <= trimStart || wordRelativeStart >= trimEnd) {
              continue;
            }

            // Clamp word times to trim boundaries
            const clampedStart = Math.max(word.startMs, clipBaseTime + trimStart);
            const clampedEnd = Math.min(word.endMs, clipBaseTime + trimEnd);

            if (!currentSegment) {
              currentSegment = {
                clipId,
                clipUrl: clip.url,
                startMs: clampedStart,
                endMs: clampedEnd,
                durationMs: clampedEnd - clampedStart,
              };
            } else {
              // If this word is close to the previous one (within gap threshold), extend
              // Otherwise start a new segment
              const gap = clampedStart - currentSegment.endMs;
              if (gap < gapThresholdMs) {
                currentSegment.endMs = clampedEnd;
                currentSegment.durationMs = currentSegment.endMs - currentSegment.startMs;
              } else {
                keepSegments.push(currentSegment);
                currentSegment = {
                  clipId,
                  clipUrl: clip.url,
                  startMs: clampedStart,
                  endMs: clampedEnd,
                  durationMs: clampedEnd - clampedStart,
                };
              }
            }
          }

          if (currentSegment) {
            keepSegments.push(currentSegment);
          }
        }

        // Minimum segment duration to avoid micro-cuts (professional technique)
        const minSegmentMs = 600; // At least 600ms per segment

        // Extend short segments by padding their boundaries
        for (const segment of keepSegments) {
          if (segment.durationMs < minSegmentMs) {
            const deficit = minSegmentMs - segment.durationMs;
            const padEach = deficit / 2;

            // Extend start earlier and end later (within reason)
            segment.startMs = Math.max(0, segment.startMs - padEach);
            segment.endMs = segment.endMs + padEach;
            segment.durationMs = segment.endMs - segment.startMs;
          }
        }

        return keepSegments;
      },

      getRenderSegments: () => {
        const { clips } = get();
        const keepSegments = get().getKeepSegments();
        const renderSegments: RenderSegment[] = [];
        let offsetMs = 0;

        for (const segment of keepSegments) {
          const clip = clips[segment.clipId];
          renderSegments.push({
            ...segment,
            offsetMs,
            clipType: clip?.clipType || "video_with_audio",
          });
          offsetMs += segment.durationMs;
        }

        return renderSegments;
      },

      getTotalDurationMs: () => {
        // Use audio segments when in audio+broll mode, otherwise use keep segments
        const isAudioBrollMode = get().hasAudioBrollScenario();
        const segments = isAudioBrollMode
          ? get().getAudioSegments()
          : get().getKeepSegments();
        return segments.reduce((total, seg) => total + seg.durationMs, 0);
      },

      getCaptionsForRender: () => {
        const { clips } = get();

        // Use audio segments when in audio+broll mode, otherwise use regular render segments
        const isAudioBrollMode = get().hasAudioBrollScenario();
        const renderSegments = isAudioBrollMode
          ? get().getAudioSegments()
          : get().getRenderSegments();

        const allWords: { text: string; startMs: number; endMs: number }[] = [];

        // Collect all words with mapped timestamps
        for (const segment of renderSegments) {
          const clip = clips[segment.clipId];
          if (!clip) continue;

          const segmentWords = clip.words.filter(
            (w) =>
              !w.isDeleted &&
              w.startMs >= segment.startMs &&
              w.endMs <= segment.endMs
          );

          for (const word of segmentWords) {
            const outputStartMs = segment.offsetMs + (word.startMs - segment.startMs);
            const outputEndMs = segment.offsetMs + (word.endMs - segment.startMs);

            allWords.push({
              text: word.text,
              startMs: outputStartMs,
              endMs: outputEndMs,
            });
          }
        }

        // Return individual words for punchy one-word-at-a-time captions
        return allWords;
      },

      // Get clips that are audio-only (m4a, mp3, etc. - have transcript but no video)
      getAudioOnlyClips: () => {
        const { clips, clipOrder } = get();
        return clipOrder
          .map(id => clips[id])
          .filter(clip => clip && !clip.isDeleted && clip.clipType === "audio_only" && clip.status === "ready");
      },

      // Get clips that are video-only (B-roll - have video but no transcript)
      getVideoOnlyClips: () => {
        const { clips, clipOrder } = get();
        return clipOrder
          .map(id => clips[id])
          .filter(clip => clip && !clip.isDeleted && clip.clipType === "video_only" && clip.status === "ready");
      },

      // Get clips that are regular video with audio (have both video and transcript)
      getVideoWithAudioClips: () => {
        const { clips, clipOrder } = get();
        return clipOrder
          .map(id => clips[id])
          .filter(clip => clip && !clip.isDeleted && clip.clipType === "video_with_audio" && clip.status === "ready" && clip.words.length > 0);
      },

      // Get clips that are background music (audio files with no speech)
      getBackgroundMusicClips: () => {
        const { clips, clipOrder } = get();
        return clipOrder
          .map(id => clips[id])
          .filter(clip => clip && !clip.isDeleted && clip.clipType === "background_music" && clip.status === "ready");
      },

      // Check if we have the PURE audio + B-roll scenario
      // True ONLY when:
      // - At least one audio_only clip exists
      // - At least one video_only (B-roll) clip exists
      // - NO video_with_audio clips exist (if regular video exists, use normal rendering)
      hasAudioBrollScenario: () => {
        const audioClips = get().getAudioOnlyClips();
        const videoOnlyClips = get().getVideoOnlyClips();
        const videoWithAudioClips = get().getVideoWithAudioClips();

        // Only true for PURE audio+broll mode: audio exists, B-roll exists, NO regular video
        const isPureAudioBroll = audioClips.length > 0 && videoOnlyClips.length > 0 && videoWithAudioClips.length === 0;

        if (isPureAudioBroll) {
          console.log(`[Audio+Broll] Pure audio+broll mode: ${audioClips.length} audio clips, ${videoOnlyClips.length} B-roll clips`);
        }

        return isPureAudioBroll;
      },

      // Get audio segments for rendering (from audio_only clips)
      getAudioSegments: () => {
        const { clips, clipOrder, gapThresholdMs } = get();
        const audioSegments: RenderSegment[] = [];
        let offsetMs = 0;

        for (const clipId of clipOrder) {
          const clip = clips[clipId];
          // Only process audio_only clips with words
          if (!clip || clip.isDeleted || clip.status !== "ready" ||
              clip.clipType !== "audio_only" || clip.words.length === 0) continue;

          const trimStart = clip.trim?.startMs ?? 0;
          const trimEnd = clip.trim?.endMs ?? Infinity;
          const clipBaseTime = clip.words[0]?.startMs ?? 0;
          const activeWords = clip.words.filter(w => !w.isDeleted);
          if (activeWords.length === 0) continue;

          // Group consecutive active words into segments (same logic as getKeepSegments)
          let currentSegment: RenderSegment | null = null;

          for (const word of activeWords) {
            const wordRelativeStart = word.startMs - clipBaseTime;
            const wordRelativeEnd = word.endMs - clipBaseTime;

            if (wordRelativeEnd <= trimStart || wordRelativeStart >= trimEnd) continue;

            const clampedStart = Math.max(word.startMs, clipBaseTime + trimStart);
            const clampedEnd = Math.min(word.endMs, clipBaseTime + trimEnd);

            if (!currentSegment) {
              currentSegment = {
                clipId,
                clipUrl: clip.url,
                startMs: clampedStart,
                endMs: clampedEnd,
                durationMs: clampedEnd - clampedStart,
                offsetMs,
                clipType: "audio_only",
              };
            } else {
              const gap = clampedStart - currentSegment.endMs;
              if (gap < gapThresholdMs) {
                currentSegment.endMs = clampedEnd;
                currentSegment.durationMs = currentSegment.endMs - currentSegment.startMs;
              } else {
                audioSegments.push(currentSegment);
                offsetMs += currentSegment.durationMs;
                currentSegment = {
                  clipId,
                  clipUrl: clip.url,
                  startMs: clampedStart,
                  endMs: clampedEnd,
                  durationMs: clampedEnd - clampedStart,
                  offsetMs,
                  clipType: "audio_only",
                };
              }
            }
          }

          if (currentSegment) {
            audioSegments.push(currentSegment);
            offsetMs += currentSegment.durationMs;
          }
        }

        return audioSegments;
      },

      // Get B-roll assignments - distributes video_only clips across audio segments
      // Logic: Split audio duration evenly among available B-roll clips, cycling if needed
      // Works for both pure audio+broll mode AND mixed mode (where audio_only clips need B-roll)
      getBrollAssignments: () => {
        const brollAssignments: BrollAssignment[] = [];
        const videoOnlyClips = get().getVideoOnlyClips();

        if (videoOnlyClips.length === 0) {
          return brollAssignments;
        }

        // Get audio segments - these need B-roll coverage
        const audioSegments = get().getAudioSegments();

        if (audioSegments.length === 0) {
          return brollAssignments;
        }

        // Calculate total audio duration that needs B-roll
        const totalAudioDuration = audioSegments.reduce((sum, seg) => sum + seg.durationMs, 0);

        if (totalAudioDuration === 0) {
          return brollAssignments;
        }

        // Distribute B-roll clips evenly across the audio duration
        // B-roll will LOOP to fill the entire audio duration
        const brollCount = videoOnlyClips.length;
        let currentTimelineMs = 0;
        let brollIndex = 0;

        // Keep distributing B-roll until we cover the entire audio duration
        while (currentTimelineMs < totalAudioDuration) {
          const brollClip = videoOnlyClips[brollIndex % brollCount];
          const brollDuration = brollClip.durationMs || 10000; // Default 10s if unknown

          const remainingDuration = totalAudioDuration - currentTimelineMs;
          const useDuration = Math.min(brollDuration, remainingDuration);

          brollAssignments.push({
            clipId: brollClip.clipId,
            clipUrl: brollClip.url,
            startMs: 0, // Start from beginning of B-roll clip
            endMs: useDuration,
            durationMs: useDuration,
            timelineStartMs: currentTimelineMs,
            timelineEndMs: currentTimelineMs + useDuration,
          });

          currentTimelineMs += useDuration;
          brollIndex++;
        }

        console.log(`[B-roll] Assigned ${brollAssignments.length} B-roll segments across ${totalAudioDuration}ms of audio (looped ${Math.ceil(brollIndex / brollCount)} times)`);
        return brollAssignments;
      },

      // Check if there are any audio_only clips that need B-roll (even in mixed mode)
      hasAudioClipsNeedingBroll: () => {
        const audioClips = get().getAudioOnlyClips();
        const videoOnlyClips = get().getVideoOnlyClips();
        return audioClips.length > 0 && videoOnlyClips.length > 0;
      },

      addClip: (clipId: string, url: string, clipType?: ClipType, durationMs?: number) => {
        const existingClip = get().clips[clipId];
        // Don't overwrite clips that are already transcribed (ready) or currently transcribing
        if (existingClip && (existingClip.status === "ready" || existingClip.status === "transcribing")) {
          console.log(`[addClip] Skipping - clip ${clipId} already exists with status: ${existingClip.status}`);
          return;
        }

        set((state) => ({
          clips: {
            ...state.clips,
            [clipId]: {
              clipId,
              url,
              status: "pending",
              words: [],
              text: "",
              clipType: clipType || "video_with_audio",
              durationMs: durationMs,
            },
          },
          clipOrder: state.clipOrder.includes(clipId)
            ? state.clipOrder
            : [...state.clipOrder, clipId],
        }));
      },

      setClipType: (clipId: string, clipType: ClipType) => {
        set((state) => {
          const clip = state.clips[clipId];
          if (!clip) return state;
          return {
            clips: {
              ...state.clips,
              [clipId]: {
                ...clip,
                clipType,
              },
            },
          };
        });
      },

      setClipDurationMs: (clipId: string, durationMs: number) => {
        set((state) => {
          const clip = state.clips[clipId];
          if (!clip) return state;
          return {
            clips: {
              ...state.clips,
              [clipId]: {
                ...clip,
                durationMs,
              },
            },
          };
        });
      },

      setClipVolume: (clipId: string, volume: number) => {
        set((state) => {
          const clip = state.clips[clipId];
          if (!clip) return state;
          return {
            clips: {
              ...state.clips,
              [clipId]: {
                ...clip,
                volume: Math.max(0, Math.min(1, volume)), // Clamp 0-1
              },
            },
          };
        });
      },

      // Soft delete a clip (marks as deleted but keeps in store for restore)
      removeClip: (clipId: string, reason?: string) => {
        get()._pushHistory();
        console.log(`[Transcript] Soft-deleting clip: ${clipId}, reason: ${reason}`);
        set((state) => {
          const clip = state.clips[clipId];
          if (!clip) {
            console.warn(`[Transcript] Clip not found for removal: ${clipId}`);
            return state;
          }

          console.log(`[Transcript] Clip ${clipId} marked as deleted (soft delete)`);
          return {
            clips: {
              ...state.clips,
              [clipId]: {
                ...clip,
                isDeleted: true,
                deleteReason: reason || "Removed by user",
              },
            },
          };
        });
      },

      // Restore a soft-deleted clip
      restoreClip: (clipId: string) => {
        get()._pushHistory();
        const clipOrder = get().clipOrder;
        const clipIndex = clipOrder.indexOf(clipId) + 1;

        set((state) => {
          const clip = state.clips[clipId];
          if (!clip) return state;

          return {
            clips: {
              ...state.clips,
              [clipId]: {
                ...clip,
                isDeleted: false,
                deleteReason: undefined,
              },
            },
          };
        });

        console.log(`[Transcript] Restored clip ${clipIndex} (${clipId})`);
        toast.success(`Clip ${clipIndex} restored`);
      },

      // Permanently remove a clip from the store
      hardRemoveClip: (clipId: string) => {
        get()._pushHistory();
        set((state) => {
          const { [clipId]: removed, ...remainingClips } = state.clips;
          return {
            clips: remainingClips,
            clipOrder: state.clipOrder.filter(id => id !== clipId),
          };
        });
      },

      reorderClips: (newClipOrder: string[]) => {
        get()._pushHistory();
        const { clips } = get();
        // Filter out invalid clipIds that don't exist
        const validOrder = newClipOrder.filter(id => clips[id] !== undefined);
        // Ensure no duplicates
        const uniqueOrder = [...new Set(validOrder)];
        set({ clipOrder: uniqueOrder });
      },

      trimClip: (clipId: string, startMs: number, endMs: number) => {
        get()._pushHistory();
        set((state) => {
          const clip = state.clips[clipId];
          if (!clip) return state;

          return {
            clips: {
              ...state.clips,
              [clipId]: {
                ...clip,
                trim: {
                  startMs: Math.max(0, startMs),
                  endMs: endMs,
                },
              },
            },
          };
        });
      },

      getClipDuration: (clipId: string) => {
        const { clips } = get();
        const clip = clips[clipId];
        if (!clip || clip.words.length === 0) return 0;

        const activeWords = clip.words.filter(w => !w.isDeleted);
        if (activeWords.length === 0) return 0;

        const firstWord = activeWords[0];
        const lastWord = activeWords[activeWords.length - 1];
        const fullDuration = lastWord.endMs - firstWord.startMs;

        // Apply trim if set
        if (clip.trim) {
          const trimStart = clip.trim.startMs || 0;
          const trimEnd = clip.trim.endMs || Infinity;
          return Math.min(trimEnd, fullDuration) - trimStart;
        }

        return fullDuration;
      },

      setClipStatus: (clipId: string, status: ClipTranscript["status"], error?: string) => {
        set((state) => ({
          clips: {
            ...state.clips,
            [clipId]: {
              ...state.clips[clipId],
              status,
              error,
            },
          },
        }));

        // Show error notification if transcription failed
        if (status === "error") {
          const clipIndex = get().clipOrder.indexOf(clipId) + 1;
          toast.error(`Clip ${clipIndex} failed to transcribe`);
        }
      },

      setClipTranscript: (clipId: string, words: TranscriptWord[], text: string, durationMs?: number) => {
        set((state) => {
          const clip = state.clips[clipId];
          if (!clip) return state;

          // Determine clip type based on transcription result
          // - Video with no speech → video_only (B-roll)
          // - Audio with no speech → background_music
          // - Audio with speech → audio_only (voice recording/podcast)
          // - Video with speech → video_with_audio (default)
          let clipType = clip.clipType || "video_with_audio";

          if (words.length === 0) {
            if (clip.clipType === "audio_only") {
              // Audio file with no speech = background music
              clipType = "background_music";
              console.log(`[Transcript] Clip ${clipId} marked as background_music - no speech detected in audio`);
            } else if (clip.clipType === "video_with_audio") {
              // Video with no speech = B-roll
              clipType = "video_only";
              console.log(`[Transcript] Clip ${clipId} marked as video_only (B-roll) - no speech detected`);
            }
          }

          return {
            clips: {
              ...state.clips,
              [clipId]: {
                ...clip,
                words,
                text,
                status: "ready",
                clipType,
                durationMs: durationMs || clip.durationMs,
              },
            },
          };
        });

        // Check if we should auto-process (waits for ALL clips to be ready)
        // This replaces the manual filler word suggestion with automatic processing
        setTimeout(() => {
          get()._checkAndAutoProcess();
        }, 500); // Small delay to allow UI to update
      },

      deleteWord: (wordId: string) => {
        get()._pushHistory();
        set((state) => {
          const newClips = { ...state.clips };

          for (const clipId of Object.keys(newClips)) {
            const clip = newClips[clipId];
            const wordIndex = clip.words.findIndex(w => w.id === wordId);

            if (wordIndex !== -1) {
              newClips[clipId] = {
                ...clip,
                words: clip.words.map(w =>
                  w.id === wordId ? { ...w, isDeleted: true } : w
                ),
              };
              break;
            }
          }

          return { clips: newClips };
        });
      },

      deleteWords: (wordIds: string[]) => {
        get()._pushHistory();
        const wordIdSet = new Set(wordIds);

        set((state) => {
          const newClips = { ...state.clips };

          for (const clipId of Object.keys(newClips)) {
            const clip = newClips[clipId];
            const hasWordsToDelete = clip.words.some(w => wordIdSet.has(w.id));

            if (hasWordsToDelete) {
              newClips[clipId] = {
                ...clip,
                words: clip.words.map(w =>
                  wordIdSet.has(w.id) ? { ...w, isDeleted: true } : w
                ),
              };
            }
          }

          return { clips: newClips };
        });
      },

      restoreWord: (wordId: string) => {
        get()._pushHistory();
        set((state) => {
          const newClips = { ...state.clips };

          for (const clipId of Object.keys(newClips)) {
            const clip = newClips[clipId];
            const wordIndex = clip.words.findIndex(w => w.id === wordId);

            if (wordIndex !== -1) {
              newClips[clipId] = {
                ...clip,
                words: clip.words.map(w =>
                  w.id === wordId ? { ...w, isDeleted: false } : w
                ),
              };
              break;
            }
          }

          return { clips: newClips };
        });
      },

      restoreAllWords: () => {
        get()._pushHistory();
        set((state) => {
          const newClips = { ...state.clips };

          for (const clipId of Object.keys(newClips)) {
            const clip = newClips[clipId];
            newClips[clipId] = {
              ...clip,
              words: clip.words.map(w => ({ ...w, isDeleted: false })),
            };
          }

          return { clips: newClips };
        });
      },

      editWord: (wordId: string, newText: string) => {
        get()._pushHistory();
        set((state) => {
          const newClips = { ...state.clips };

          for (const clipId of Object.keys(newClips)) {
            const clip = newClips[clipId];
            const wordIndex = clip.words.findIndex(w => w.id === wordId);

            if (wordIndex !== -1) {
              const newWords = [...clip.words];
              newWords[wordIndex] = { ...newWords[wordIndex], text: newText };
              newClips[clipId] = {
                ...clip,
                words: newWords,
                text: newWords.filter(w => !w.isDeleted).map(w => w.text).join(' '),
              };
              break;
            }
          }

          return { clips: newClips };
        });
      },

      editWords: (edits: { find: string; replace: string; matchCase?: boolean }[]) => {
        get()._pushHistory();
        let totalEdited = 0;

        set((state) => {
          const newClips = { ...state.clips };

          for (const clipId of Object.keys(newClips)) {
            const clip = newClips[clipId];
            let clipEdited = false;
            const newWords = clip.words.map(word => {
              let newText = word.text;

              for (const edit of edits) {
                const findText = edit.matchCase ? edit.find : edit.find.toLowerCase();
                const wordText = edit.matchCase ? newText : newText.toLowerCase();

                if (wordText === findText) {
                  newText = edit.replace;
                  totalEdited++;
                  clipEdited = true;
                }
              }

              return newText !== word.text ? { ...word, text: newText } : word;
            });

            if (clipEdited) {
              newClips[clipId] = {
                ...clip,
                words: newWords,
                text: newWords.filter(w => !w.isDeleted).map(w => w.text).join(' '),
              };
            }
          }

          return { clips: newClips };
        });

        return totalEdited;
      },

      autoRemoveFillerWords: () => {
        get()._pushHistory();
        // Comprehensive filler word patterns
        const fillerPatterns = [
          // Verbal fillers (hesitation sounds)
          /^u+[hm]+$/i,      // um, uh, uhm, umm, etc.
          /^a+[hm]+$/i,      // ah, ahm, etc.
          /^e+[hm]+$/i,      // eh, ehm, etc.
          /^m+[hm]+$/i,      // mm, mmm, mhm, etc.
          /^h+[m]+$/i,       // hm, hmm, etc.
          /^er+$/i,          // er, err, errr
          /^uh+$/i,          // uh, uhh, uhhh

          // Common discourse markers (when used as fillers)
          /^like$/i,         // "like" as filler
          /^basically$/i,    // "basically"
          /^actually$/i,     // "actually" (often filler)
          /^literally$/i,    // "literally"
          /^honestly$/i,     // "honestly"
          /^frankly$/i,      // "frankly"

          // Sentence starters used as fillers
          /^so+$/i,          // "so", "sooo" at start
          /^well$/i,         // "well" as filler
          /^now$/i,          // "now" as filler (context dependent)

          // Agreement/acknowledgment fillers
          /^right\??$/i,     // "right?" as filler
          /^okay$/i,         // "okay" as filler
          /^ok$/i,           // "ok"
          /^yeah$/i,         // "yeah" as filler
          /^yep$/i,          // "yep"
          /^sure$/i,         // "sure" as filler

          // Hedging phrases
          /^kind of$/i,      // "kind of"
          /^sort of$/i,      // "sort of"
          /^kinda$/i,        // "kinda"
          /^sorta$/i,        // "sorta"

          // Phrases (matched as sequences in context)
          /^i mean$/i,       // "I mean"
          /^you know$/i,     // "you know"
          /^you see$/i,      // "you see"
          /^i guess$/i,      // "I guess"
          /^i think$/i,      // "I think" (when used as filler)
        ];

        let removedCount = 0;

        set((state) => {
          const newClips = { ...state.clips };

          for (const clipId of Object.keys(newClips)) {
            const clip = newClips[clipId];
            newClips[clipId] = {
              ...clip,
              words: clip.words.map(w => {
                // Skip already deleted words
                if (w.isDeleted) return w;

                // Check if word matches any filler pattern
                const cleanWord = w.text.trim();
                const isFiller = fillerPatterns.some(pattern => pattern.test(cleanWord));

                if (isFiller) {
                  removedCount++;
                  return { ...w, isDeleted: true };
                }
                return w;
              }),
            };
          }

          return { clips: newClips };
        });

        return removedCount;
      },

      suggestFillerWords: () => {
        get()._pushHistory();
        // Comprehensive filler word patterns (same as autoRemoveFillerWords)
        const fillerPatterns = [
          // Verbal fillers (hesitation sounds)
          /^u+[hm]+$/i,      // um, uh, uhm, umm, etc.
          /^a+[hm]+$/i,      // ah, ahm, etc.
          /^e+[hm]+$/i,      // eh, ehm, etc.
          /^m+[hm]+$/i,      // mm, mmm, mhm, etc.
          /^h+[m]+$/i,       // hm, hmm, etc.
          /^er+$/i,          // er, err, errr
          /^uh+$/i,          // uh, uhh, uhhh

          // Common discourse markers (when used as fillers)
          /^like$/i,         // "like" as filler
          /^basically$/i,    // "basically"
          /^actually$/i,     // "actually" (often filler)
          /^literally$/i,    // "literally"
          /^honestly$/i,     // "honestly"
          /^frankly$/i,      // "frankly"

          // Sentence starters used as fillers
          /^so+$/i,          // "so", "sooo" at start
          /^well$/i,         // "well" as filler
          /^now$/i,          // "now" as filler (context dependent)

          // Agreement/acknowledgment fillers
          /^right\??$/i,     // "right?" as filler
          /^okay$/i,         // "okay" as filler
          /^ok$/i,           // "ok"
          /^yeah$/i,         // "yeah" as filler
          /^yep$/i,          // "yep"
          /^sure$/i,         // "sure" as filler

          // Hedging phrases
          /^kind of$/i,      // "kind of"
          /^sort of$/i,      // "sort of"
          /^kinda$/i,        // "kinda"
          /^sorta$/i,        // "sorta"

          // Phrases (matched as sequences in context)
          /^i mean$/i,       // "I mean"
          /^you know$/i,     // "you know"
          /^you see$/i,      // "you see"
          /^i guess$/i,      // "I guess"
          /^i think$/i,      // "I think" (when used as filler)
        ];

        let suggestedCount = 0;

        set((state) => {
          const newClips = { ...state.clips };

          for (const clipId of Object.keys(newClips)) {
            const clip = newClips[clipId];
            newClips[clipId] = {
              ...clip,
              words: clip.words.map(w => {
                // Skip already deleted or suggested words
                if (w.isDeleted || w.isSuggested) return w;

                // Check if word matches any filler pattern
                const cleanWord = w.text.trim();
                const isFiller = fillerPatterns.some(pattern => pattern.test(cleanWord));

                if (isFiller) {
                  suggestedCount++;
                  return { ...w, isSuggested: true };
                }
                return w;
              }),
            };
          }

          return { clips: newClips };
        });

        return suggestedCount;
      },

      suggestSilenceGaps: () => {
        // This would mark gaps/silence at the beginning and end of clips
        // For now, we're already handling this via getKeepSegments which only keeps spoken parts
        // This is a placeholder for more advanced gap detection
        return 0;
      },

      applySuggestedCuts: () => {
        get()._pushHistory();
        let appliedCount = 0;

        set((state) => {
          const newClips = { ...state.clips };

          for (const clipId of Object.keys(newClips)) {
            const clip = newClips[clipId];
            newClips[clipId] = {
              ...clip,
              words: clip.words.map(w => {
                if (w.isSuggested) {
                  appliedCount++;
                  return { ...w, isDeleted: true, isSuggested: false };
                }
                return w;
              }),
            };
          }

          return { clips: newClips };
        });

        return appliedCount;
      },

      rejectSuggestedCuts: () => {
        get()._pushHistory();
        set((state) => {
          const newClips = { ...state.clips };

          for (const clipId of Object.keys(newClips)) {
            const clip = newClips[clipId];
            newClips[clipId] = {
              ...clip,
              words: clip.words.map(w => {
                if (w.isSuggested) {
                  return { ...w, isSuggested: false };
                }
                return w;
              }),
            };
          }

          return { clips: newClips };
        });
      },

      getSuggestedWords: () => {
        return get().getUnifiedTranscript().filter(w => w.isSuggested);
      },

      hasSuggestedCuts: () => {
        return get().getUnifiedTranscript().some(w => w.isSuggested);
      },

      toggleSuggestedWord: (wordId: string) => {
        get()._pushHistory();
        set((state) => {
          const newClips = { ...state.clips };

          for (const clipId of Object.keys(newClips)) {
            const clip = newClips[clipId];
            const wordIndex = clip.words.findIndex(w => w.id === wordId);

            if (wordIndex !== -1) {
              newClips[clipId] = {
                ...clip,
                words: clip.words.map(w =>
                  w.id === wordId ? { ...w, isSuggested: !w.isSuggested } : w
                ),
              };
              break;
            }
          }

          return { clips: newClips };
        });
      },

      getWordAtTime: (timeMs: number, targetClipId?: string) => {
        const { clips, clipOrder } = get();

        // If a specific clipId is provided, only search that clip
        if (targetClipId) {
          const clip = clips[targetClipId];
          if (!clip || clip.status !== "ready") return null;

          for (const word of clip.words) {
            if (!word.isDeleted && timeMs >= word.startMs && timeMs <= word.endMs) {
              return word;
            }
          }
          return null;
        }

        // Otherwise search all clips in order
        for (const clipId of clipOrder) {
          const clip = clips[clipId];
          if (!clip || clip.status !== "ready") continue;

          for (const word of clip.words) {
            if (!word.isDeleted && timeMs >= word.startMs && timeMs <= word.endMs) {
              return word;
            }
          }
        }

        return null;
      },

      transcribeClip: async (clipId: string) => {
        const { clips, setClipStatus, setClipTranscript } = get();
        const clip = clips[clipId];

        if (!clip) {
          console.error(`Clip ${clipId} not found`);
          return;
        }

        // Don't re-transcribe clips that are already ready or currently transcribing
        if (clip.status === "ready") {
          console.log(`[transcribeClip] Skipping - clip ${clipId} already transcribed`);
          return;
        }
        if (clip.status === "transcribing") {
          console.log(`[transcribeClip] Skipping - clip ${clipId} already transcribing`);
          return;
        }

        setClipStatus(clipId, "transcribing");

        try {
          const response = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: clip.url, clipId }),
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || "Transcription failed");
          }

          const data = await response.json();

          // Transform captions to words with IDs
          const words: TranscriptWord[] = (data.captions || []).map((caption: any) => ({
            id: generateWordId(),
            text: caption.text,
            startMs: caption.startMs,
            endMs: caption.endMs,
            clipId,
            confidence: caption.confidence || 1,
            isDeleted: false,
          }));

          setClipTranscript(clipId, words, data.text || "", data.durationMs);

          // NOTE: We do NOT add video blocks to DesignCombo for MAIN video clips.
          // The transcript store IS the source of truth for video clips with speech.
          // HOWEVER: B-roll videos (no speech) DO get added to DesignCombo
          // so users can drag/trim them in the overlay tracks.
          if (words.length === 0 && clip.clipType === "video_with_audio") {
            // This is a B-roll video (video with no speech)
            // Add it to DesignCombo so it appears in overlay tracks and can be edited
            const brollDuration = data.durationMs || 10000;
            const brollId = `broll-${clipId}`;

            console.log(`[Transcript] Adding B-roll video to DesignCombo: ${brollId}, duration: ${brollDuration}ms`);

            dispatch(ADD_VIDEO, {
              payload: {
                id: brollId,
                details: {
                  src: clip.url,
                },
                display: {
                  from: 0, // Start at beginning - user can drag to reposition
                  to: Math.min(brollDuration, 10000), // Cap at 10s initially
                },
                metadata: {
                  isBroll: true, // Mark as B-roll so overlay tracks shows it
                  sourceClipId: clipId, // Reference back to transcript store clip
                },
              },
              options: {},
            });
          }
        } catch (error) {
          console.error(`Transcription failed for clip ${clipId}:`, error);
          setClipStatus(clipId, "error", String(error));
        }
      },

      // Check if all clips are transcribed and auto-process if enabled
      // Uses debouncing to wait for ALL clips to finish before running once
      _checkAndAutoProcess: () => {
        const { clips, clipOrder, autoProcessEnabled, isProcessing, _hasRunMagicProcessing, runMagicProcessing } = get();

        // Don't process if disabled, already processing, or already ran
        if (!autoProcessEnabled || isProcessing || _hasRunMagicProcessing) return;

        // Need at least one clip
        if (clipOrder.length === 0) return;

        // Check if ALL clips are ready (not pending or transcribing)
        const allReady = clipOrder.every(clipId => {
          const clip = clips[clipId];
          return clip && clip.status === "ready";
        });

        // Check if any clips are still transcribing
        const anyTranscribing = clipOrder.some(clipId => {
          const clip = clips[clipId];
          return clip && (clip.status === "pending" || clip.status === "transcribing");
        });

        // Clear any existing debounce timer
        if (autoMagicDebounceTimer) {
          clearTimeout(autoMagicDebounceTimer);
          autoMagicDebounceTimer = null;
        }

        // Only start debounce timer when all clips are ready
        if (allReady && !anyTranscribing) {
          console.log(`[Auto-Magic] All ${clipOrder.length} clips ready - waiting ${AUTO_MAGIC_DEBOUNCE_MS}ms to ensure no more clips incoming...`);

          // Debounce: wait a bit to make sure no more clips are coming
          autoMagicDebounceTimer = setTimeout(() => {
            // Double-check we're still ready and not processing
            const currentState = get();
            if (currentState.isProcessing) {
              console.log(`[Auto-Magic] Already processing, skipping`);
              return;
            }

            // Verify all clips are still ready (state might have changed)
            const stillAllReady = currentState.clipOrder.every(clipId => {
              const clip = currentState.clips[clipId];
              return clip && clip.status === "ready";
            });

            if (stillAllReady && currentState.clipOrder.length > 0) {
              console.log(`[Auto-Magic] Starting magic processing for ${currentState.clipOrder.length} clips...`);
              runMagicProcessing();
            }
          }, AUTO_MAGIC_DEBOUNCE_MS);
        }
      },

      // Run the full magic processing pipeline
      runMagicProcessing: async () => {
        const { clips, clipOrder, autoRemoveFillerWords, setGapThreshold, deleteWords, removeClip, reorderClips } = get();

        // Don't run if no clips
        if (clipOrder.length === 0) return { fillerCount: 0, aiCutsCount: 0, clipsRemoved: 0, timeSavedMs: 0 };

        // Set processing state and mark as having run (prevents running twice)
        set({
          isProcessing: true,
          processingStatus: "Starting magic processing...",
          processingStartTime: Date.now(),
          processingStep: 1,
          _hasRunMagicProcessing: true
        });

        const durationBefore = get().getTotalDurationMs();
        let aiCutsCount = 0;
        let clipsRemoved = 0;
        let aiSuggestedOrder: string[] | null = null;
        let aiReasoning = "";
        let aiTextHook = "";
        let removedClipIds: string[] = [];
        let wordCuts: Array<{ clipId: string; text: string; reason: string }> = [];

        try {
          // Step 1: Remove basic filler words (um, uh, like, etc.)
          set({ processingStatus: "Removing filler words...", processingStep: 1 });
          const fillerCount = autoRemoveFillerWords();
          console.log(`[Auto-Magic] Removed ${fillerCount} filler words`);

          // Step 2: AI-powered CROSS-TRANSCRIPT analysis
          // This is where the magic happens - AI sees ALL clips together and makes decisions about:
          // - Which entire clips to remove (bad takes)
          // - Which words/phrases to cut (duplicates, stammering, false starts)
          // - Optimal clip ordering for narrative flow
          set({ processingStatus: "AI analyzing clips...", processingStep: 2 });
          try {
            // Build clip data for AI analysis - EXCLUDE video_only clips (B-roll)
            // B-roll clips have no transcript and shouldn't be analyzed for content
            const clipData = clipOrder
              .filter(clipId => {
                const clip = clips[clipId];
                // Skip video_only clips - they're B-roll, not content to analyze
                return clip && clip.clipType !== "video_only";
              })
              .map((clipId, index) => {
                const clip = clips[clipId];
                const activeWords = clip.words.filter(w => !w.isDeleted);
                return {
                  clipId,
                  clipIndex: index + 1,
                  clipType: clip.clipType || "video_with_audio", // Include type for context
                  text: activeWords.map(w => w.text).join(" "),
                  words: activeWords.map(w => ({
                    id: w.id,
                    text: w.text,
                    startMs: w.startMs,
                    endMs: w.endMs,
                  })),
                };
              });

            // Call AI analysis API with all clips
            console.log("[Auto-Magic] Sending clips to AI for analysis:", clipData.map(c => ({
              clipId: c.clipId,
              clipIndex: c.clipIndex,
              wordCount: c.words.length,
              preview: c.text.substring(0, 100),
            })));

            const response = await fetch("/api/analyze-cuts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ clips: clipData }),
            });

            if (!response.ok) {
              const errorText = await response.text();
              console.error("[Auto-Magic] AI API error:", response.status, errorText);
              throw new Error(`AI analysis failed: ${response.status}`);
            }

            const result = await response.json();
            console.log("[Auto-Magic] AI analysis result:", {
              suggestedOrder: result.suggestedOrder,
              clipsToRemove: result.clipsToRemove,
              wordCutsCount: result.wordCuts?.length || 0,
              wordIdsToDelete: result.wordIdsToDelete?.length || 0,
              reasoning: result.reasoning,
            });

            if (result.success) {

              // Step 2a: Remove entire clips that AI identified as bad takes
              if (result.clipsToRemove && result.clipsToRemove.length > 0) {
                set({ processingStatus: `Removing ${result.clipsToRemove.length} duplicate/bad takes...` });
                for (const clipToRemove of result.clipsToRemove) {
                  // Handle both old format (string) and new format (object with clipId, clipIndex, reason)
                  const clipId = typeof clipToRemove === 'string' ? clipToRemove : clipToRemove.clipId;
                  const clipIndex = typeof clipToRemove === 'string'
                    ? clipOrder.indexOf(clipToRemove) + 1
                    : clipToRemove.clipIndex;
                  const reason = typeof clipToRemove === 'string'
                    ? 'Duplicate take'
                    : clipToRemove.reason;

                  // Verify the clip exists before removing
                  const clipToCheck = get().clips[clipId];
                  if (clipToCheck) {
                    // NEVER remove video_only clips - they're B-roll, not bad takes
                    if (clipToCheck.clipType === "video_only") {
                      console.log(`[Auto-Magic] Preserving B-roll clip ${clipIndex} - ${clipId} (video_only)`);
                      continue;
                    }
                    removeClip(clipId, `Clip ${clipIndex}: ${reason}`);
                    clipsRemoved++;
                    removedClipIds.push(clipId);
                    console.log(`[Auto-Magic] Removed clip ${clipIndex} - ${clipId}: ${reason}`);
                  }
                }
              }

              // Step 2b: Delete specific words (duplicates, stammering, false starts)
              if (result.wordIdsToDelete && result.wordIdsToDelete.length > 0) {
                set({ processingStatus: `Cutting ${result.wordIdsToDelete.length} duplicate/stammer words...` });
                deleteWords(result.wordIdsToDelete);
                aiCutsCount = result.wordIdsToDelete.length;
                console.log(`[Auto-Magic] AI cut ${aiCutsCount} words across ${result.wordCuts?.length || 0} sections`);
                // Capture word cuts for display
                if (result.wordCuts) {
                  wordCuts = result.wordCuts.map((cut: any) => ({
                    clipId: cut.clipId,
                    text: cut.text,
                    reason: cut.reason,
                  }));
                }
                result.wordCuts?.forEach((cut: any) => {
                  console.log(`  - Clip ${cut.clipId}: "${cut.text}" (${cut.reason})`);
                });
              }

              // Step 2c: Store AI's suggested order for later application
              if (result.suggestedOrder && result.suggestedOrder.length > 0) {
                aiSuggestedOrder = result.suggestedOrder;
                aiReasoning = result.reasoning || "AI-optimized narrative flow";
              }

              // Step 2d: Store emphasis points for zoom effects
              if (result.emphasisPoints && result.emphasisPoints.length > 0) {
                set({ processingStatus: `Found ${result.emphasisPoints.length} emphasis moments for zoom effects...` });
                const emphasisPointsMapped: EmphasisPoint[] = result.emphasisPoints.map((ep: any) => {
                  // Find the word to get its startMs
                  const clip = clips[ep.clipId];
                  const word = clip?.words.find((w: TranscriptWord) => w.id === ep.wordId);
                  return {
                    clipId: ep.clipId,
                    wordId: ep.wordId,
                    startMs: word?.startMs || 0,
                    reason: ep.reason,
                    text: ep.text,
                  };
                });
                set({ emphasisPoints: emphasisPointsMapped });
                console.log(`[Auto-Magic] Found ${emphasisPointsMapped.length} emphasis points for zoom effects`);
                emphasisPointsMapped.forEach((ep: EmphasisPoint) => {
                  console.log(`  - "${ep.text}" at ${ep.startMs}ms (${ep.reason})`);
                });
              }

              // Step 2e: Create text hook as a proper timeline item (editable/moveable)
              if (result.textHook && result.textHook.length > 0) {
                aiTextHook = result.textHook;
                set({ processingStatus: "Adding attention-grabbing text hook..." });

                // Get editor store for video dimensions
                try {
                  const editorStore = await getEditorStore();
                  const { size } = editorStore.getState();
                  const hookId = `text-hook-${nanoid(8)}`;

                  // Build payload for text hook - rounded pill design with big text
                  const hookWidth = Math.round(size.width * 0.75); // 75% width for bigger text
                  const hookPayload = {
                    id: hookId,
                    type: "text",
                    display: {
                      from: 0,
                      to: 4000, // 4 seconds
                    },
                    details: {
                      text: result.textHook,
                      fontSize: 56,
                      fontFamily: "Inter-Bold",
                      color: "#000000",
                      backgroundColor: "#ffffff",
                      textAlign: "center",
                      width: hookWidth,
                      height: 120, // Height for rounded pill with big text + vertical padding
                      top: Math.round(size.height * 0.06),
                      left: Math.round((size.width - hookWidth) / 2), // Center horizontally
                      wordWrap: "break-word",
                      borderWidth: 0,
                      borderColor: "#000000",
                      borderRadius: 40, // Full rounded pill corners
                      paddingTop: 28,
                      paddingBottom: 28,
                      paddingLeft: 24,
                      paddingRight: 24,
                      boxShadow: { color: "rgba(0,0,0,0.12)", x: 0, y: 4, blur: 16 },
                    },
                  };

                  // Dispatch to DesignCombo state manager
                  dispatch(ADD_TEXT, {
                    payload: hookPayload,
                    options: {},
                  });

                  // Store the hook text for AI agent reference
                  set({ textHook: result.textHook });
                  console.log(`[Auto-Magic] Created text hook as timeline item: "${result.textHook}" (id: ${hookId})`);
                } catch (hookError) {
                  console.warn("[Auto-Magic] Failed to create text hook as timeline item, using fallback:", hookError);
                  set({ textHook: result.textHook });
                }
              }
            }
          } catch (aiError) {
            console.warn("[Auto-Magic] AI analysis failed, continuing with basic processing:", aiError);
          }

          // Step 3: Optimize pacing (set gap threshold)
          set({ processingStatus: "Optimizing pacing...", processingStep: 3 });
          setGapThreshold(200); // Balanced - gaps >200ms get cut

          // Step 4: Transitions disabled - natural cuts with gap merging work better
          // The minimum segment duration (600ms) and gap threshold (200ms)
          // already create smooth, professional-feeling cuts without visible fades

          // Step 5: Apply AI-suggested clip order (if provided)
          if (aiSuggestedOrder && aiSuggestedOrder.length > 0) {
            set({ processingStatus: "Applying AI-optimized clip order..." });
            const currentClips = get().clips;
            const currentOrder = get().clipOrder;

            // Get the active (non-deleted) clips in AI's suggested order
            const validOrder = aiSuggestedOrder.filter(id =>
              currentClips[id] !== undefined && !currentClips[id].isDeleted
            );

            // IMPORTANT: Preserve any clips the AI didn't mention (append them at the end)
            // This prevents clips from disappearing if AI response is incomplete
            const mentionedClipIds = new Set([
              ...aiSuggestedOrder,
              ...removedClipIds, // clips AI explicitly removed
            ]);
            const unmentionedActiveClips = currentOrder.filter(id =>
              !mentionedClipIds.has(id) &&
              currentClips[id] !== undefined &&
              !currentClips[id].isDeleted
            );

            // IMPORTANT: Keep deleted clips in the order so they remain visible (grayed out) in UI
            // This allows users to see what was removed and restore them if needed
            const deletedClips = currentOrder.filter(id =>
              currentClips[id] !== undefined &&
              currentClips[id].isDeleted
            );

            if (unmentionedActiveClips.length > 0) {
              console.log(`[Auto-Magic] Warning: AI didn't mention ${unmentionedActiveClips.length} clips, preserving them:`, unmentionedActiveClips);
            }

            // Final order: active clips in AI order + unmentioned active clips + deleted clips (at end, visible but grayed out)
            const finalOrder = [...validOrder, ...unmentionedActiveClips, ...deletedClips];

            // Check if order actually changes
            const hasChanges = finalOrder.some((id, i) => id !== currentOrder[i]) || finalOrder.length !== currentOrder.length;

            if (hasChanges && finalOrder.length > 0) {
              reorderClips(finalOrder);
              console.log(`[Auto-Magic] Applied AI-suggested order: ${finalOrder.join(" → ")}`);
              console.log(`[Auto-Magic] Reasoning: ${aiReasoning}`);
            }
          }

          // Step 6: Enable visual effects for polished output
          set({ processingStatus: "Applying visual effects...", processingStep: 4 });
          try {
            const effectsStore = await getEffectsStore();
            const effects = effectsStore.getState();

            // Enable jump-cut smoothing (subtle 5% zoom on alternate segments)
            effects.setSegmentZoom({
              enabled: true,
              amount: 1.05,
              pattern: "alternate",
            });
            console.log("[Auto-Magic] Enabled jump-cut smoothing (5% zoom)");

            // Enable smooth fade transitions between segments
            effects.setTransitions({
              enabled: true,
              type: "fade",
              durationMs: 150, // Quick, subtle transitions
            });
            console.log("[Auto-Magic] Enabled fade transitions (150ms)");

            // Ensure caption animations are on with pop style
            effects.setCaptions({
              style: "animated",
              animationType: "pop",
              windowSize: 4,
            });
            console.log("[Auto-Magic] Enabled animated captions (pop style)");
          } catch (effectsError) {
            console.warn("[Auto-Magic] Failed to enable effects:", effectsError);
          }

          // Calculate results
          const durationAfter = get().getTotalDurationMs();
          const timeSavedMs = durationBefore - durationAfter;

          const totalWordsCut = fillerCount + aiCutsCount;
          const timeSavedSec = (timeSavedMs / 1000).toFixed(1);

          console.log(`[Auto-Magic] Complete! Clips removed: ${clipsRemoved}, Words cut: ${totalWordsCut}, Time saved: ${timeSavedSec}s`);

          // Store the full result for chat display
          const currentEmphasisPoints = get().emphasisPoints;
          const processingResult: MagicProcessingResult = {
            fillerCount,
            aiCutsCount,
            clipsRemoved,
            timeSavedMs,
            textHook: aiTextHook || undefined,
            removedClipIds: removedClipIds.length > 0 ? removedClipIds : undefined,
            suggestedOrder: aiSuggestedOrder || undefined,
            reasoning: aiReasoning || undefined,
            wordCuts: wordCuts.length > 0 ? wordCuts : undefined,
            emphasisPoints: currentEmphasisPoints.length > 0 ? currentEmphasisPoints : undefined,
            completedAt: Date.now(),
          };

          set({ isProcessing: false, processingStatus: "", processingStartTime: null, processingStep: 0, magicProcessingResult: processingResult });

          return {
            fillerCount,
            aiCutsCount,
            clipsRemoved,
            timeSavedMs,
          };
        } catch (error) {
          console.error("[Auto-Magic] Processing failed:", error);
          set({ isProcessing: false, processingStatus: "", processingStartTime: null, processingStep: 0 });
          toast.error("Magic processing encountered an error");
          return { fillerCount: 0, aiCutsCount: 0, clipsRemoved: 0, timeSavedMs: 0 };
        }
      },

      // Analyze clips and suggest optimal order based on content
      analyzeClipOrder: () => {
        const { clips, clipOrder } = get();

        if (clipOrder.length < 2) {
          return { suggestedOrder: clipOrder, confidence: 1, reasoning: "Only one clip" };
        }

        // Score each clip for intro/middle/outro characteristics
        const clipScores: Array<{
          clipId: string;
          introScore: number;
          outroScore: number;
          orderHints: number[];
          text: string;
        }> = [];

        // Intro patterns (higher score = more likely intro)
        const introPatterns = [
          /\b(hey|hi|hello|welcome)\b/i,
          /\b(today|in this video)\b/i,
          /\b(going to|gonna) (show|teach|explain|talk)/i,
          /\b(let's|let me) (start|begin|get into|dive)/i,
          /\bintro(duction)?\b/i,
        ];

        // Outro patterns (higher score = more likely outro)
        const outroPatterns = [
          /\b(thanks? (for|you)|thank you)\b/i,
          /\b(that's (it|all)|so that's)\b/i,
          /\b(in (conclusion|summary)|to (sum|wrap) up)\b/i,
          /\b(see you|catch you|bye|goodbye)\b/i,
          /\b(subscribe|like|comment|share)\b/i,
          /\b(hope (this|you)|hopefully)\b/i,
        ];

        // Order keywords with their position hints
        const orderKeywords: Array<{ pattern: RegExp; position: number }> = [
          { pattern: /\b(first(ly)?|to start|starting with)\b/i, position: 1 },
          { pattern: /\b(second(ly)?|next|moving on)\b/i, position: 2 },
          { pattern: /\b(third(ly)?|then|after that)\b/i, position: 3 },
          { pattern: /\b(fourth(ly)?|additionally)\b/i, position: 4 },
          { pattern: /\b(fifth(ly)?|also)\b/i, position: 5 },
          { pattern: /\b(finally|lastly|last(ly)?|in the end)\b/i, position: 100 },
        ];

        for (const clipId of clipOrder) {
          const clip = clips[clipId];
          const text = clip?.text || clip?.words.filter(w => !w.isDeleted).map(w => w.text).join(" ") || "";
          const textLower = text.toLowerCase();

          let introScore = 0;
          let outroScore = 0;
          const orderHints: number[] = [];

          // Check intro patterns
          for (const pattern of introPatterns) {
            if (pattern.test(textLower)) introScore++;
          }

          // Check outro patterns
          for (const pattern of outroPatterns) {
            if (pattern.test(textLower)) outroScore++;
          }

          // Check order keywords
          for (const { pattern, position } of orderKeywords) {
            if (pattern.test(textLower)) orderHints.push(position);
          }

          clipScores.push({ clipId, introScore, outroScore, orderHints, text: text.substring(0, 100) });
        }

        // Determine suggested order
        const suggestedOrder: string[] = [];
        const remaining = [...clipScores];

        // Find best intro clip
        const introClip = remaining.reduce((best, clip) =>
          clip.introScore > best.introScore ? clip : best
        , remaining[0]);

        if (introClip.introScore > 0) {
          suggestedOrder.push(introClip.clipId);
          remaining.splice(remaining.findIndex(c => c.clipId === introClip.clipId), 1);
        }

        // Find best outro clip
        const outroClip = remaining.reduce((best, clip) =>
          clip.outroScore > best.outroScore ? clip : best
        , remaining[0]);

        // Sort remaining by order hints, then by original position
        const middle = remaining
          .filter(c => c.clipId !== outroClip?.clipId || outroClip.outroScore === 0)
          .sort((a, b) => {
            const aHint = Math.min(...a.orderHints, 50);
            const bHint = Math.min(...b.orderHints, 50);
            if (aHint !== bHint) return aHint - bHint;
            return clipOrder.indexOf(a.clipId) - clipOrder.indexOf(b.clipId);
          });

        suggestedOrder.push(...middle.map(c => c.clipId));

        // Add outro at the end if found
        if (outroClip && outroClip.outroScore > 0 && !suggestedOrder.includes(outroClip.clipId)) {
          suggestedOrder.push(outroClip.clipId);
        }

        // Ensure all clips are included
        for (const clipId of clipOrder) {
          if (!suggestedOrder.includes(clipId)) {
            suggestedOrder.push(clipId);
          }
        }

        // Calculate confidence
        const hasChanges = suggestedOrder.some((id, i) => id !== clipOrder[i]);
        const totalHints = clipScores.reduce((sum, c) => sum + c.introScore + c.outroScore + c.orderHints.length, 0);
        const confidence = hasChanges ? Math.min(0.9, 0.3 + (totalHints * 0.1)) : 0.5;

        const reasoning = hasChanges
          ? `Detected ${introClip.introScore > 0 ? "intro content" : ""}${outroClip.outroScore > 0 ? ", outro content" : ""}, and ordering keywords`
          : "No clear ordering signals detected - keeping original order";

        return { suggestedOrder, confidence, reasoning };
      },

      // Apply the smart order analysis
      applySmartOrder: () => {
        const { analyzeClipOrder, reorderClips, clipOrder } = get();
        const { suggestedOrder, confidence, reasoning } = analyzeClipOrder();

        // Only apply if we have reasonable confidence and there are changes
        const hasChanges = suggestedOrder.some((id, i) => id !== clipOrder[i]);

        if (hasChanges && confidence >= 0.4) {
          reorderClips(suggestedOrder);
          toast.success(`Reordered ${clipOrder.length} clips based on content`, {
            description: reasoning,
            duration: 5000,
          });
          console.log(`[Smart Order] Applied new order with ${(confidence * 100).toFixed(0)}% confidence: ${reasoning}`);
        } else {
          console.log(`[Smart Order] Kept original order: ${reasoning}`);
        }
      },

      reset: () => {
        // Clear debounce timer if any
        if (autoMagicDebounceTimer) {
          clearTimeout(autoMagicDebounceTimer);
          autoMagicDebounceTimer = null;
        }
        set({ clips: {}, clipOrder: [], isProcessing: false, processingStatus: "", _hasRunMagicProcessing: false });
      },
    }),
    {
      name: "transcript-store",
      partialize: (state) => ({
        clips: state.clips,
        clipOrder: state.clipOrder,
        gapThresholdMs: state.gapThresholdMs,
      }),
    }
  )
);

export default useTranscriptStore;
