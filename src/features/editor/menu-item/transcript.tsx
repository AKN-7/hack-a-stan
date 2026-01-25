import { useCallback, useState, useRef, useEffect } from "react";
import { dispatch } from "@designcombo/events";
import { Reorder, useDragControls } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Trash2,
  Clock,
  GripVertical,
  Plus,
  Scissors,
  RotateCcw,
  Pencil,
  Check,
  X,
} from "lucide-react";
import useTranscriptStore, { TranscriptWord } from "../store/use-transcript-store";
import useStore from "../store/use-store";
import useUploadStore from "../store/use-upload-store";
import { cn } from "@/lib/utils";
import ModalUpload from "@/components/modal-upload";

// Clip color palette - vibrant, poppy colors
const CLIP_COLORS = [
  { bg: "bg-blue-500", light: "bg-blue-50", text: "text-blue-600", border: "border-blue-200", ring: "ring-blue-500/20" },
  { bg: "bg-violet-500", light: "bg-violet-50", text: "text-violet-600", border: "border-violet-200", ring: "ring-violet-500/20" },
  { bg: "bg-amber-500", light: "bg-amber-50", text: "text-amber-600", border: "border-amber-200", ring: "ring-amber-500/20" },
  { bg: "bg-emerald-500", light: "bg-emerald-50", text: "text-emerald-600", border: "border-emerald-200", ring: "ring-emerald-500/20" },
  { bg: "bg-pink-500", light: "bg-pink-50", text: "text-pink-600", border: "border-pink-200", ring: "ring-pink-500/20" },
  { bg: "bg-cyan-500", light: "bg-cyan-50", text: "text-cyan-600", border: "border-cyan-200", ring: "ring-cyan-500/20" },
];

const getClipColor = (index: number) => CLIP_COLORS[index % CLIP_COLORS.length];

