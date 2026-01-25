import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";
import { dispatch } from "@designcombo/events";
import { ADD_TEXT } from "@designcombo/state";
import { nanoid } from "nanoid";
// NOTE: We no longer dispatch to DesignCombo for video clips.
// The transcript store IS the source of truth.

// Import effects store for smooth cuts (lazy to avoid circular deps)
const getEffectsStore = () => import("./use-effects-store").then(m => m.default);

// Get editor store for video dimensions (lazy to avoid circular deps)
const getEditorStore = () => import("./use-store").then(m => m.default);

// Debounce timer for auto-magic processing (wait for all clips to finish)
let autoMagicDebounceTimer: NodeJS.Timeout | null = null;
const AUTO_MAGIC_DEBOUNCE_MS = 2000; // Wait 2 seconds after last transcription

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
}

// History snapshot for undo/redo
interface HistorySnapshot {
  clips: Record<string, ClipTranscript>;
  clipOrder: string[];
  gapThresholdMs: number;
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
  _hasRunMagicProcessing: boolean; // Prevents running twice
  magicProcessingResult: MagicProcessingResult | null; // Latest result for chat display
  clearMagicProcessingResult: () => void;

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

  // Actions
  addClip: (clipId: string, url: string) => void;
  removeClip: (clipId: string, reason?: string) => void;  // Soft delete with optional reason
  restoreClip: (clipId: string) => void;  // Restore a soft-deleted clip
  hardRemoveClip: (clipId: string) => void;  // Permanently remove a clip
  reorderClips: (clipOrder: string[]) => void;
  trimClip: (clipId: string, startMs: number, endMs: number) => void;
  getClipDuration: (clipId: string) => number;

  setClipStatus: (clipId: string, status: ClipTranscript["status"], error?: string) => void;
  setClipTranscript: (clipId: string, words: TranscriptWord[], text: string) => void;

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
      gapThresholdMs: 500,

      // Auto-magic processing state
      autoProcessEnabled: true, // Enabled by default!
      setAutoProcessEnabled: (enabled: boolean) => set({ autoProcessEnabled: enabled }),
      isProcessing: false,
      processingStatus: "",
      _hasRunMagicProcessing: false,
      magicProcessingResult: null,
      clearMagicProcessingResult: () => set({ magicProcessingResult: null }),
      resetMagicProcessing: () => set({ _hasRunMagicProcessing: false, magicProcessingResult: null }),

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

