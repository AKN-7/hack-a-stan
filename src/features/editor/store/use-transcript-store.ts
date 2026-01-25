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

// Get upload store to check for pending uploads (lazy to avoid circular deps)
const getUploadStore = () => import("./use-upload-store").then(m => m.default);

// Debounce timer for auto-magic processing (wait for all clips to finish)
let autoMagicDebounceTimer: NodeJS.Timeout | null = null;
const AUTO_MAGIC_DEBOUNCE_MS = 2000; // Wait 2s after last transcription to ensure all uploads/transcriptions complete

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
  deletedByTrim?: boolean; // True if deleted by timeline trimming (vs manual deletion)
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
  colorIndex?: number;  // Color index assigned at creation, persists through reordering

  // Voice Enhancement (noise reduction + loudness normalization)
  enhancedUrl?: string;  // URL of the enhanced audio after processing
  enhancementStatus?: "idle" | "pending" | "processing" | "completed" | "failed";
  enhancementJobId?: string;  // CleanVoice job ID for polling
  enhancementError?: string;  // Error message if enhancement failed
  useEnhancedAudio?: boolean;  // Toggle: true = use enhanced, false = use original (defaults to true when enhanced)
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
  volume?: number;  // Volume level 0-1 (for rendering)
}

// Unified segment for rendering (with accumulated offset)
export interface RenderSegment extends KeepSegment {
  offsetMs: number; // Where this segment starts in the final timeline
  clipType?: ClipType; // Type of the source clip
  volume?: number; // Volume level 0-1 (inherited from KeepSegment but explicitly typed)
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
  sentences: Record<string, Sentence>;
  sentenceOrder: string[];
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

// Sentence for sentence-level ordering and semantic analysis
export interface Sentence {
  id: string;                    // e.g., "clip1-sent0"
  clipId: string;                // Parent clip
  wordIds: string[];             // Words in this sentence
  text: string;                  // Full sentence text
  startMs: number;               // Start time within clip
  endMs: number;                 // End time within clip
  isDeleted?: boolean;           // Soft delete for undo
  deleteReason?: string;         // Why sentence was deleted (semantic dedup)
}

// Transcript section - a draggable unit containing sentences from potentially different clips
// Derived from sentenceOrder by grouping contiguous sentences from the same source clip
export interface TranscriptSection {
  id: string;                    // e.g., "section-0"
  sourceClipId: string;          // The source clip these sentences came from
  sentenceIds: string[];         // Sentences in this section (in playback order)
  colorIndex: number;            // For visual identification
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

// Live processing event for real-time UI feedback
export type ProcessingEventType =
  | "pass_start"      // Started a processing pass
  | "pass_complete"   // Completed a processing pass
  | "clip_removed"    // Removed a duplicate clip
  | "words_cut"       // Cut words from script
  | "sentence_cut"    // Cut sentence (semantic dedup)
  | "order_found"     // Found optimal clip/sentence order
  | "hook_generated"  // Generated text hook
  | "emphasis_found"; // Found emphasis points

export interface ProcessingEvent {
  id: string;
  type: ProcessingEventType;
  message: string;
  detail?: string;
  timestamp: number;
}

// Transition between clips
export type TransitionType = "none" | "fade" | "slide" | "wipe" | "flip" | "clockWipe" | "star" | "circle" | "rectangle";
export type TransitionDirection = "from-left" | "from-right" | "from-top" | "from-bottom";

export interface ClipTransition {
  id: string;                    // Unique ID for this transition
  fromClipId: string;            // Clip before the transition
  toClipId: string;              // Clip after the transition
  type: TransitionType;          // Type of transition effect
  direction?: TransitionDirection; // Direction for slide/wipe
  durationMs: number;            // Duration of transition in ms
}

interface ITranscriptStore {
  // Per-clip transcripts
  clips: Record<string, ClipTranscript>;

  // Clip order for unified view
  clipOrder: string[];

  // Sentence-level data for fine-grained ordering
  sentences: Record<string, Sentence>;
  sentenceOrder: string[];  // Can interleave sentences from different clips

  // Sentence operations
  parseSentencesFromClip: (clipId: string) => Sentence[];
  getAllSentences: () => Sentence[];
  setSentenceOrder: (order: string[]) => void;
  deleteSentence: (sentenceId: string, reason?: string) => void;
  restoreSentence: (sentenceId: string) => void;

  // Transcript sections - derived from sentenceOrder for UI display
  getTranscriptSections: () => TranscriptSection[];
  reorderSections: (newSectionOrder: string[]) => void;

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

  // Live processing events for real-time UI feedback
  processingEvents: ProcessingEvent[];
  addProcessingEvent: (type: ProcessingEventType, message: string, detail?: string) => void;
  clearProcessingEvents: () => void;

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

  // Internal: Get render segments based on sentence ordering
  _getSentenceBasedRenderSegments: () => RenderSegment[];

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

  // Voice Enhancement actions
  startEnhancement: (clipId: string) => Promise<void>;
  startEnhancementForAllClips: () => Promise<number>; // Returns number of clips started
  pollEnhancementStatus: (clipId: string, jobId: string) => Promise<void>;
  setEnhancementStatus: (clipId: string, status: ClipTranscript["enhancementStatus"], data?: Partial<ClipTranscript>) => void;
  toggleEnhancedAudio: (clipId: string) => void;

  // Reset
  reset: () => void;

