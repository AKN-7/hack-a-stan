import { useCallback, useState, useRef, useEffect } from "react";
import { dispatch } from "@designcombo/events";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Trash2,
  RotateCcw,
  FileText,
  AlertCircle,
  Clock,
  ChevronUp,
  ChevronDown,
  Film,
  Plus,
  Upload,
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

// Format milliseconds to mm:ss
const formatDuration = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export const Transcript = () => {
  const {
    clips,
    clipOrder,
    getUnifiedTranscript,
    deleteWords,
    restoreAllWords,
    getTotalDurationMs,
    getRenderSegments,
    getWordAtTime,
    reorderClips,
    removeClip,
    restoreClip,
  } = useTranscriptStore();
  const [currentWordId, setCurrentWordId] = useState<string | null>(null);

  const { playerRef, fps } = useStore();
  const { setShowUploadModal, activeUploads } = useUploadStore();

  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const selectionStartRef = useRef<string | null>(null);
  const wordRefs = useRef<Map<string, HTMLSpanElement>>(new Map());

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

  // Handle restore all
  const handleRestoreAll = useCallback(() => {
    restoreAllWords();
    setSelectedWordIds(new Set());
    seekToStart();
  }, [restoreAllWords, seekToStart]);

  // Check if any words are deleted
  const hasDeletedWords = unifiedTranscript.some((w) => w.isDeleted);

  return (
    <div className="flex flex-1 flex-col h-full bg-white">
      <ModalUpload />
      {/* Header */}
      <div className="flex h-14 flex-none items-center justify-between px-4 border-b border-border">
        <span className="text-base font-semibold text-foreground">Transcript</span>
        <div className="flex items-center gap-2">
          {selectedWordIds.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDeleteSelected}
              className="h-8 px-3 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg font-medium"
            >
              <Trash2 className="w-4 h-4 mr-1.5" />
              Delete ({selectedWordIds.size})
            </Button>
          )}
          {hasDeletedWords && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRestoreAll}
              className="h-8 px-3 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg font-medium"
            >
              <RotateCcw className="w-4 h-4 mr-1.5" />
              Restore
            </Button>
          )}
        </div>
      </div>

      {/* Status Section */}
      {(activeUploads.some(u => u.status === "uploading") ||
        transcribingClips.length > 0 ||
        pendingClips.length > 0 ||
        errorClips.length > 0) && (
        <div className="px-4 py-3 space-y-2 bg-muted/50">
          {/* Uploading files */}
          {activeUploads.filter(u => u.status === "uploading").length > 0 && (
            <div className="space-y-2">
              {activeUploads
                .filter(u => u.status === "uploading")
                .map((upload) => (
                <div key={upload.id} className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-blue-50 border border-blue-100">
                  <div className="flex items-center gap-2">
                    <Upload className="w-3.5 h-3.5 text-blue-600" />
                    <span className="text-sm font-medium text-blue-700 truncate flex-1">
                      {upload.file?.name || "Uploading..."}
                    </span>
                    <span className="text-xs font-semibold text-blue-600">
                      {upload.progress || 0}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-blue-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${upload.progress || 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          {transcribingClips.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="font-medium">Transcribing {transcribingClips.length} clip(s)...</span>
              </div>
            </div>
          )}
          {pendingClips.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="w-4 h-4" />
              {pendingClips.length} clip(s) waiting...
            </div>
          )}
          {errorClips.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-red-50 text-red-600">
                <AlertCircle className="w-3.5 h-3.5" />
                <span className="font-medium">{errorClips.length} clip(s) failed</span>
              </div>
            </div>
          )}
        </div>
      )}

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

      {/* Transcript Content - Clips as Separate Sections */}
      {clipOrder.length > 0 && clipOrder.some(id => clips[id]?.status === "ready") && (
        <div className="flex-1 overflow-y-auto">
          <p className="text-xs text-muted-foreground px-4 py-3 bg-muted/30">
            Click to seek. Select words and press Delete to cut.
          </p>

          {clipOrder.map((clipId, index) => {
            const clip = clips[clipId];
            if (!clip || clip.status !== "ready") return null;

            const clipWords = clip.words;
            const activeWordCount = clipWords.filter(w => !w.isDeleted).length;
            const clipDurationMs = clipWords.filter(w => !w.isDeleted).reduce((sum, w) => {
              return sum + (w.endMs - w.startMs);
            }, 0);

            const color = getClipColor(index);
            const isClipDeleted = clip.isDeleted;

            return (
              <div key={clipId} className={cn(
                "border-b border-border last:border-b-0 transition-all duration-300",
                isClipDeleted && "opacity-60 bg-red-50/50"
              )}>
                {/* Clip Header */}
                <div className={cn(
                  "flex items-center gap-3 px-4 py-3 sticky top-0 z-10 border-b border-border/50",
                  isClipDeleted ? "bg-red-50" : "bg-white"
                )}>
                  {/* Color indicator dot */}
                  <div className={cn(
                    "w-3 h-3 rounded-full shadow-sm",
                    isClipDeleted ? "bg-red-400" : color.bg
                  )} />

                  <span className={cn(
                    "text-sm font-semibold flex-1",
                    isClipDeleted ? "text-red-700 line-through" : "text-foreground"
                  )}>
                    Clip {index + 1}
                    {isClipDeleted && (
                      <span className="ml-2 text-xs font-normal text-red-500 no-underline">
                        (removed)
                      </span>
                    )}
                  </span>

                  {!isClipDeleted && (
                    <span className={cn(
                      "text-xs font-medium px-2 py-0.5 rounded-md",
                      color.light, color.text
                    )}>
                      {formatDuration(clipDurationMs)}
                    </span>
                  )}

                  {/* Restore button for deleted clips */}
                  {isClipDeleted ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-3 text-xs font-medium text-green-600 hover:text-green-700 hover:bg-green-50 rounded-lg"
                      onClick={() => restoreClip(clipId)}
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                      Restore
                    </Button>
                  ) : (
                    /* Reorder Buttons */
                    <div className="flex gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-lg hover:bg-muted"
                        disabled={index === 0}
                        onClick={() => {
                          const newOrder = [...clipOrder];
                          [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
                          reorderClips(newOrder);
                        }}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-lg hover:bg-muted"
                        disabled={index === clipOrder.length - 1}
                        onClick={() => {
                          const newOrder = [...clipOrder];
                          [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
                          reorderClips(newOrder);
                        }}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50"
                        onClick={() => removeClip(clipId)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>

                {/* Delete reason if available */}
                {isClipDeleted && clip.deleteReason && (
                  <div className="px-4 py-2 bg-red-50 border-b border-red-100">
                    <p className="text-xs text-red-600 italic">
                      {clip.deleteReason}
                    </p>
                  </div>
                )}

                {/* Clip Words */}
                <div className={cn(
                  "px-4 py-3 select-none",
                  isClipDeleted && "pointer-events-none"
                )}>
                  <p className={cn(
                    "text-sm leading-8",
                    isClipDeleted && "line-through text-red-700/70"
                  )} style={{ wordWrap: "break-word", overflowWrap: "break-word" }}>
                    {clipWords.map((word) => (
                      <span
                        key={word.id}
                        ref={(el) => {
                          if (el) wordRefs.current.set(word.id, el);
                        }}
                        onClick={(e) => !isClipDeleted && handleWordClick(word, e)}
                        className={cn(
                          "rounded px-0.5 py-0.5 transition-colors duration-100 inline",
                          isClipDeleted
                            ? "cursor-default"
                            : "cursor-pointer",
                          !isClipDeleted && word.isDeleted
                            ? "line-through opacity-50 bg-red-100 text-red-700"
                            : !isClipDeleted && currentWordId === word.id
                            ? "bg-primary text-white font-medium"
                            : !isClipDeleted && selectedWordIds.has(word.id)
                            ? cn(color.light, color.text, "font-medium")
                            : !isClipDeleted && "hover:bg-muted"
                        )}
                      >
                        {word.text}{" "}
                      </span>
                    ))}
                  </p>
                </div>
              </div>
            );
          })}

          {/* Add clip button */}
          <div className="p-4">
            <Button
              variant="outline"
              size="sm"
              className="w-full h-10 justify-center gap-2 border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 rounded-xl font-medium text-muted-foreground hover:text-primary transition-colors cursor-pointer"
              onClick={() => setShowUploadModal(true)}
            >
              <Plus className="w-4 h-4" />
              Add another clip
            </Button>
          </div>
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

      {/* Stats footer */}
      {unifiedTranscript.length > 0 && (
        <div className="px-4 py-3 border-t border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="font-medium">
                {unifiedTranscript.filter((w) => !w.isDeleted).length} words
              </span>
              {unifiedTranscript.filter((w) => w.isDeleted).length > 0 && (
                <span className="text-red-500">
                  {unifiedTranscript.filter((w) => w.isDeleted).length} cut
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 text-primary">
              <Clock className="w-3.5 h-3.5" />
              <span className="text-sm font-semibold">
                {formatDuration(getTotalDurationMs())}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