// Get stable color index from clipId (for clips without colorIndex set)
const getStableColorIndex = (clipId: string): number => {
  let hash = 0;
  for (let i = 0; i < clipId.length; i++) {
    hash = ((hash << 5) - hash) + clipId.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % CLIP_COLORS.length;
};

// Format milliseconds to mm:ss
const formatDuration = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

// Draggable clip item component - uses useDragControls for smooth handle-only dragging
interface ClipItemProps {
  clipId: string;
  index: number;
  clip: {
    words: TranscriptWord[];
    colorIndex?: number;
    isDeleted?: boolean;
  };
  currentWordId: string | null;
  selectedWordIds: Set<string>;
  editingWordId: string | null;
  wordRefs: React.MutableRefObject<Map<string, HTMLSpanElement>>;
  handleWordClick: (word: TranscriptWord, event: React.MouseEvent) => void;
  handleWordDoubleClick: (word: TranscriptWord) => void;
  handleMouseUp: () => void;
  hardRemoveClip: (clipId: string) => void;
}

const ClipItem = ({
  clipId,
  index,
  clip,
  currentWordId,
  selectedWordIds,
  editingWordId,
  wordRefs,
  handleWordClick,
  handleWordDoubleClick,
  handleMouseUp,
  hardRemoveClip,
}: ClipItemProps) => {
  const dragControls = useDragControls();

  const clipWords = clip.words;
  const clipDurationMs = clipWords.filter(w => !w.isDeleted).reduce((sum, w) => sum + (w.endMs - w.startMs), 0);
  // Use clip's stored colorIndex, or derive stable color from clipId (not position)
  const color = getClipColor(clip.colorIndex ?? getStableColorIndex(clipId));
  const isClipDeleted = clip.isDeleted;

  return (
    <Reorder.Item
      value={clipId}
      dragListener={false}
      dragControls={dragControls}
      className={cn(
        "border-b border-border last:border-b-0 bg-white select-none",
        isClipDeleted && "opacity-60 bg-red-50/50"
      )}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      whileDrag={{
        scale: 1.02,
        boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
        zIndex: 50,
        cursor: "grabbing"
      }}
      transition={{
        layout: { type: "spring", stiffness: 500, damping: 35 },
        opacity: { duration: 0.2 },
        y: { duration: 0.2 }
      }}
      layout
    >
      {/* Clip Header - colored background */}
      <div className={cn(
        "flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2 md:py-3",
        isClipDeleted ? "bg-red-50 border-b border-red-200" : cn(color.light, color.border, "border-b")
      )}>
        {/* Drag handle - only this initiates drag */}
        <div
          onPointerDown={(e) => dragControls.start(e)}
          className={cn(
            "cursor-grab active:cursor-grabbing touch-none p-1 -m-1 rounded transition-colors",
            isClipDeleted ? "text-red-400" : cn(color.text, "opacity-50 hover:opacity-100 hover:bg-black/5")
          )}
        >
          <GripVertical className="h-4 w-4" />
        </div>

        <span className={cn(
          "text-sm font-semibold flex-1 truncate",
          isClipDeleted ? "text-red-700 line-through" : color.text
        )}>
          Clip {index + 1}
          {isClipDeleted && (
            <span className="ml-1 md:ml-2 text-xs font-normal text-red-500 no-underline">
              (removed)
            </span>
          )}
        </span>

        {!isClipDeleted && (
          <span className={cn(
            "text-xs font-medium px-1.5 md:px-2 py-0.5 rounded-md shrink-0 bg-white/60",
            color.text
          )}>
            {formatDuration(clipDurationMs)}
          </span>
        )}

        {/* Delete Button */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-8 w-8 md:h-7 md:w-7 rounded-lg hover:text-red-600 hover:bg-red-100/80",
            isClipDeleted ? "text-red-400" : cn(color.text, "opacity-50 hover:opacity-100")
          )}
          onClick={() => hardRemoveClip(clipId)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Clip Words - drag to select */}
      <div
        className={cn(
          "px-4 py-3 overflow-hidden",
          isClipDeleted && "pointer-events-none select-none"
        )}
        onMouseUp={!isClipDeleted ? handleMouseUp : undefined}
      >
        <p className={cn(
          "text-sm leading-8 max-w-full select-text",
          isClipDeleted && "line-through text-red-700/70"
        )} style={{ wordWrap: "break-word", overflowWrap: "break-word", wordBreak: "break-word" }}>
          {clipWords.map((word, wordIndex) => (
            <span key={word.id}>
              <span
                ref={(el) => {
                  if (el) wordRefs.current.set(word.id, el);
                }}
                onClick={(e) => !isClipDeleted && handleWordClick(word, e)}
                onDoubleClick={() => !isClipDeleted && !word.isDeleted && handleWordDoubleClick(word)}
                className={cn(
                  "rounded px-0.5 py-0.5 transition-colors duration-100 inline",
                  isClipDeleted
                    ? "cursor-default"
                    : "cursor-text",
                  // Deleted words: strikethrough + if selected show selection ring
                  !isClipDeleted && word.isDeleted && selectedWordIds.has(word.id)
                    ? "line-through bg-amber-100 text-amber-700 ring-2 ring-amber-400 font-medium"
                    : !isClipDeleted && word.isDeleted
                    ? "line-through opacity-50 bg-red-100 text-red-700"
                    : !isClipDeleted && editingWordId === word.id
                    ? "bg-blue-500 text-white font-medium ring-2 ring-blue-300"
                    : !isClipDeleted && currentWordId === word.id
                    ? "bg-primary text-white font-medium"
                    : !isClipDeleted && selectedWordIds.has(word.id)
                    ? cn(color.light, color.text, "font-medium")
                    : !isClipDeleted && "hover:bg-muted"
                )}
              >
                {word.text}{wordIndex < clipWords.length - 1 ? " " : ""}
              </span>
            </span>
          ))}
        </p>
      </div>
    </Reorder.Item>
  );
};