  // Clip transitions (between clips on timeline)
  clipTransitions: Record<string, ClipTransition>; // keyed by transition ID
  getTransitionBetween: (fromClipId: string, toClipId: string) => ClipTransition | null;
  setTransition: (fromClipId: string, toClipId: string, type: TransitionType, durationMs?: number, direction?: TransitionDirection) => string;
  updateTransition: (transitionId: string, updates: Partial<Omit<ClipTransition, "id" | "fromClipId" | "toClipId">>) => void;
  removeTransition: (transitionId: string) => void;
  getTransitionsForRender: () => Array<{ fromClipId: string; toClipId: string; type: TransitionType; direction?: TransitionDirection; durationMs: number }>;
}

const generateWordId = () => Math.random().toString(36).substring(2, 11);

const useTranscriptStore = create<ITranscriptStore>()(
  persist(
    (set, get) => ({
      clips: {},
      clipOrder: [],
      clipTransitions: {},

      // Sentence-level data for fine-grained ordering
      sentences: {},
      sentenceOrder: [],

      // Parse sentences from a clip's transcription
      parseSentencesFromClip: (clipId: string): Sentence[] => {
        const clip = get().clips[clipId];
        if (!clip?.words || clip.words.length === 0) return [];

        const sentences: Sentence[] = [];
        let currentWords: TranscriptWord[] = [];
        let sentenceIndex = 0;

        const words = clip.words.filter(w => !w.isDeleted);

        for (let i = 0; i < words.length; i++) {
          const word = words[i];
          currentWords.push(word);

          // Sentence boundary: punctuation (. ! ?) or long pause (>800ms to next word)
          const endsWithPunctuation = /[.!?]$/.test(word.text);
          const nextWord = words[i + 1];
          const hasLongPause = nextWord && (nextWord.startMs - word.endMs > 800);
          const isLastWord = i === words.length - 1;

          // Minimum sentence length: don't split on pause alone if fewer than 4 words
          // This prevents fragments like "I'm" from becoming their own sentence
          const hasMinimumLength = currentWords.length >= 4;
          const shouldSplit = isLastWord ||
            (endsWithPunctuation && hasMinimumLength) ||
            (hasLongPause && hasMinimumLength);

          if (shouldSplit) {
            if (currentWords.length > 0) {
              sentences.push({
                id: `${clipId}-sent${sentenceIndex}`,
                clipId,
                wordIds: currentWords.map(w => w.id),
                text: currentWords.map(w => w.text).join(' '),
                startMs: currentWords[0].startMs,
                endMs: currentWords[currentWords.length - 1].endMs,
              });
              sentenceIndex++;
              currentWords = [];
            }
          }
        }

        return sentences;
      },

      // Get all sentences (non-deleted)
      getAllSentences: (): Sentence[] => {
        const { sentences, sentenceOrder } = get();
        return sentenceOrder
          .map(id => sentences[id])
          .filter(s => s && !s.isDeleted);
      },

      // Set sentence order (for AI reordering)
      setSentenceOrder: (order: string[]) => {
        set({ sentenceOrder: order });
      },

      // Soft delete a sentence (for semantic dedup)
      deleteSentence: (sentenceId: string, reason?: string) => {
        get()._pushHistory();
        set((state) => {
          const sentence = state.sentences[sentenceId];
          if (!sentence) return state;

          return {
            sentences: {
              ...state.sentences,
              [sentenceId]: {
                ...sentence,
                isDeleted: true,
                deleteReason: reason,
              },
            },
          };
        });
      },

      // Restore a deleted sentence
      restoreSentence: (sentenceId: string) => {
        get()._pushHistory();
        set((state) => {
          const sentence = state.sentences[sentenceId];
          if (!sentence) return state;

          return {
            sentences: {
              ...state.sentences,
              [sentenceId]: {
                ...sentence,
                isDeleted: false,
                deleteReason: undefined,
              },
            },
          };
        });
      },

      // Get transcript sections - groups contiguous sentences from same source clip
      // This is what the UI displays as "clips" - draggable units
      // IMPORTANT: Section IDs are stable (based on first sentence ID) for drag-and-drop to work
      getTranscriptSections: (): TranscriptSection[] => {
        const { sentences, sentenceOrder, clips } = get();

        if (sentenceOrder.length === 0) {
          return [];
        }

        const sections: TranscriptSection[] = [];
        let currentSection: TranscriptSection | null = null;

        for (const sentenceId of sentenceOrder) {
          const sentence = sentences[sentenceId];
          if (!sentence) continue;

          // Skip deleted sentences
          if (sentence.isDeleted) continue;

          const clip = clips[sentence.clipId];
          if (!clip || clip.isDeleted) continue;

          // Start new section if different source clip or first sentence
          if (!currentSection || currentSection.sourceClipId !== sentence.clipId) {
            if (currentSection && currentSection.sentenceIds.length > 0) {
              sections.push(currentSection);
            }
            // Use first sentence ID as section ID for stability (drag-and-drop needs stable IDs)
            currentSection = {
              id: `clip-${sentenceId}`,
              sourceClipId: sentence.clipId,
              sentenceIds: [sentenceId],
              colorIndex: clip.colorIndex ?? 0,
            };
          } else {
            // Same source clip - add to current section
            currentSection.sentenceIds.push(sentenceId);
          }
        }

        // Don't forget the last section
        if (currentSection && currentSection.sentenceIds.length > 0) {
          sections.push(currentSection);
        }

        return sections;
      },

      // Reorder sections - rebuilds sentenceOrder AND clipOrder based on new section order
      reorderSections: (newSectionOrder: string[]) => {
        get()._pushHistory();

        const sections = get().getTranscriptSections();
        const sectionMap = new Map(sections.map(s => [s.id, s]));

        // Build new sentence order from section order
        const newSentenceOrder: string[] = [];
        // Also track clip order derived from sections
        const seenClipIds = new Set<string>();
        const derivedClipOrder: string[] = [];

        for (const sectionId of newSectionOrder) {
          const section = sectionMap.get(sectionId);
          if (section) {
            newSentenceOrder.push(...section.sentenceIds);
            // Track the source clip for this section
            if (!seenClipIds.has(section.sourceClipId)) {
              seenClipIds.add(section.sourceClipId);
              derivedClipOrder.push(section.sourceClipId);
            }
          }
        }

        // Add any deleted sentences at the end (so they can be restored)
        const { sentences, sentenceOrder, clips, clipOrder } = get();
        for (const sentenceId of sentenceOrder) {
          const sentence = sentences[sentenceId];
          if (sentence?.isDeleted && !newSentenceOrder.includes(sentenceId)) {
            newSentenceOrder.push(sentenceId);
          }
        }

        // Add any clips not in sections (deleted clips, B-roll, background music, etc.)
        const otherClips = clipOrder.filter(id => {
          const clip = clips[id];
          return clip && !seenClipIds.has(id);
        });
        const newClipOrder = [...derivedClipOrder, ...otherClips];

        set({ sentenceOrder: newSentenceOrder, clipOrder: newClipOrder });
      },

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
      resetMagicProcessing: () => set({ _hasRunMagicProcessing: false, magicProcessingResult: null, emphasisPoints: [], textHook: null, processingStep: 0, processingStartTime: null, processingEvents: [], sentences: {}, sentenceOrder: [] }),

      // Live processing events
      processingEvents: [],
      addProcessingEvent: (type: ProcessingEventType, message: string, detail?: string) => {
        const event: ProcessingEvent = {
          id: nanoid(8),
          type,
          message,
          detail,
          timestamp: Date.now(),
        };
        set((state) => ({
          processingEvents: [...state.processingEvents, event],
        }));
      },
      clearProcessingEvents: () => set({ processingEvents: [] }),

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
        const { clips, clipOrder, sentences, sentenceOrder, gapThresholdMs, _history, _historyIndex, _maxHistorySize } = get();

        // Create a deep copy of the current state
        const snapshot: HistorySnapshot = {
          clips: JSON.parse(JSON.stringify(clips)),
          clipOrder: [...clipOrder],
          sentences: JSON.parse(JSON.stringify(sentences)),
          sentenceOrder: [...sentenceOrder],
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
        const { _history, _historyIndex, clips, clipOrder, sentences, sentenceOrder, gapThresholdMs } = get();

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
            sentences: JSON.parse(JSON.stringify(sentences)),
            sentenceOrder: [...sentenceOrder],
            gapThresholdMs,
          };

          const newHistory = [..._history, currentSnapshot];
          const snapshot = _history[_historyIndex];

          set({
            clips: JSON.parse(JSON.stringify(snapshot.clips)),
            clipOrder: [...snapshot.clipOrder],
            sentences: JSON.parse(JSON.stringify(snapshot.sentences || {})),
            sentenceOrder: [...(snapshot.sentenceOrder || [])],
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
            sentences: JSON.parse(JSON.stringify(snapshot.sentences || {})),
            sentenceOrder: [...(snapshot.sentenceOrder || [])],
            gapThresholdMs: snapshot.gapThresholdMs,
            _historyIndex: _historyIndex - 1,
          });
        } else {
          // At index 0, restore that state
          const snapshot = _history[0];
          set({
            clips: JSON.parse(JSON.stringify(snapshot.clips)),
            clipOrder: [...snapshot.clipOrder],
            sentences: JSON.parse(JSON.stringify(snapshot.sentences || {})),
            sentenceOrder: [...(snapshot.sentenceOrder || [])],
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
          sentences: JSON.parse(JSON.stringify(snapshot.sentences || {})),
          sentenceOrder: [...(snapshot.sentenceOrder || [])],
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

          // Determine which URL to use (enhanced vs original)
          const shouldUseEnhanced =
            clip.useEnhancedAudio !== false &&
            clip.enhancedUrl &&
            clip.enhancementStatus === "completed";
          const clipUrl = (shouldUseEnhanced && clip.enhancedUrl) ? clip.enhancedUrl : clip.url;
          const clipVolume = clip.volume;

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
                clipUrl,
                startMs: clampedStart,
                endMs: clampedEnd,
                durationMs: clampedEnd - clampedStart,
                volume: clipVolume,
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
                  clipUrl,
                  startMs: clampedStart,
                  endMs: clampedEnd,
                  durationMs: clampedEnd - clampedStart,
                  volume: clipVolume,
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

            // Get the clip's last word to limit end padding
            const clip = clips[segment.clipId];
            const clipWords = clip?.words || [];
            const lastWordEndMs = clipWords.length > 0
              ? Math.max(...clipWords.map(w => w.endMs))
              : segment.endMs;

            // Extend start earlier and end later, but don't extend past clip content
            segment.startMs = Math.max(0, segment.startMs - padEach);
            segment.endMs = Math.min(lastWordEndMs, segment.endMs + padEach);
            segment.durationMs = segment.endMs - segment.startMs;
          }
        }

        return keepSegments;
      },

      // Internal: Get render segments based on sentence ordering
      _getSentenceBasedRenderSegments: (): RenderSegment[] => {
        const { clips, sentences, sentenceOrder, gapThresholdMs } = get();
        const renderSegments: RenderSegment[] = [];
        let offsetMs = 0;

        for (const sentenceId of sentenceOrder) {
          const sentence = sentences[sentenceId];
          if (!sentence || sentence.isDeleted) continue;

          const clip = clips[sentence.clipId];
          if (!clip || clip.isDeleted || clip.status !== "ready") continue;

          // Get non-deleted words in this sentence
          const sentenceWords = sentence.wordIds
            .map(wid => clip.words.find(w => w.id === wid))
            .filter((w): w is TranscriptWord => w !== undefined && !w.isDeleted);

          if (sentenceWords.length === 0) continue;

          // Determine URL to use (enhanced vs original)
          const shouldUseEnhanced =
            clip.useEnhancedAudio !== false &&
            clip.enhancedUrl &&
            clip.enhancementStatus === "completed";
          const clipUrl: string = shouldUseEnhanced ? clip.enhancedUrl! : clip.url;
          const clipVolume = clip.volume;

          // Build segments from words (group consecutive words within gap threshold)
          let currentSegment: RenderSegment | null = null;

          for (const word of sentenceWords) {
            if (!currentSegment) {
              currentSegment = {
                clipId: sentence.clipId,
                clipUrl,
                startMs: word.startMs,
                endMs: word.endMs,
                durationMs: word.endMs - word.startMs,
                offsetMs,
                clipType: clip.clipType || "video_with_audio",
                volume: clipVolume,
              };
            } else {
              const gap = word.startMs - currentSegment.endMs;
              if (gap < gapThresholdMs) {
                // Extend current segment
                currentSegment.endMs = word.endMs;
                currentSegment.durationMs = currentSegment.endMs - currentSegment.startMs;
              } else {
                // Push current and start new
                renderSegments.push(currentSegment);
                offsetMs += currentSegment.durationMs;
                currentSegment = {
                  clipId: sentence.clipId,
                  clipUrl,
                  startMs: word.startMs,
                  endMs: word.endMs,
                  durationMs: word.endMs - word.startMs,
                  offsetMs,
                  clipType: clip.clipType || "video_with_audio",
                  volume: clipVolume,
                };
              }
            }
          }

          if (currentSegment) {
            // Apply minimum segment duration
            const minSegmentMs = 600;
            if (currentSegment.durationMs < minSegmentMs) {
              const deficit = minSegmentMs - currentSegment.durationMs;
              const padEach = deficit / 2;

              // Get the clip's last word to limit end padding
              const lastWordEndMs = clip.words.length > 0
                ? Math.max(...clip.words.map(w => w.endMs))
                : currentSegment.endMs;

              currentSegment.startMs = Math.max(0, currentSegment.startMs - padEach);
              currentSegment.endMs = Math.min(lastWordEndMs, currentSegment.endMs + padEach);
              currentSegment.durationMs = currentSegment.endMs - currentSegment.startMs;
            }
            renderSegments.push(currentSegment);
            offsetMs += currentSegment.durationMs;
          }
        }

        return renderSegments;
      },

      getRenderSegments: () => {
        const { clips, sentenceOrder } = get();

        // If we have sentence-level ordering, use it for fine-grained control
        if (sentenceOrder.length > 0) {
          return get()._getSentenceBasedRenderSegments();
        }

        // Fall back to clip-based rendering
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
        // Use audio segments when in audio+broll mode, otherwise use render segments
        // IMPORTANT: Must use getRenderSegments (not getKeepSegments) to match what's actually rendered
        // When sentenceOrder exists, getRenderSegments uses _getSentenceBasedRenderSegments
        const isAudioBrollMode = get().hasAudioBrollScenario();
        const segments = isAudioBrollMode
          ? get().getAudioSegments()
          : get().getRenderSegments();
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

          // Determine which URL to use (enhanced vs original)
          const shouldUseEnhanced =
            clip.useEnhancedAudio !== false &&
            clip.enhancedUrl &&
            clip.enhancementStatus === "completed";
          const clipUrl = (shouldUseEnhanced && clip.enhancedUrl) ? clip.enhancedUrl : clip.url;
          const clipVolume = clip.volume;

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
                clipUrl,
                startMs: clampedStart,
                endMs: clampedEnd,
                durationMs: clampedEnd - clampedStart,
                offsetMs,
                clipType: "audio_only",
                volume: clipVolume,
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
                  clipUrl,
                  startMs: clampedStart,
                  endMs: clampedEnd,
                  durationMs: clampedEnd - clampedStart,
                  offsetMs,
                  clipType: "audio_only",
                  volume: clipVolume,
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

        set((state) => {
          // Assign colorIndex based on total clips ever added (persists through reordering)
          const colorIndex = Object.keys(state.clips).length % 6;
          return {
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
                colorIndex,
              },
            },
            clipOrder: state.clipOrder.includes(clipId)
              ? state.clipOrder
              : [...state.clipOrder, clipId],
          };
        });
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

      // Voice Enhancement - Start enhancement for a clip
      startEnhancement: async (clipId: string) => {
        const clip = get().clips[clipId];
        if (!clip?.url) {
          console.error("[Enhancement] Clip not found or has no URL:", clipId);
          return;
        }

        // Skip if already enhanced or currently processing
        if (clip.enhancementStatus === "processing" || clip.enhancementStatus === "completed") {
          console.log("[Enhancement] Clip already enhanced or processing:", clipId);
          return;
        }

        console.log("[Enhancement] Starting enhancement for clip:", clipId);

        // Set status to pending
        set((state) => ({
          clips: {
            ...state.clips,
            [clipId]: { ...state.clips[clipId], enhancementStatus: "pending" },
          },
        }));

        try {
          // Start the enhancement job
          const res = await fetch("/api/enhance-audio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clipId, sourceUrl: clip.url }),
          });

          if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || "Failed to start enhancement");
          }

          const { jobId } = await res.json();

          console.log("[Enhancement] Job started:", jobId);

          // Update status to processing
          set((state) => ({
            clips: {
              ...state.clips,
              [clipId]: {
                ...state.clips[clipId],
                enhancementJobId: jobId,
                enhancementStatus: "processing",
              },
            },
          }));

          // Start polling for status
          get().pollEnhancementStatus(clipId, jobId);
        } catch (error) {
          console.error("[Enhancement] Error starting job:", error);
          set((state) => ({
            clips: {
              ...state.clips,
              [clipId]: {
                ...state.clips[clipId],
                enhancementStatus: "failed",
                enhancementError: error instanceof Error ? error.message : "Unknown error",
              },
            },
          }));
        }
      },