        return keepSegments;
      },

      getRenderSegments: () => {
        const keepSegments = get().getKeepSegments();
        const renderSegments: RenderSegment[] = [];
        let offsetMs = 0;

        for (const segment of keepSegments) {
          renderSegments.push({
            ...segment,
            offsetMs,
          });
          offsetMs += segment.durationMs;
        }

        return renderSegments;
      },

      getTotalDurationMs: () => {
        const keepSegments = get().getKeepSegments();
        return keepSegments.reduce((total, seg) => total + seg.durationMs, 0);
      },

      getCaptionsForRender: () => {
        const { clips } = get();
        const renderSegments = get().getRenderSegments();
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

      addClip: (clipId: string, url: string) => {
        set((state) => ({
          clips: {
            ...state.clips,
            [clipId]: {
              clipId,
              url,
              status: "pending",
              words: [],
              text: "",
            },
          },
          clipOrder: state.clipOrder.includes(clipId)
            ? state.clipOrder
            : [...state.clipOrder, clipId],
        }));
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

      setClipTranscript: (clipId: string, words: TranscriptWord[], text: string) => {
        set((state) => ({
          clips: {
            ...state.clips,
            [clipId]: {
              ...state.clips[clipId],
              words,
              text,
              status: "ready",
            },
          },
        }));

        // Show success notification
        const clipIndex = get().clipOrder.indexOf(clipId) + 1;
        const durationMs = words.length > 0 ? words[words.length - 1].endMs - words[0].startMs : 0;
        const durationSec = Math.round(durationMs / 1000);
        toast.success(`Clip ${clipIndex} ready!`);

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

          setClipTranscript(clipId, words, data.text || "");

          // NOTE: We do NOT add video blocks to DesignCombo anymore.
          // The transcript store IS the source of truth for video clips.
          // The composition renders directly from getRenderSegments().
          // The timeline UI should render clips from this store, not DesignCombo.
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
        set({ isProcessing: true, processingStatus: "Starting magic processing...", _hasRunMagicProcessing: true });

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
          set({ processingStatus: "Removing filler words..." });
          const fillerCount = autoRemoveFillerWords();
          console.log(`[Auto-Magic] Removed ${fillerCount} filler words`);

          // Step 2: AI-powered CROSS-TRANSCRIPT analysis
          // This is where the magic happens - AI sees ALL clips together and makes decisions about:
          // - Which entire clips to remove (bad takes)
          // - Which words/phrases to cut (duplicates, stammering, false starts)
          // - Optimal clip ordering for narrative flow
          set({ processingStatus: "AI analyzing all clips for cross-transcript optimization..." });
          try {
            // Build clip data for AI analysis - include ALL clips
            const clipData = clipOrder.map((clipId, index) => {
              const clip = clips[clipId];
              const activeWords = clip.words.filter(w => !w.isDeleted);
              return {
                clipId,
                clipIndex: index + 1,
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
                for (const clipIdToRemove of result.clipsToRemove) {
                  // Verify the clip exists before removing
                  if (get().clips[clipIdToRemove]) {
                    // Get clip index for a nice reason message
                    const clipIndex = clipOrder.indexOf(clipIdToRemove) + 1;
                    const reason = `AI detected: duplicate take (better version exists in another clip)`;
                    removeClip(clipIdToRemove, reason);
                    clipsRemoved++;
                    removedClipIds.push(clipIdToRemove);
                    console.log(`[Auto-Magic] Removed clip ${clipIndex} - ${clipIdToRemove} (bad take)`);
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

              // Step 2d: Add text hook overlay if AI generated one
              if (result.textHook && result.textHook.length > 0) {
                aiTextHook = result.textHook; // Capture for result
                set({ processingStatus: "Adding attention-grabbing text hook..." });
                try {
                  const editorStore = await getEditorStore();
                  const { size } = editorStore.getState();
                  const hookId = nanoid();

                  // Text hook appears in the first 4 seconds
                  const hookDurationMs = 4000;

                  const hookPayload = {
                    id: hookId,
                    type: "text",
                    display: { from: 0, to: hookDurationMs },
                    details: {
                      text: result.textHook,
                      fontSize: 64,
                      fontFamily: "Inter-Bold",
                      color: "#ffffff",
                      backgroundColor: "transparent",
                      textAlign: "center",
                      width: size.width * 0.9,
                      height: 200,
                      top: size.height * 0.08,
                      left: (size.width - size.width * 0.9) / 2,
                      wordWrap: "break-word",
                      borderWidth: 0,
                      borderColor: "#000000",
                      boxShadow: { color: "#000000", x: 3, y: 3, blur: 12 },
                      textTransform: "uppercase",
                    },
                  };

                  dispatch(ADD_TEXT, { payload: hookPayload, options: {} });
                  console.log(`[Auto-Magic] Added text hook: "${result.textHook}"`);
                } catch (hookError) {
                  console.warn("[Auto-Magic] Could not add text hook:", hookError);
                }
              }
            }
          } catch (aiError) {
            console.warn("[Auto-Magic] AI analysis failed, continuing with basic processing:", aiError);
          }

          // Step 3: Optimize pacing (set gap threshold)
          set({ processingStatus: "Optimizing pacing..." });
          setGapThreshold(500); // Standard pacing

          // Step 4: Smooth jump cuts - DISABLED by default
          // The alternating zoom was causing "shakiness" perception
          // Users can enable this manually via the AI chat if desired
          // set({ processingStatus: "Enabling smooth cuts..." });
          // try {
          //   const effectsStore = await getEffectsStore();
          //   effectsStore.getState().setSegmentZoom({
          //     enabled: true,
          //     amount: 1.05, // 5% zoom
          //     pattern: "alternate",
          //   });
          //   console.log(`[Auto-Magic] Enabled smooth jump cuts`);
          // } catch (e) {
          //   console.warn("[Auto-Magic] Could not enable smooth cuts:", e);
          // }

          // Step 5: Apply AI-suggested clip order (if provided)
          if (aiSuggestedOrder && aiSuggestedOrder.length > 0) {
            set({ processingStatus: "Applying AI-optimized clip order..." });
            // Filter to only include clips that still exist (some may have been removed)
            const currentClips = get().clips;
            const validOrder = aiSuggestedOrder.filter(id => currentClips[id] !== undefined);

            // Check if order actually changes
            const currentOrder = get().clipOrder;
            const hasChanges = validOrder.some((id, i) => id !== currentOrder[i]);

            if (hasChanges && validOrder.length > 0) {
              reorderClips(validOrder);
              console.log(`[Auto-Magic] Applied AI-suggested order: ${validOrder.join(" → ")}`);
              console.log(`[Auto-Magic] Reasoning: ${aiReasoning}`);
            }
          }

          // Calculate results
          const durationAfter = get().getTotalDurationMs();
          const timeSavedMs = durationBefore - durationAfter;

          // Show success toast with comprehensive summary
          const totalWordsCut = fillerCount + aiCutsCount;
          const timeSavedSec = (timeSavedMs / 1000).toFixed(1);

          if (totalWordsCut > 0 || clipsRemoved > 0 || timeSavedMs > 0) {
            const parts: string[] = [];
            if (clipsRemoved > 0) parts.push(`${clipsRemoved} bad takes removed`);
            if (aiCutsCount > 0) parts.push(`${aiCutsCount} AI-detected cuts`);
            if (fillerCount > 0) parts.push(`${fillerCount} filler words`);

            toast.success(
              `✨ Magic complete! ${parts.join(", ")}. Saved ${timeSavedSec}s`,
              { duration: 6000 }
            );
          } else {
            toast.success("✨ Magic complete! Your video looks clean already.", { duration: 3000 });
          }

          console.log(`[Auto-Magic] Complete! Clips removed: ${clipsRemoved}, Words cut: ${totalWordsCut}, Time saved: ${timeSavedSec}s`);

          // Store the full result for chat display
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
            completedAt: Date.now(),
          };

          set({ isProcessing: false, processingStatus: "", magicProcessingResult: processingResult });

          return {
            fillerCount,
            aiCutsCount,
            clipsRemoved,
            timeSavedMs,
          };
        } catch (error) {
          console.error("[Auto-Magic] Processing failed:", error);
          set({ isProcessing: false, processingStatus: "" });
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
