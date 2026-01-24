import { create } from "zustand";
import { persist } from "zustand/middleware";
// NOTE: We no longer dispatch to DesignCombo for video clips.
// The transcript store IS the source of truth.

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

interface ITranscriptStore {
  // Per-clip transcripts
  clips: Record<string, ClipTranscript>;

  // Clip order for unified view
  clipOrder: string[];

  // Gap threshold for segment merging (ms)
  gapThresholdMs: number;
  setGapThreshold: (ms: number) => void;

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
  removeClip: (clipId: string) => void;
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
          if (!clip || clip.status !== "ready" || clip.words.length === 0) continue;

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

      removeClip: (clipId: string) => {
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
        // Common filler words to remove
        const fillerPatterns = [
          /^u+[hm]+$/i,      // um, uh, uhm, umm, etc.
          /^a+[hm]+$/i,      // ah, ahm, etc.
          /^e+[hm]+$/i,      // eh, ehm, etc.
          /^m+[hm]+$/i,      // mm, mmm, mhm, etc.
          /^h+[m]+$/i,       // hm, hmm, etc.
          /^like$/i,         // "like" as filler
          /^you know$/i,     // "you know"
          /^basically$/i,    // "basically"
          /^actually$/i,     // "actually" (often filler)
          /^so+$/i,          // "so", "sooo" at start
          /^right\??$/i,     // "right?" as filler
          /^okay$/i,         // "okay" as filler
          /^yeah$/i,         // "yeah" as filler
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
        // Common filler words to suggest for removal
        const fillerPatterns = [
          /^u+[hm]+$/i,      // um, uh, uhm, umm, etc.
          /^a+[hm]+$/i,      // ah, ahm, etc.
          /^e+[hm]+$/i,      // eh, ehm, etc.
          /^m+[hm]+$/i,      // mm, mmm, mhm, etc.
          /^h+[m]+$/i,       // hm, hmm, etc.
          /^like$/i,         // "like" as filler
          /^you know$/i,     // "you know"
          /^basically$/i,    // "basically"
          /^actually$/i,     // "actually" (often filler)
          /^so+$/i,          // "so", "sooo" at start
          /^right\??$/i,     // "right?" as filler
          /^okay$/i,         // "okay" as filler
          /^yeah$/i,         // "yeah" as filler
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

      reset: () => {
        set({ clips: {}, clipOrder: [] });
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