      // Voice Enhancement - Start enhancement for ALL clips (non-blocking)
      startEnhancementForAllClips: async () => {
        const { clips, clipOrder } = get();
        let startedCount = 0;

        // Filter clips that have audio and haven't been enhanced yet
        const clipsToEnhance = clipOrder.filter((clipId) => {
          const clip = clips[clipId];
          if (!clip || !clip.url) return false;
          // Skip if already processing, completed, or pending
          if (clip.enhancementStatus === "processing" ||
              clip.enhancementStatus === "completed" ||
              clip.enhancementStatus === "pending") {
            return false;
          }
          // Only enhance clips with audio (not video_only)
          if (clip.clipType === "video_only") return false;
          return true;
        });

        if (clipsToEnhance.length === 0) {
          console.log("[Enhancement] No clips need enhancement");
          return 0;
        }

        console.log(`[Enhancement] Starting enhancement for ${clipsToEnhance.length} clip(s)`);

        // Start enhancement for each clip (fire and forget - polling handles the rest)
        for (const clipId of clipsToEnhance) {
          try {
            // Don't await - let them run in parallel
            get().startEnhancement(clipId);
            startedCount++;
          } catch (error) {
            console.error(`[Enhancement] Failed to start for clip ${clipId}:`, error);
          }
        }

        if (startedCount > 0) {
          toast.success(`Enhancing audio for ${startedCount} clip(s)...`, {
            description: "Noise reduction & loudness normalization in progress",
          });
        }

        return startedCount;
      },