export const Transcript = () => {
  const {
    clips,
    clipOrder,
    getUnifiedTranscript,
    deleteWords,
    restoreWord,
    restoreAllWords,
    getTotalDurationMs,
    getRenderSegments,
    getWordAtTime,
    reorderClips,
    hardRemoveClip,
    editWord,
  } = useTranscriptStore();
  const [currentWordId, setCurrentWordId] = useState<string | null>(null);

  const { playerRef, fps } = useStore();
  const { setShowUploadModal, activeUploads } = useUploadStore();

  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const selectionStartRef = useRef<string | null>(null);
  const wordRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  // Edit mode state
  const [editingWordId, setEditingWordId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  const unifiedTranscript = getUnifiedTranscript();
  const renderSegments = getRenderSegments();

  // Track current word during playback
  useEffect(() => {
    if (!playerRef?.current) return;

    const checkCurrentWord = () => {
      const player = playerRef.current;
      if (!player) return;

      const currentFrame = player.getCurrentFrame();
      const playbackTimeMs = (currentFrame / fps) * 1000;

      // Find which render segment we're in and map to source time
      for (const segment of renderSegments) {
        const segmentEndInTimeline = segment.offsetMs + segment.durationMs;
        if (playbackTimeMs >= segment.offsetMs && playbackTimeMs < segmentEndInTimeline) {
          const offsetInSegment = playbackTimeMs - segment.offsetMs;
          const sourceTimeMs = segment.startMs + offsetInSegment;

          // Find the word at this source time (pass clipId for multi-clip accuracy)
          const word = getWordAtTime(sourceTimeMs, segment.clipId);
          if (word && word.id !== currentWordId) {
            setCurrentWordId(word.id);

            // Auto-scroll to current word
            const wordEl = wordRefs.current.get(word.id);
            if (wordEl) {
              wordEl.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }
          return;
        }
      }

      // Not in any segment
      setCurrentWordId(null);
    };

    // Check periodically during playback
    const interval = setInterval(checkCurrentWord, 100);
    return () => clearInterval(interval);
  }, [playerRef, fps, renderSegments, getWordAtTime, currentWordId]);

  // Get transcription status
  const transcribingClips = clipOrder.filter(
    (id) => clips[id]?.status === "transcribing"
  );
  const pendingClips = clipOrder.filter(
    (id) => clips[id]?.status === "pending"
  );
  const errorClips = clipOrder.filter(
    (id) => clips[id]?.status === "error"
  );
  const readyClips = clipOrder.filter(
    (id) => clips[id]?.status === "ready"
  );

  // Seek to word timestamp (maps source time to edited timeline position)
  const seekToWord = useCallback(
    (word: TranscriptWord) => {
      if (!playerRef?.current) return;

      // If word is deleted, don't seek
      if (word.isDeleted) return;

      // Find which render segment contains this word
      for (const segment of renderSegments) {
        if (
          segment.clipId === word.clipId &&
          word.startMs >= segment.startMs &&
          word.startMs < segment.endMs
        ) {
          // Calculate position within this segment
          const offsetInSegment = word.startMs - segment.startMs;
          const timelinePositionMs = segment.offsetMs + offsetInSegment;
          const frame = Math.floor((timelinePositionMs / 1000) * fps);
          playerRef.current.seekTo(frame);
          return;
        }
      }

      // Fallback: seek to source time (for when no segments match)
      const frame = Math.floor((word.startMs / 1000) * fps);
      playerRef.current.seekTo(frame);
    },
    [playerRef, fps, renderSegments]
  );

  // Handle word click
  const handleWordClick = useCallback(
    (word: TranscriptWord, event: React.MouseEvent) => {
      if (event.shiftKey && selectionStartRef.current) {
        // Shift+click: select range
        const startIdx = unifiedTranscript.findIndex(
          (w) => w.id === selectionStartRef.current
        );
        const endIdx = unifiedTranscript.findIndex((w) => w.id === word.id);

        if (startIdx !== -1 && endIdx !== -1) {
          const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          const rangeIds = unifiedTranscript
            .slice(from, to + 1)
            .map((w) => w.id);
          setSelectedWordIds(new Set(rangeIds));
        }
      } else if (event.ctrlKey || event.metaKey) {
        // Ctrl/Cmd+click: toggle selection
        setSelectedWordIds((prev) => {
          const next = new Set(prev);
          if (next.has(word.id)) {
            next.delete(word.id);
          } else {
            next.add(word.id);
          }
          return next;
        });
        selectionStartRef.current = word.id;
      } else {
        // Regular click: seek and set as selection start
        seekToWord(word);
        setSelectedWordIds(new Set([word.id]));
        selectionStartRef.current = word.id;
      }
    },
    [unifiedTranscript, seekToWord]
  );

  // Seek to start to avoid buffering lag after edits
  const seekToStart = useCallback(() => {
    if (playerRef?.current) {
      playerRef.current.seekTo(0);
    }
  }, [playerRef]);

  // Handle keyboard delete
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedWordIds.size > 0) {
        // Don't delete if user is typing in an input
        if (
          document.activeElement?.tagName === "INPUT" ||
          document.activeElement?.tagName === "TEXTAREA"
        ) {
          return;
        }
        e.preventDefault();
        deleteWords(Array.from(selectedWordIds));
        setSelectedWordIds(new Set());
        seekToStart();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedWordIds, deleteWords, seekToStart]);

  // Handle delete button click
  const handleDeleteSelected = useCallback(() => {
    if (selectedWordIds.size > 0) {
      deleteWords(Array.from(selectedWordIds));
      setSelectedWordIds(new Set());
      seekToStart();
    }
  }, [selectedWordIds, deleteWords, seekToStart]);

  // Handle restore selected words
  const handleRestoreSelected = useCallback(() => {
    if (selectedWordIds.size > 0) {
      for (const wordId of selectedWordIds) {
        restoreWord(wordId);
      }
      setSelectedWordIds(new Set());
      seekToStart();
    }
  }, [selectedWordIds, restoreWord, seekToStart]);

  // Check if all selected words are deleted (for showing Restore vs Cut)
  const allSelectedAreDeleted = selectedWordIds.size > 0 &&
    Array.from(selectedWordIds).every(wordId => {
      const word = unifiedTranscript.find(w => w.id === wordId);
      return word?.isDeleted;
    });

  // Handle restore all
  const handleRestoreAll = useCallback(() => {
    restoreAllWords();
    setSelectedWordIds(new Set());
    seekToStart();
  }, [restoreAllWords, seekToStart]);

  // Handle double-click to edit a word
  const handleWordDoubleClick = useCallback((word: TranscriptWord) => {
    if (word.isDeleted) return;
    setEditingWordId(word.id);
    setEditText(word.text);
    setSelectedWordIds(new Set()); // Clear selection when editing
    // Focus input after render
    setTimeout(() => editInputRef.current?.focus(), 50);
  }, []);

  // Save edited word
  const handleSaveEdit = useCallback(() => {
    if (editingWordId && editText.trim()) {
      editWord(editingWordId, editText.trim());
    }
    setEditingWordId(null);
    setEditText("");
  }, [editingWordId, editText, editWord]);

  // Cancel edit
  const handleCancelEdit = useCallback(() => {
    setEditingWordId(null);
    setEditText("");
  }, []);

  // Check if any words are deleted
  const hasDeletedWords = unifiedTranscript.some((w) => w.isDeleted);

  // Handle native text selection (drag to select like Google Docs)
  const handleSelectionChange = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    // Find all word spans that are within the selection (including deleted words for restore)
    const selectedIds = new Set<string>();

    wordRefs.current.forEach((element, wordId) => {
      if (selection.containsNode(element, true)) {
        const word = unifiedTranscript.find(w => w.id === wordId);
        if (word) {
          selectedIds.add(wordId);
        }
      }
    });

    if (selectedIds.size > 0) {
      setSelectedWordIds(selectedIds);
      // Set selection start for potential Shift+Click extension
      const firstSelectedWord = unifiedTranscript.find(w => selectedIds.has(w.id));
      if (firstSelectedWord) {
        selectionStartRef.current = firstSelectedWord.id;
      }
    }
  }, [unifiedTranscript]);

  // Handle mouseup to capture selection
  const handleMouseUp = useCallback(() => {
    // Small delay to let selection finalize
    setTimeout(() => {
      handleSelectionChange();
      // Clear the browser's visual selection after we've captured it
      window.getSelection()?.removeAllRanges();
    }, 10);
  }, [handleSelectionChange]);

  return (
    <div className="flex flex-1 flex-col h-full bg-white relative overflow-hidden">
      <ModalUpload />
      {/* Header */}
      <div className="flex h-12 flex-none items-center justify-between px-3 md:px-4 border-b border-border">
        <span className="text-sm font-semibold text-foreground">Transcript</span>
        {hasDeletedWords && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRestoreAll}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg font-medium"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            Restore
          </Button>
        )}
      </div>

      {/* Consolidated Status Bar */}
      {(() => {
        const uploadingUploads = activeUploads.filter(u => u.status === "uploading");
        const uploadingCount = uploadingUploads.length;
        const transcribingCount = transcribingClips.length;
        const pendingCount = pendingClips.length;
        const errorCount = errorClips.length;
        const readyCount = clipOrder.filter(id => clips[id]?.status === "ready").length;
        const totalClips = clipOrder.length;

        // Calculate average upload progress
        const avgUploadProgress = uploadingCount > 0
          ? Math.round(uploadingUploads.reduce((sum, u) => sum + (u.progress || 0), 0) / uploadingCount)
          : 0;

        // Overall progress: uploads + transcriptions complete
        const completedSteps = readyCount;
        const totalSteps = totalClips + uploadingCount;
        const overallProgress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

        const isActive = uploadingCount > 0 || transcribingCount > 0 || pendingCount > 0;

        if (!isActive && errorCount === 0) return null;

        return (
          <div className="px-4 py-2.5 border-b border-border/50">
            {/* Single status line */}
            <div className="flex items-center gap-3 text-xs">
              {(uploadingCount > 0 || transcribingCount > 0) && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
              )}

              <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                {uploadingCount > 0 && (
                  <span className="text-blue-600 font-medium">
                    Uploading {uploadingCount} {avgUploadProgress > 0 && `(${avgUploadProgress}%)`}
                  </span>
                )}
                {uploadingCount > 0 && transcribingCount > 0 && (
                  <span className="text-muted-foreground">•</span>
                )}
                {transcribingCount > 0 && (
                  <span className="text-amber-600 font-medium">
                    Transcribing {transcribingCount}
                  </span>
                )}
                {(uploadingCount > 0 || transcribingCount > 0) && pendingCount > 0 && (
                  <span className="text-muted-foreground">•</span>
                )}
                {pendingCount > 0 && (
                  <span className="text-muted-foreground">
                    {pendingCount} queued
                  </span>
                )}
                {readyCount > 0 && totalClips > 0 && (
                  <>
                    <span className="text-muted-foreground">•</span>
                    <span className="text-green-600 font-medium">
                      {readyCount}/{totalClips} ready
                    </span>
                  </>
                )}
              </div>

              {errorCount > 0 && (
                <span className="text-red-500 font-medium shrink-0">
                  {errorCount} failed
                </span>
              )}
            </div>

            {/* Single progress bar */}
            {isActive && (
              <div className="mt-2 w-full h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${Math.max(overallProgress, uploadingCount > 0 ? avgUploadProgress * 0.3 : 5)}%` }}
                />
              </div>
            )}
          </div>
        );
      })()}

      {/* Empty State */}
      {clipOrder.length === 0 && !activeUploads.some(u => u.status === "uploading") && (
        <div className="flex-1 flex items-center justify-center p-4">
          <Button
            size="sm"
            className="h-10 px-5 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold shadow-md shadow-primary/25 cursor-pointer"
            onClick={() => setShowUploadModal(true)}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add clip
          </Button>
        </div>
      )}

      {/* Skeleton Transcript - Shows during transcription */}
      {clipOrder.length > 0 && transcribingClips.length > 0 && !clipOrder.some(id => clips[id]?.status === "ready") && (
        <div className="flex-1 overflow-hidden p-4">
          <div className="space-y-4 animate-pulse">
            {/* Fake paragraph blocks */}
            {[...Array(4)].map((_, blockIdx) => (
              <div key={blockIdx} className="space-y-2">
                {/* Lines within each block */}
                {[...Array(3 + Math.floor(Math.random() * 2))].map((_, lineIdx) => (
                  <div key={lineIdx} className="flex flex-wrap gap-1.5">
                    {/* Words within each line */}
                    {[...Array(6 + Math.floor(Math.random() * 4))].map((_, wordIdx) => (
                      <div
                        key={wordIdx}
                        className="h-5 bg-muted rounded"
                        style={{
                          width: `${40 + Math.random() * 60}px`,
                          animationDelay: `${(blockIdx * 5 + lineIdx * 3 + wordIdx) * 50}ms`
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center mt-6">
            Transcribing your video...
          </p>
        </div>
      )}

      {/* Transcript Content - Clips as Separate Sections */}
      {clipOrder.length > 0 && clipOrder.some(id => clips[id]?.status === "ready") && (
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="px-4 py-3 bg-gradient-to-r from-primary/5 via-primary/5 to-transparent border-b border-primary/10">
            <p className="text-xs text-muted-foreground">
              <span className="text-primary font-medium">Drag to select text</span> → press <kbd className="px-1.5 py-0.5 mx-1 bg-red-100 text-red-600 rounded text-[10px] font-semibold">Delete</kbd> to cut
            </p>
          </div>

          <Reorder.Group
            axis="y"
            values={clipOrder.filter((clipId) => {
              const clip = clips[clipId];
              return clip && clip.clipType !== "video_only" && clip.clipType !== "background_music" && clip.status === "ready";
            })}
            onReorder={(newVisibleOrder) => {
              // Rebuild full clipOrder maintaining positions of hidden clips
              const hiddenClips = clipOrder.filter((id) => {
                const clip = clips[id];
                return !clip || clip.clipType === "video_only" || clip.clipType === "background_music" || clip.status !== "ready";
              });
              // Put visible clips in new order, hidden clips at the end
              reorderClips([...newVisibleOrder, ...hiddenClips]);
            }}
            className="relative"
            layoutScroll
          >
            {clipOrder
              .filter((clipId) => {
                const clip = clips[clipId];
                return clip && clip.clipType !== "video_only" && clip.clipType !== "background_music" && clip.status === "ready";
              })
              .map((clipId, index) => {
                const clip = clips[clipId];
                if (!clip) return null;

                return (
                  <ClipItem
                    key={clipId}
                    clipId={clipId}
                    index={index}
                    clip={clip}
                    currentWordId={currentWordId}
                    selectedWordIds={selectedWordIds}
                    editingWordId={editingWordId}
                    wordRefs={wordRefs}
                    handleWordClick={handleWordClick}
                    handleWordDoubleClick={handleWordDoubleClick}
                    handleMouseUp={handleMouseUp}
                    hardRemoveClip={hardRemoveClip}
                  />
                );
              })}
          </Reorder.Group>

        </div>
      )}

      {/* Transcribing but no content yet */}
      {unifiedTranscript.length === 0 &&
        clipOrder.length > 0 &&
        readyClips.length === 0 && (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-amber-50 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
              </div>
              <p className="text-base font-medium text-foreground mb-1">Transcribing...</p>
              <p className="text-sm text-muted-foreground">This may take a moment</p>
            </div>
          </div>
        )}

      {/* Fixed bottom action bar - swaps between Add Clip, Selection, and Edit */}
      {clipOrder.length > 0 && clipOrder.some(id => clips[id]?.status === "ready") && (
        <div className="flex-none border-t border-border bg-white p-3">
          {editingWordId ? (
            // Edit mode UI
            <div className="flex items-center gap-2 h-10 px-4 rounded-xl bg-blue-500 text-white">
              <Pencil className="w-4 h-4 shrink-0" />
              <input
                ref={editInputRef}
                type="text"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveEdit();
                  if (e.key === "Escape") handleCancelEdit();
                }}
                className="flex-1 bg-white/20 text-white placeholder-white/60 px-2 py-1 rounded-lg text-sm font-medium outline-none focus:bg-white/30"
                placeholder="Edit word..."
              />
              <button
                type="button"
                className="h-7 w-7 bg-white hover:bg-gray-100 text-blue-600 rounded-lg flex items-center justify-center transition-colors"
                onClick={handleSaveEdit}
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="h-7 w-7 rounded-lg hover:bg-white/20 flex items-center justify-center transition-colors"
                onClick={handleCancelEdit}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : selectedWordIds.size > 0 ? (
            // Selection mode UI - show Restore if all selected are deleted, otherwise Cut
            <div className="flex items-center gap-2 h-10 px-4 rounded-xl bg-foreground text-background">
              <span className="text-sm font-medium flex-1">
                {selectedWordIds.size} selected
              </span>
              {allSelectedAreDeleted ? (
                <button
                  type="button"
                  className="h-7 px-3 text-sm font-medium bg-white hover:bg-gray-100 text-foreground rounded-lg flex items-center transition-colors"
                  onClick={handleRestoreSelected}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  Restore
                </button>
              ) : (
                <button
                  type="button"
                  className="h-7 px-3 text-sm font-medium bg-white hover:bg-gray-100 text-foreground rounded-lg flex items-center transition-colors"
                  onClick={handleDeleteSelected}
                >
                  <Scissors className="w-3.5 h-3.5 mr-1.5" />
                  Cut
                </button>
              )}
              <button
                type="button"
                className="h-7 w-7 rounded-lg hover:bg-background/20 flex items-center justify-center text-sm transition-colors"
                onClick={() => setSelectedWordIds(new Set())}
              >
                ×
              </button>
            </div>
          ) : (
            // Default: Add clip button
            <Button
              variant="outline"
              className="w-full h-10 justify-center gap-2 border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 rounded-xl font-medium text-muted-foreground hover:text-primary transition-colors cursor-pointer"
              onClick={() => setShowUploadModal(true)}
            >
              <Plus className="w-4 h-4" />
              Add another clip
            </Button>
          )}
        </div>
      )}

      {/* Stats bar */}
      {unifiedTranscript.length > 0 && (
        <div className="flex-none px-3 py-2 border-t border-border bg-muted/30">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-3 text-muted-foreground">
              <span>{unifiedTranscript.filter((w) => !w.isDeleted).length} words</span>
              {unifiedTranscript.filter((w) => w.isDeleted).length > 0 && (
                <span className="text-red-500">{unifiedTranscript.filter((w) => w.isDeleted).length} cut</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-primary font-medium">
              <Clock className="w-3 h-3" />
              {formatDuration(getTotalDurationMs())}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