      // Voice Enhancement - Poll for enhancement status
      pollEnhancementStatus: async (clipId: string, jobId: string) => {
        const MAX_POLLS = 60; // Max 3 minutes (60 * 3s)
        let pollCount = 0;

        const poll = async () => {
          pollCount++;

          // Check if clip still exists and is still processing
          const clip = get().clips[clipId];
          if (!clip || clip.enhancementStatus !== "processing") {
            console.log("[Enhancement] Stopping poll - clip removed or status changed");
            return;
          }

          try {
            const res = await fetch(`/api/enhance-audio/${jobId}?clipId=${clipId}`);
            if (!res.ok) {
              throw new Error("Failed to check enhancement status");
            }

            const data = await res.json();
            console.log("[Enhancement] Poll response:", { clipId, jobId, pollCount, data });

            if (data.status === "completed") {
              if (data.enhancedUrl) {
                console.log("[Enhancement] Completed with URL:", clipId, data.enhancedUrl.substring(0, 80));
                set((state) => ({
                  clips: {
                    ...state.clips,
                    [clipId]: {
                      ...state.clips[clipId],
                      enhancedUrl: data.enhancedUrl,
                      enhancementStatus: "completed",
                      useEnhancedAudio: true, // Default to using enhanced audio
                    },
                  },
                }));
                toast.success("Audio enhanced successfully!");
              } else {
                // Status is completed but no URL - treat as failure
                console.error("[Enhancement] Completed but no URL returned:", data);
                set((state) => ({
                  clips: {
                    ...state.clips,
                    [clipId]: {
                      ...state.clips[clipId],
                      enhancementStatus: "failed",
                      enhancementError: "Enhancement completed but no URL received",
                    },
                  },
                }));
                toast.error("Enhancement completed but no URL received");
              }
              return;
            }

            if (data.status === "failed") {
              console.error("[Enhancement] Failed:", data.error);
              set((state) => ({
                clips: {
                  ...state.clips,
                  [clipId]: {
                    ...state.clips[clipId],
                    enhancementStatus: "failed",
                    enhancementError: data.error || "Enhancement failed",
                  },
                },
              }));
              toast.error("Audio enhancement failed");
              return;
            }

            // Still processing - continue polling if under limit
            if (pollCount < MAX_POLLS) {
              setTimeout(poll, 3000); // Poll every 3 seconds
            } else {
              console.error("[Enhancement] Timeout after", MAX_POLLS * 3, "seconds");
              set((state) => ({
                clips: {
                  ...state.clips,
                  [clipId]: {
                    ...state.clips[clipId],
                    enhancementStatus: "failed",
                    enhancementError: "Enhancement timed out",
                  },
                },
              }));
              toast.error("Audio enhancement timed out");
            }
          } catch (error) {
            console.error("[Enhancement] Poll error:", error);
            // Retry on transient errors
            if (pollCount < MAX_POLLS) {
              setTimeout(poll, 5000); // Longer delay on error
            } else {
              // Max retries reached even with errors - set as failed
              set((state) => ({
                clips: {
                  ...state.clips,
                  [clipId]: {
                    ...state.clips[clipId],
                    enhancementStatus: "failed",
                    enhancementError: "Enhancement check failed repeatedly",
                  },
                },
              }));
              toast.error("Could not verify enhancement status");
            }
          }
        };

        // Start polling
        setTimeout(poll, 2000); // Initial delay before first poll
      },

      // Voice Enhancement - Set enhancement status directly
      setEnhancementStatus: (clipId: string, status: ClipTranscript["enhancementStatus"], data?: Partial<ClipTranscript>) => {
        set((state) => {
          const clip = state.clips[clipId];
          if (!clip) return state;
          return {
            clips: {
              ...state.clips,
              [clipId]: {
                ...clip,
                enhancementStatus: status,
                ...data,
              },
            },
          };
        });
      },

      // Voice Enhancement - Toggle between original and enhanced audio
      toggleEnhancedAudio: (clipId: string) => {
        set((state) => {
          const clip = state.clips[clipId];
          if (!clip || clip.enhancementStatus !== "completed" || !clip.enhancedUrl) {
            return state;
          }
          return {
            clips: {
              ...state.clips,
              [clipId]: {
                ...clip,
                useEnhancedAudio: !clip.useEnhancedAudio,
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
        const { clips, sentenceOrder, sentences } = get();
        // Filter out invalid clipIds that don't exist
        const validOrder = newClipOrder.filter(id => clips[id] !== undefined);
        // Ensure no duplicates
        const uniqueOrder = [...new Set(validOrder)];

        // IMPORTANT: Also update sentenceOrder to match the new clip order
        // This ensures the video rendering reflects the reordered clips
        if (sentenceOrder.length > 0) {
          // Group sentences by their source clip
          const sentencesByClip = new Map<string, string[]>();
          for (const sentenceId of sentenceOrder) {
            const sentence = sentences[sentenceId];
            if (!sentence) continue;
            const clipSentences = sentencesByClip.get(sentence.clipId) || [];
            clipSentences.push(sentenceId);
            sentencesByClip.set(sentence.clipId, clipSentences);
          }

          // Rebuild sentenceOrder based on new clip order
          const newSentenceOrder: string[] = [];
          for (const clipId of uniqueOrder) {
            const clipSentences = sentencesByClip.get(clipId) || [];
            newSentenceOrder.push(...clipSentences);
          }

          // Add any sentences from clips not in the new order (edge case)
          for (const sentenceId of sentenceOrder) {
            if (!newSentenceOrder.includes(sentenceId)) {
              newSentenceOrder.push(sentenceId);
            }
          }

          set({ clipOrder: uniqueOrder, sentenceOrder: newSentenceOrder });
        } else {
          set({ clipOrder: uniqueOrder });
        }
      },

      trimClip: (clipId: string, startMs: number, endMs: number) => {
        get()._pushHistory();
        set((state) => {
          const clip = state.clips[clipId];
          if (!clip) return state;

          // Calculate clip base time (first word's start time)
          const clipBaseTime = clip.words[0]?.startMs ?? 0;
          const trimStartAbs = clipBaseTime + Math.max(0, startMs);
          const trimEndAbs = clipBaseTime + endMs;

          // Mark words outside trim as deleted, words inside as not deleted
          // This syncs timeline trimming with transcript word deletion
          const updatedWords = clip.words.map(word => {
            const wordInTrim = word.startMs < trimEndAbs && word.endMs > trimStartAbs;

            // If word is in trim range, restore it (unless it was manually deleted)
            // If word is outside trim range, mark it as deleted by trim
            if (wordInTrim) {
              // Only restore if it was deleted by trimming (not manual deletion)
              if (word.isDeleted && word.deletedByTrim) {
                return { ...word, isDeleted: false, deletedByTrim: false };
              }
              return word;
            } else {
              // Mark as deleted by trim
              if (!word.isDeleted) {
                return { ...word, isDeleted: true, deletedByTrim: true };
              }
              return word;
            }
          });

          return {
            clips: {
              ...state.clips,
              [clipId]: {
                ...clip,
                words: updatedWords,
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
        // ONLY pure hesitation sounds - these are always noise, never meaningful
        // Everything else is context-dependent and handled by AI in Pass 3
        const fillerPatterns = [
          /^u+[hm]+$/i,      // um, uh, uhm, umm, etc.
          /^a+h+$/i,         // ah, ahh, etc.
          /^e+h+$/i,         // eh, ehh, etc.
          /^m+[hm]+$/i,      // mm, mmm, mhm, etc.
          /^h+[m]+$/i,       // hm, hmm, etc.
          /^er+$/i,          // er, err, errr
          /^uh+$/i,          // uh, uhh, uhhh
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
          autoMagicDebounceTimer = setTimeout(async () => {
            // Check if uploads are still in progress
            try {
              const uploadStore = await getUploadStore();
              const { activeUploads } = uploadStore.getState();

              // Check for any uploads that are still in progress or pending
              const uploadsInProgress = activeUploads.filter(
                u => u.status === "uploading" || u.status === "pending"
              );
              if (uploadsInProgress.length > 0) {
                console.log(`[Auto-Magic] ${uploadsInProgress.length} uploads still in progress, waiting...`);
                return;
              }
            } catch (e) {
              console.warn("[Auto-Magic] Could not check upload store:", e);
            }

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

            // Also re-check for any clips that are pending/transcribing
            const stillAnyTranscribing = currentState.clipOrder.some(clipId => {
              const clip = currentState.clips[clipId];
              return clip && (clip.status === "pending" || clip.status === "transcribing");
            });

            if (stillAllReady && !stillAnyTranscribing && currentState.clipOrder.length > 0) {
              console.log(`[Auto-Magic] Starting magic processing for ${currentState.clipOrder.length} clips...`);
              runMagicProcessing();
            } else {
              console.log(`[Auto-Magic] Conditions changed, not starting. Ready: ${stillAllReady}, Transcribing: ${stillAnyTranscribing}, Clips: ${currentState.clipOrder.length}`);
            }
          }, AUTO_MAGIC_DEBOUNCE_MS);
        }
      },

      // Run the full magic processing pipeline
      runMagicProcessing: async () => {
        const { clips, clipOrder, autoRemoveFillerWords, setGapThreshold, deleteWords, removeClip, reorderClips } = get();

        // Don't run if no clips
        if (clipOrder.length === 0) return { fillerCount: 0, aiCutsCount: 0, clipsRemoved: 0, timeSavedMs: 0 };

        // Reset all previous word deletions and sentence state before re-running
        // This ensures fresh analysis without stale state from previous runs
        const resetClips = { ...clips };
        for (const clipId of clipOrder) {
          const clip = resetClips[clipId];
          if (clip?.words) {
            resetClips[clipId] = {
              ...clip,
              words: clip.words.map(w => ({ ...w, isDeleted: false, deletedByTrim: false })),
            };
          }
        }

        // Set processing state and mark as having run (prevents running twice)
        set({
          clips: resetClips,
          sentences: {},
          sentenceOrder: [],
          isProcessing: true,
          processingStatus: "Starting magic processing...",
          processingStartTime: Date.now(),
          processingStep: 1,
          _hasRunMagicProcessing: true
        });

        const durationBefore = get().getTotalDurationMs();
        const fillerCount = 0; // No longer used - AI handles everything in Pass 3
        let aiCutsCount = 0;
        let clipsRemoved = 0;
        let aiSuggestedOrder: string[] | null = null;
        let aiSuggestedSentenceOrder: string[] | null = null;  // NEW: sentence-level ordering
        let aiReasoning = "";
        let aiTextHook = "";
        let removedClipIds: string[] = [];
        let wordCuts: Array<{ clipId: string; text: string; reason: string }> = [];

        const { addProcessingEvent, clearProcessingEvents } = get();
        clearProcessingEvents(); // Clear any previous events

        try {
          // AI handles everything - no heuristic pre-processing
          // Pass 1: Understand + dedupe clips
          // Pass 2: Order for narrative flow
          // Pass 3: Cut stuttering + filler sounds with context
          // Pass 4: Final cleanup

          // Step 1: AI-powered MULTI-PASS analysis
          // Pass 1: Understand content + Dedupe (identify duplicate takes)
          // Pass 2: Order (arrange clips for best narrative flow)
          // Pass 3: Refine + Hooks (tighten script, generate hook, find emphasis)
          set({ processingStatus: "Understanding content...", processingStep: 2 });
          try {
            // Build clip data for AI analysis - EXCLUDE video_only clips (B-roll)
            const clipData = clipOrder
              .filter(clipId => {
                const clip = clips[clipId];
                return clip && clip.clipType !== "video_only";
              })
              .map((clipId, index) => {
                const clip = clips[clipId];
                const activeWords = clip.words.filter(w => !w.isDeleted);
                return {
                  clipId,
                  clipIndex: index + 1,
                  clipType: clip.clipType || "video_with_audio",
                  text: activeWords.map(w => w.text).join(" "),
                  words: activeWords.map(w => ({
                    id: w.id,
                    text: w.text,
                    startMs: w.startMs,
                    endMs: w.endMs,
                  })),
                };
              });

            console.log("\n" + "=".repeat(80));
            console.log("[AUTO-MAGIC] STARTING 4-PASS ANALYSIS (with sentence-level ordering)");
            console.log("=".repeat(80));
            console.log(`Total clips: ${clipData.length}`);
            clipData.forEach((clip, i) => {
              console.log(`\nClip ${i + 1} (${clip.clipId}):`);
              console.log(`  Type: ${clip.clipType}`);
              console.log(`  Words: ${clip.words.length}`);
              console.log(`  Text: "${clip.text.substring(0, 150)}${clip.text.length > 150 ? '...' : ''}"`);
            });
            console.log("=".repeat(80) + "\n");
            addProcessingEvent("pass_start", "AI analyzing your content...", `${clipData.length} clips to process`);

            // ==================== PASS 1: Understand + Dedupe ====================
            set({ processingStatus: "Understanding content and finding duplicates..." });
            addProcessingEvent("pass_start", "Pass 1: Understanding content");
            const pass1Response = await fetch("/api/analyze-cuts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ clips: clipData, pass: 1 }),
            });

            if (!pass1Response.ok) {
              throw new Error(`Pass 1 failed: ${pass1Response.status}`);
            }

            const pass1Result = await pass1Response.json();
            console.log("[Auto-Magic] Pass 1 result:", {
              understanding: pass1Result.understanding?.substring(0, 100),
              clipsToRemove: pass1Result.clipsToRemove?.length || 0,
              uniqueClipIds: pass1Result.uniqueClipIds?.length || 0,
            });

            // Apply clip removals from Pass 1
            if (pass1Result.clipsToRemove && pass1Result.clipsToRemove.length > 0) {
              set({ processingStatus: `Removing ${pass1Result.clipsToRemove.length} duplicate takes...` });
              for (const clipToRemove of pass1Result.clipsToRemove) {
                const clipId = typeof clipToRemove === 'string' ? clipToRemove : clipToRemove.clipId;
                const reason = typeof clipToRemove === 'string' ? 'Duplicate take' : clipToRemove.reason;
                const clipToCheck = get().clips[clipId];
                if (clipToCheck && clipToCheck.clipType !== "video_only") {
                  const clipIndex = clipOrder.indexOf(clipId) + 1;
                  removeClip(clipId, `Clip ${clipIndex}: ${reason}`);
                  clipsRemoved++;
                  removedClipIds.push(clipId);
                  addProcessingEvent("clip_removed", `Removed Clip ${clipIndex}`, reason);
                  console.log(`[Auto-Magic] Removed clip: ${clipId} - ${reason}`);
                }
              }
            }
            addProcessingEvent("pass_complete", `Pass 1 complete`, pass1Result.understanding?.substring(0, 80));

            // Filter to unique clips for Pass 2
            const uniqueClipData = clipData.filter(c =>
              (pass1Result.uniqueClipIds || []).includes(c.clipId)
            );

            // ==================== PARSE SENTENCES ====================
            // Parse sentences from unique clips for fine-grained ordering
            set({ processingStatus: "Parsing sentences..." });
            addProcessingEvent("pass_start", "Parsing sentences for fine-grained control");

            const { parseSentencesFromClip } = get();
            const allSentences: Array<{ id: string; clipId: string; text: string; startMs: number; endMs: number }> = [];
            const sentenceMap: Record<string, Sentence> = {};

            for (const clipId of (pass1Result.uniqueClipIds || [])) {
              const sentences = parseSentencesFromClip(clipId);
              for (const sentence of sentences) {
                allSentences.push({
                  id: sentence.id,
                  clipId: sentence.clipId,
                  text: sentence.text,
                  startMs: sentence.startMs,
                  endMs: sentence.endMs,
                });
                sentenceMap[sentence.id] = sentence;
              }
            }

            console.log(`[Auto-Magic] Parsed ${allSentences.length} sentences from ${uniqueClipData.length} clips`);
            addProcessingEvent("pass_complete", `Parsed ${allSentences.length} sentences`);

            // Store sentences in state
            set((state) => ({
              sentences: { ...state.sentences, ...sentenceMap },
            }));

            // ==================== PASS 2: Order (SENTENCE-LEVEL) ====================
            set({ processingStatus: "Arranging sentences for best flow..." });
            addProcessingEvent("pass_start", "Pass 2: Finding optimal sentence order");

            const pass2Response = await fetch("/api/analyze-cuts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clips: uniqueClipData,
                sentences: allSentences,  // NEW: Send sentences for fine-grained ordering
                pass: 2,
                understanding: pass1Result.understanding || "",
              }),
            });

            if (!pass2Response.ok) {
              throw new Error(`Pass 2 failed: ${pass2Response.status}`);
            }

            const pass2Result = await pass2Response.json();
            console.log("[Auto-Magic] Pass 2 result:", {
              suggestedOrder: pass2Result.suggestedOrder,
              suggestedSentenceOrder: pass2Result.suggestedSentenceOrder?.length || 0,
              orderReasoning: pass2Result.orderReasoning?.substring(0, 100),
            });

            // Store sentence order (preferred) or clip order
            if (pass2Result.suggestedSentenceOrder && pass2Result.suggestedSentenceOrder.length > 0) {
              const sentenceOrder: string[] = pass2Result.suggestedSentenceOrder;
              aiSuggestedSentenceOrder = sentenceOrder;
              aiReasoning = pass2Result.orderReasoning || "AI-optimized sentence flow";
              addProcessingEvent("order_found", `Ordered ${sentenceOrder.length} sentences`, aiReasoning.substring(0, 80));

              // Apply sentence order immediately to state
              const { setSentenceOrder } = get();
              setSentenceOrder(sentenceOrder);
              console.log(`[Auto-Magic] Applied sentence order: ${sentenceOrder.length} sentences`);
            } else if (pass2Result.suggestedOrder && pass2Result.suggestedOrder.length > 0) {
              // Fall back to clip-level ordering
              aiSuggestedOrder = pass2Result.suggestedOrder;
              aiReasoning = pass2Result.orderReasoning || "AI-optimized narrative flow";
              addProcessingEvent("order_found", "Found optimal clip order", aiReasoning.substring(0, 80));
            }
            addProcessingEvent("pass_complete", "Pass 2 complete");

            // Build ordered clip data for Pass 3
            // If we have sentence order, derive clip order from it
            let orderedClipData: typeof clipData;
            if (aiSuggestedSentenceOrder) {
              // Get unique clips in the order they first appear in sentence order
              const seenClips = new Set<string>();
              const clipOrderFromSentences: string[] = [];
              for (const sentId of aiSuggestedSentenceOrder) {
                const sentence = sentenceMap[sentId];
                if (sentence && !seenClips.has(sentence.clipId)) {
                  seenClips.add(sentence.clipId);
                  clipOrderFromSentences.push(sentence.clipId);
                }
              }
              orderedClipData = clipOrderFromSentences
                .map(id => uniqueClipData.find(c => c.clipId === id))
                .filter((c): c is typeof clipData[0] => c !== undefined);
            } else {
              orderedClipData = (pass2Result.suggestedOrder || [])
                .map((id: string) => uniqueClipData.find(c => c.clipId === id))
                .filter((c: any): c is typeof clipData[0] => c !== undefined);
            }

            // ==================== PASS 3: Refine + Hooks ====================
            set({ processingStatus: "Refining script and generating hook..." });
            addProcessingEvent("pass_start", "Pass 3: Refining script");
            const pass3Response = await fetch("/api/analyze-cuts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clips: orderedClipData.length > 0 ? orderedClipData : uniqueClipData,
                pass: 3,
              }),
            });

            if (!pass3Response.ok) {
              throw new Error(`Pass 3 failed: ${pass3Response.status}`);
            }

            const pass3Result = await pass3Response.json();
            console.log("[Auto-Magic] Pass 3 result:", {
              wordCutsCount: pass3Result.wordCuts?.length || 0,
              wordIdsToDelete: pass3Result.wordIdsToDelete?.length || 0,
              textHook: pass3Result.textHook,
              emphasisPointsCount: pass3Result.emphasisPoints?.length || 0,
            });

            // Apply word cuts from Pass 3
            if (pass3Result.wordIdsToDelete && pass3Result.wordIdsToDelete.length > 0) {
              set({ processingStatus: `Cutting ${pass3Result.wordIdsToDelete.length} words...` });

              // Log exactly which words are being deleted
              console.log("\n[AUTO-MAGIC] APPLYING WORD CUTS:");
              const currentClips = get().clips;
              pass3Result.wordIdsToDelete.forEach((wordId: string) => {
                // Find which clip and word this is
                for (const clipId of Object.keys(currentClips)) {
                  const word = currentClips[clipId].words.find(w => w.id === wordId);
                  if (word) {
                    console.log(`  Deleting: "${word.text}" (${wordId}) from ${clipId}`);
                    break;
                  }
                }
              });

              deleteWords(pass3Result.wordIdsToDelete);
              aiCutsCount = pass3Result.wordIdsToDelete.length;
              if (pass3Result.wordCuts) {
                wordCuts = pass3Result.wordCuts.map((cut: any) => ({
                  clipId: cut.clipId,
                  text: cut.text,
                  reason: cut.reason,
                }));
                // Add event for each word cut (max 3 to avoid spam)
                const cutsToShow = pass3Result.wordCuts.slice(0, 3);
                for (const cut of cutsToShow) {
                  addProcessingEvent("words_cut", `Cut: "${cut.text}"`, cut.reason);
                }
                if (pass3Result.wordCuts.length > 3) {
                  addProcessingEvent("words_cut", `+${pass3Result.wordCuts.length - 3} more cuts`);
                }
              }
            }

            // Store emphasis points from Pass 3
            if (pass3Result.emphasisPoints && pass3Result.emphasisPoints.length > 0) {
              const emphasisPointsMapped: EmphasisPoint[] = pass3Result.emphasisPoints.map((ep: any) => {
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
              addProcessingEvent("emphasis_found", `Found ${emphasisPointsMapped.length} emphasis points`, "Key moments for zoom effects");
              console.log(`[Auto-Magic] Found ${emphasisPointsMapped.length} emphasis points`);
            }

            // Create text hook from Pass 3
            if (pass3Result.textHook && pass3Result.textHook.length > 0) {
              aiTextHook = pass3Result.textHook;
              set({ processingStatus: "Adding attention-grabbing text hook..." });
              addProcessingEvent("hook_generated", `Hook: "${pass3Result.textHook}"`);

              try {
                const editorStore = await getEditorStore();
                const { size } = editorStore.getState();
                const hookId = `text-hook-${nanoid(8)}`;
                const hookWidth = Math.round(size.width * 0.75);
                const hookPayload = {
                  id: hookId,
                  type: "text",
                  display: { from: 0, to: 4000 },
                  details: {
                    text: pass3Result.textHook,
                    fontSize: 56,
                    fontFamily: "Inter-Bold",
                    color: "#000000",
                    backgroundColor: "#ffffff",
                    textAlign: "center",
                    width: hookWidth,
                    height: 120,
                    top: Math.round(size.height * 0.06),
                    left: Math.round((size.width - hookWidth) / 2),
                    wordWrap: "break-word",
                    borderWidth: 0,
                    borderColor: "#000000",
                    borderRadius: 40,
                    paddingTop: 28,
                    paddingBottom: 28,
                    paddingLeft: 24,
                    paddingRight: 24,
                    boxShadow: { color: "rgba(0,0,0,0.12)", x: 0, y: 4, blur: 16 },
                  },
                };
                dispatch(ADD_TEXT, { payload: hookPayload, options: {} });
                set({ textHook: pass3Result.textHook });
                console.log(`[Auto-Magic] Created text hook: "${pass3Result.textHook}"`);
              } catch (hookError) {
                console.warn("[Auto-Magic] Failed to create text hook timeline item:", hookError);
                set({ textHook: pass3Result.textHook });
              }
            }

            // ==================== PASS 4: Semantic Deduplication ====================
            // Only run if we have sentence-level ordering
            if (aiSuggestedSentenceOrder && aiSuggestedSentenceOrder.length > 0) {
              set({ processingStatus: "Removing thematic repetition..." });
              addProcessingEvent("pass_start", "Pass 4: Semantic deduplication");

              // Build ordered sentences for Pass 4
              const orderedSentences = aiSuggestedSentenceOrder
                .map(id => allSentences.find(s => s.id === id))
                .filter((s): s is typeof allSentences[0] => s !== undefined);

              const pass4Response = await fetch("/api/analyze-cuts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sentences: orderedSentences,
                  pass: 4,
                }),
              });

              if (pass4Response.ok) {
                const pass4Result = await pass4Response.json();
                console.log("[Auto-Magic] Pass 4 result:", {
                  sentencesToDelete: pass4Result.sentencesToDelete?.length || 0,
                  deduplicationReasoning: pass4Result.deduplicationReasoning?.substring(0, 100),
                });

                // Apply sentence deletions
                if (pass4Result.sentencesToDelete && pass4Result.sentencesToDelete.length > 0) {
                  const { deleteSentence } = get();
                  let sentencesCut = 0;

                  for (const { sentenceId, reason } of pass4Result.sentencesToDelete) {
                    const sentence = sentenceMap[sentenceId];
                    if (sentence) {
                      deleteSentence(sentenceId, reason);
                      sentencesCut++;
                      const shortText = sentence.text.substring(0, 30) + (sentence.text.length > 30 ? '...' : '');
                      addProcessingEvent("sentence_cut", `Cut: "${shortText}"`, reason);
                      console.log(`[Auto-Magic] Cut sentence: ${sentenceId} - "${shortText}" - ${reason}`);
                    }
                  }

                  if (sentencesCut > 0) {
                    console.log(`[Auto-Magic] Removed ${sentencesCut} semantically redundant sentences`);
                  }
                }

                if (pass4Result.deduplicationReasoning) {
                  addProcessingEvent("pass_complete", "Pass 4 complete", pass4Result.deduplicationReasoning.substring(0, 80));
                } else {
                  addProcessingEvent("pass_complete", "Pass 4 complete", "No thematic repetition found");
                }
              } else {
                console.warn("[Auto-Magic] Pass 4 failed, continuing without semantic dedup");
                addProcessingEvent("pass_complete", "Pass 4 skipped");
              }
            }

            // ==================== PASS 5: AI Transition Selection ====================
            // Build transition pairs from consecutive clips in the final order
            const { setTransition } = get();
            const finalClipOrder = aiSuggestedSentenceOrder
              ? (() => {
                  // Derive clip order from sentence order
                  const seenClips = new Set<string>();
                  const order: string[] = [];
                  for (const sentId of aiSuggestedSentenceOrder) {
                    const sentence = sentenceMap[sentId];
                    if (sentence && !seenClips.has(sentence.clipId)) {
                      seenClips.add(sentence.clipId);
                      order.push(sentence.clipId);
                    }
                  }
                  return order;
                })()
              : (pass2Result?.suggestedOrder || clipOrder.filter(id => !removedClipIds.includes(id)));

            // Only run if we have at least 2 clips for transitions
            if (finalClipOrder.length >= 2) {
              set({ processingStatus: "Selecting transitions..." });
              addProcessingEvent("pass_start", "Pass 5: AI transition selection");

              // Build transition pairs with context
              const transitionPairs: Array<{
                fromClipId: string;
                toClipId: string;
                fromText: string;
                toText: string;
              }> = [];

              for (let i = 0; i < finalClipOrder.length - 1; i++) {
                const fromClipId = finalClipOrder[i];
                const toClipId = finalClipOrder[i + 1];
                const fromClip = clips[fromClipId];
                const toClip = clips[toClipId];

                if (fromClip && toClip) {
                  // Get last ~50 words from "from" clip and first ~50 words from "to" clip for context
                  const fromWords = fromClip.words.filter(w => !w.isDeleted);
                  const toWords = toClip.words.filter(w => !w.isDeleted);
                  const fromText = fromWords.slice(-50).map(w => w.text).join(" ");
                  const toText = toWords.slice(0, 50).map(w => w.text).join(" ");

                  transitionPairs.push({ fromClipId, toClipId, fromText, toText });
                }
              }

              if (transitionPairs.length > 0) {
                try {
                  const pass5Response = await fetch("/api/analyze-cuts", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      transitionPairs,
                      pass: 5,
                    }),
                  });

                  if (pass5Response.ok) {
                    const pass5Result = await pass5Response.json();
                    console.log("[Auto-Magic] Pass 5 result:", {
                      transitionsCount: pass5Result.transitions?.length || 0,
                      overallStyle: pass5Result.overallStyle?.substring(0, 80),
                    });

                    // Apply transitions
                    if (pass5Result.transitions && pass5Result.transitions.length > 0) {
                      let transitionsApplied = 0;
                      for (const t of pass5Result.transitions) {
                        if (t.type && t.type !== "none") {
                          setTransition(
                            t.fromClipId,
                            t.toClipId,
                            t.type,
                            t.durationMs || 400,
                            t.direction || undefined
                          );
                          transitionsApplied++;
                          console.log(`[Auto-Magic] Applied ${t.type} transition: ${t.fromClipId} → ${t.toClipId}`);
                        }
                      }

                      if (transitionsApplied > 0) {
                        addProcessingEvent("pass_complete", `Applied ${transitionsApplied} transitions`, pass5Result.overallStyle?.substring(0, 60));
                      } else {
                        addProcessingEvent("pass_complete", "Pass 5 complete", "Using hard cuts for fast pacing");
                      }
                    } else {
                      addProcessingEvent("pass_complete", "Pass 5 complete", "No transitions needed");
                    }
                  } else {
                    console.warn("[Auto-Magic] Pass 5 failed, continuing without AI transitions");
                    addProcessingEvent("pass_complete", "Pass 5 skipped");
                  }
                } catch (pass5Error) {
                  console.warn("[Auto-Magic] Pass 5 error:", pass5Error);
                  addProcessingEvent("pass_complete", "Pass 5 skipped", "Error selecting transitions");
                }
              }
            }

            addProcessingEvent("pass_complete", "AI analysis complete!");

          } catch (aiError) {
            console.warn("[Auto-Magic] AI analysis failed, continuing with basic processing:", aiError);
            addProcessingEvent("pass_complete", "AI analysis skipped", "Continuing with basic processing");
          }

          // Step 3: Optimize pacing (set gap threshold)
          set({ processingStatus: "Optimizing pacing...", processingStep: 3 });
          setGapThreshold(200); // Balanced - gaps >200ms get cut

          // Step 4: Transitions are now handled by Pass 5 (AI Transition Selection)
          // AI analyzes content relationships and applies appropriate transitions
          // (fade for topic changes, hard cuts for continuations, etc.)

          // Step 5: Apply AI-suggested clip order
          // When using sentence ordering, derive clip order from sentence order (first appearance)
          if (aiSuggestedSentenceOrder && aiSuggestedSentenceOrder.length > 0) {
            set({ processingStatus: "Applying AI-optimized order..." });
            const currentClips = get().clips;
            const currentOrder = get().clipOrder;
            const sentences = get().sentences;

            // Derive clip order from sentence order (order of first appearance)
            const seenClips = new Set<string>();
            const derivedClipOrder: string[] = [];
            for (const sentId of aiSuggestedSentenceOrder) {
              const sentence = sentences[sentId];
              if (sentence && !seenClips.has(sentence.clipId)) {
                seenClips.add(sentence.clipId);
                derivedClipOrder.push(sentence.clipId);
              }
            }

            // Add any clips not in sentence order (deleted clips, B-roll, etc.)
            const deletedClips = currentOrder.filter(id =>
              currentClips[id] !== undefined &&
              currentClips[id].isDeleted
            );
            const otherClips = currentOrder.filter(id =>
              !seenClips.has(id) &&
              !deletedClips.includes(id) &&
              currentClips[id] !== undefined
            );

            const finalClipOrder = [...derivedClipOrder, ...otherClips, ...deletedClips];

            if (finalClipOrder.length > 0) {
              reorderClips(finalClipOrder);
              console.log(`[Auto-Magic] Applied clip order from sentence ordering: ${finalClipOrder.join(" → ")}`);
            }
          } else if (aiSuggestedOrder && aiSuggestedOrder.length > 0) {
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

      // Clip transitions - get transition between two clips
      getTransitionBetween: (fromClipId: string, toClipId: string): ClipTransition | null => {
        const { clipTransitions } = get();
        return Object.values(clipTransitions).find(
          t => t.fromClipId === fromClipId && t.toClipId === toClipId
        ) || null;
      },

      // Set or update transition between clips
      setTransition: (fromClipId: string, toClipId: string, type: TransitionType, durationMs = 500, direction?: TransitionDirection): string => {
        console.log("[Store] setTransition called:", { fromClipId, toClipId, type, durationMs, direction });
        const { clipTransitions } = get();

        // Check if transition already exists
        const existing = Object.values(clipTransitions).find(
          t => t.fromClipId === fromClipId && t.toClipId === toClipId
        );

        if (existing) {
          console.log("[Store] Updating existing transition:", existing.id);
          // Update existing transition
          set({
            clipTransitions: {
              ...clipTransitions,
              [existing.id]: {
                ...existing,
                type,
                durationMs,
                direction,
              },
            },
          });
          return existing.id;
        }

        // Create new transition (use :: delimiter to avoid conflicts with clipId dashes)
        const id = `transition::${fromClipId}::${toClipId}`;
        set({
          clipTransitions: {
            ...clipTransitions,
            [id]: {
              id,
              fromClipId,
              toClipId,
              type,
              durationMs,
              direction,
            },
          },
        });
        return id;
      },

      // Update specific transition properties
      updateTransition: (transitionId: string, updates: Partial<Omit<ClipTransition, "id" | "fromClipId" | "toClipId">>) => {
        const { clipTransitions } = get();
        const transition = clipTransitions[transitionId];
        if (!transition) return;

        set({
          clipTransitions: {
            ...clipTransitions,
            [transitionId]: {
              ...transition,
              ...updates,
            },
          },
        });
      },

      // Remove a transition
      removeTransition: (transitionId: string) => {
        const { clipTransitions } = get();
        const { [transitionId]: _, ...rest } = clipTransitions;
        set({ clipTransitions: rest });
      },

      // Get all transitions for rendering (mapped to clip order)
      getTransitionsForRender: () => {
        const { clipTransitions, clipOrder, clips } = get();
        const result: Array<{ fromClipId: string; toClipId: string; type: TransitionType; direction?: TransitionDirection; durationMs: number }> = [];

        // Get non-deleted clips in order
        const activeClipOrder = clipOrder.filter(id => clips[id] && !clips[id].isDeleted);

        console.log("[Store] getTransitionsForRender:", {
          clipTransitionsCount: Object.keys(clipTransitions).length,
          clipTransitions: Object.values(clipTransitions).map(t => ({ from: t.fromClipId, to: t.toClipId, type: t.type })),
          activeClipOrder,
        });

        for (let i = 0; i < activeClipOrder.length - 1; i++) {
          const fromClipId = activeClipOrder[i];
          const toClipId = activeClipOrder[i + 1];

          const transition = Object.values(clipTransitions).find(
            t => t.fromClipId === fromClipId && t.toClipId === toClipId
          );

          if (transition && transition.type !== "none") {
            console.log("[Store] Found transition for render:", { from: fromClipId, to: toClipId, type: transition.type });
            result.push({
              fromClipId: transition.fromClipId,
              toClipId: transition.toClipId,
              type: transition.type,
              direction: transition.direction,
              durationMs: transition.durationMs,
            });
          }
        }

        return result;
      },

      reset: () => {
        // Clear debounce timer if any
        if (autoMagicDebounceTimer) {
          clearTimeout(autoMagicDebounceTimer);
          autoMagicDebounceTimer = null;
        }
        set({ clips: {}, clipOrder: [], clipTransitions: {}, sentences: {}, sentenceOrder: [], isProcessing: false, processingStatus: "", _hasRunMagicProcessing: false });
      },
    }),
    {
      name: "transcript-store",
      partialize: (state) => ({
        clips: state.clips,
        clipOrder: state.clipOrder,
        clipTransitions: state.clipTransitions,
        sentences: state.sentences,
        sentenceOrder: state.sentenceOrder,
        gapThresholdMs: state.gapThresholdMs,
      }),
    }
  )
);

export default useTranscriptStore;
