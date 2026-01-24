import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { Film, Trash2, GripHorizontal, Loader2, Scissors } from "lucide-react";
import useTranscriptStore from "../store/use-transcript-store";
import useStore from "../store/use-store";
import { useCurrentPlayerFrame } from "../hooks/use-current-frame";
import { cn } from "@/lib/utils";

// Clip color palette - matching transcript panel
const CLIP_STYLES = [
  { gradient: "from-blue-500 to-blue-600", text: "text-white", badge: "bg-blue-400/30" },
  { gradient: "from-violet-500 to-violet-600", text: "text-white", badge: "bg-violet-400/30" },
  { gradient: "from-amber-500 to-amber-600", text: "text-white", badge: "bg-amber-400/30" },
  { gradient: "from-emerald-500 to-emerald-600", text: "text-white", badge: "bg-emerald-400/30" },
  { gradient: "from-pink-500 to-pink-600", text: "text-white", badge: "bg-pink-400/30" },
  { gradient: "from-cyan-500 to-cyan-600", text: "text-white", badge: "bg-cyan-400/30" },
];

const getClipStyle = (index: number) => CLIP_STYLES[index % CLIP_STYLES.length];

interface ClipBlock {
  clipId: string;
  durationMs: number;
  offsetMs: number;
  status: "pending" | "transcribing" | "ready" | "error";
  trimStartMs: number;
  trimEndMs: number;
  fullDurationMs: number;
}

type TrimSide = "left" | "right" | null;

const TranscriptClipsTrack = () => {
  const { clips, clipOrder, reorderClips, removeClip, trimClip } = useTranscriptStore();
  const getRenderSegments = useTranscriptStore(s => s.getRenderSegments);
  const { fps, playerRef } = useStore();
  const currentFrame = useCurrentPlayerFrame(playerRef);

  const trackRef = useRef<HTMLDivElement>(null);

  // Drag state for reordering
  const [draggedClipId, setDraggedClipId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragStartIndexRef = useRef<number | null>(null);

  // Trim state
  const [trimmingClipId, setTrimmingClipId] = useState<string | null>(null);
  const [trimSide, setTrimSide] = useState<TrimSide>(null);
  const trimStartRef = useRef<{
    startX: number;
    originalTrimStart: number;
    originalTrimEnd: number;
    fullDuration: number;
    trackWidth: number;
    totalDurationMs: number;
  } | null>(null);

  // Get full clip duration (before any trim)
  const getFullClipDuration = useCallback((clipId: string) => {
    const clip = clips[clipId];
    if (!clip || clip.words.length === 0) return 0;
    const activeWords = clip.words.filter(w => !w.isDeleted);
    if (activeWords.length === 0) return 0;
    const firstWord = activeWords[0];
    const lastWord = activeWords[activeWords.length - 1];
    return lastWord.endMs - firstWord.startMs;
  }, [clips]);

  // Calculate clip blocks
  const clipBlocks = useMemo((): ClipBlock[] => {
    const blocks: ClipBlock[] = [];
    let offsetMs = 0;

    const clipDurations = new Map<string, number>();
    const renderSegments = getRenderSegments();

    for (const segment of renderSegments) {
      const current = clipDurations.get(segment.clipId) || 0;
      clipDurations.set(segment.clipId, current + segment.durationMs);
    }

    for (const clipId of clipOrder) {
      const clip = clips[clipId];
      if (!clip) continue;

      const fullDurationMs = getFullClipDuration(clipId);
      const durationMs = clip.status === "ready"
        ? (clipDurations.get(clipId) || 0)
        : 5000;

      if (clip.status === "ready" && durationMs <= 0) continue;

      blocks.push({
        clipId,
        durationMs,
        offsetMs,
        status: clip.status,
        trimStartMs: clip.trim?.startMs ?? 0,
        trimEndMs: clip.trim?.endMs ?? fullDurationMs,
        fullDurationMs,
      });

      offsetMs += durationMs;
    }

    return blocks;
  }, [clipOrder, clips, getRenderSegments, getFullClipDuration]);

  // Compute total duration from clip blocks (already reactive)
  const totalDurationMs = useMemo(() => {
    return clipBlocks.reduce((sum, block) => sum + block.durationMs, 0);
  }, [clipBlocks]);

  // Playhead position
  const currentTimeMs = (currentFrame / fps) * 1000;
  const playheadPercent = totalDurationMs > 0
    ? Math.min((currentTimeMs / totalDurationMs) * 100, 100)
    : 0;

  // Click to seek
  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    if (!trackRef.current || !playerRef?.current || totalDurationMs <= 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    if ((e.target as HTMLElement).closest('.trim-handle')) return;
    if (draggedClipId || trimmingClipId) return;

    const rect = trackRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const targetMs = ratio * totalDurationMs;
    const targetFrame = Math.round((targetMs / 1000) * fps);

    playerRef.current.seekTo(targetFrame);
  }, [playerRef, totalDurationMs, fps, draggedClipId, trimmingClipId]);

  // Trim handlers
  const handleTrimStart = (e: React.MouseEvent, clipId: string, side: TrimSide, block: ClipBlock) => {
    e.preventDefault();
    e.stopPropagation();

    if (!trackRef.current) return;

    setTrimmingClipId(clipId);
    setTrimSide(side);
    trimStartRef.current = {
      startX: e.clientX,
      originalTrimStart: block.trimStartMs,
      originalTrimEnd: block.trimEndMs === Infinity ? block.fullDurationMs : block.trimEndMs,
      fullDuration: block.fullDurationMs,
      trackWidth: trackRef.current.clientWidth,
      totalDurationMs,
    };
  };

  // Throttle ref for trim updates (every 50ms)
  const lastTrimUpdateRef = useRef<number>(0);

  useEffect(() => {
    if (!trimmingClipId || !trimSide) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!trimStartRef.current) return;

      const { startX, originalTrimStart, originalTrimEnd, fullDuration, trackWidth, totalDurationMs } = trimStartRef.current;

      // Guard against division by zero
      if (trackWidth <= 0 || totalDurationMs <= 0) return;

      // Throttle updates to every 50ms for better performance
      const now = Date.now();
      if (now - lastTrimUpdateRef.current < 50) return;
      lastTrimUpdateRef.current = now;

      const deltaX = e.clientX - startX;

      // Convert pixel delta to ms delta based on track width and total duration
      const deltaMs = (deltaX / trackWidth) * totalDurationMs;

      if (trimSide === "left") {
        const newTrimStart = Math.max(0, Math.min(originalTrimEnd - 500, originalTrimStart + deltaMs));
        trimClip(trimmingClipId, newTrimStart, originalTrimEnd);
      } else if (trimSide === "right") {
        const newTrimEnd = Math.max(originalTrimStart + 500, Math.min(fullDuration, originalTrimEnd + deltaMs));
        trimClip(trimmingClipId, originalTrimStart, newTrimEnd);
      }
    };

    const handleMouseUp = () => {
      setTrimmingClipId(null);
      setTrimSide(null);
      trimStartRef.current = null;
      // Seek to start to avoid buffering lag after trim
      if (playerRef?.current) {
        playerRef.current.seekTo(0);
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [trimmingClipId, trimSide, trimClip]);

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, clipId: string, index: number) => {
    if (trimmingClipId) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", clipId);
    setDraggedClipId(clipId);
    dragStartIndexRef.current = index;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const clipId = e.dataTransfer.getData("text/plain");
    const sourceIndex = dragStartIndexRef.current;

    if (sourceIndex !== null && sourceIndex !== targetIndex && clipId) {
      const newOrder = [...clipOrder];
      newOrder.splice(sourceIndex, 1);
      // Adjust targetIndex if source was before target (indices shifted after splice)
      const adjustedTarget = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      newOrder.splice(adjustedTarget, 0, clipId);
      reorderClips(newOrder);
    }

    setDraggedClipId(null);
    setDragOverIndex(null);
    dragStartIndexRef.current = null;
  };

  const handleDragEnd = () => {
    setDraggedClipId(null);
    setDragOverIndex(null);
    dragStartIndexRef.current = null;
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (minutes > 0) {
      return `${minutes}:${secs.toString().padStart(2, "0")}`;
    }
    return `${secs}s`;
  };

  const formatTrimmed = (ms: number) => {
    const seconds = (ms / 1000).toFixed(1);
    return `${seconds}s`;
  };

  // Reset trim to full duration
  const handleResetTrim = (e: React.MouseEvent, clipId: string, fullDurationMs: number) => {
    e.stopPropagation();
    trimClip(clipId, 0, fullDurationMs);
    // Seek to start to avoid buffering lag
    if (playerRef?.current) {
      playerRef.current.seekTo(0);
    }
  };

  if (clipBlocks.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <span className="px-4 py-2 rounded-xl bg-muted">No clips yet</span>
      </div>
    );
  }

  return (
    <div
      ref={trackRef}
      className="h-full flex items-center gap-2 relative cursor-pointer bg-muted/30"
      onClick={handleTrackClick}
    >
      {/* Playhead */}
      {totalDurationMs > 0 && (
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-primary z-20 pointer-events-none"
          style={{ left: `${playheadPercent}%` }}
        />
      )}

      {/* Clips */}
      {clipBlocks.map((block, index) => {
        const isDragging = draggedClipId === block.clipId;
        const isDropTarget = dragOverIndex === index && draggedClipId !== block.clipId;
        const isTranscribing = block.status === "transcribing" || block.status === "pending";
        const hasError = block.status === "error";
        const isReady = block.status === "ready";
        const isTrimming = trimmingClipId === block.clipId;

        const widthPercent = totalDurationMs > 0
          ? (block.durationMs / totalDurationMs) * 100
          : 100 / clipBlocks.length;

        const isTrimmed = block.fullDurationMs > block.durationMs;
        const style = getClipStyle(index);

        return (
          <div
            key={block.clipId}
            className={cn(
              "relative h-14 rounded-2xl flex items-center transition-all duration-200 ease-out",
              isReady && !isTrimming ? "cursor-grab active:cursor-grabbing active:scale-[0.98]" : "cursor-default",
              isDragging
                ? "opacity-50 scale-95 border-2 border-dashed border-muted-foreground/40 bg-muted"
                : isTranscribing
                ? "bg-gradient-to-r from-amber-100 to-yellow-100 border-2 border-amber-200"
                : hasError
                ? "bg-gradient-to-r from-red-100 to-red-50 border-2 border-red-200"
                : isTrimming
                ? cn("bg-gradient-to-r", style.gradient, "ring-2 ring-white/80")
                : cn("bg-gradient-to-r", style.gradient, "hover:scale-[1.02] hover:brightness-105"),
              isDropTarget && "ring-2 ring-primary ring-offset-2 ring-offset-background"
            )}
            style={{
              width: `${Math.max(12, widthPercent)}%`,
              minWidth: "120px",
            }}
            draggable={isReady && !isTrimming}
            onDragStart={(e) => handleDragStart(e, block.clipId, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={() => setDragOverIndex(null)}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
          >
            {/* Left trim handle */}
            {isReady && (
              <div
                className={cn(
                  "absolute left-1 top-2 bottom-2 w-1.5 rounded-full cursor-ew-resize z-10 transition-all duration-150",
                  isTrimming && trimSide === "left"
                    ? "bg-white shadow-lg"
                    : "bg-white/30 hover:bg-white hover:shadow-md"
                )}
                onMouseDown={(e) => handleTrimStart(e, block.clipId, "left", block)}
              />
            )}

            {/* Content */}
            <div className="flex items-center gap-3 px-4 flex-1 min-w-0">
              {isTranscribing ? (
                <div className="p-1.5 rounded-lg bg-amber-200">
                  <Loader2 className="w-4 h-4 text-amber-600 animate-spin" />
                </div>
              ) : hasError ? (
                <div className="p-1.5 rounded-lg bg-red-200">
                  <Film className="w-4 h-4 text-red-600" />
                </div>
              ) : (
                <div className={cn("p-1.5 rounded-lg", style.badge)}>
                  <Film className="w-4 h-4 text-white" />
                </div>
              )}

              <div className="flex flex-col min-w-0 flex-1">
                <span className={cn(
                  "text-sm truncate font-semibold tracking-tight",
                  isTranscribing ? "text-amber-700" : hasError ? "text-red-700" : "text-white"
                )}>
                  {isTranscribing ? "Transcribing..." : hasError ? "Error" : `Clip ${index + 1}`}
                </span>
                {isReady && (
                  <span className="text-xs text-white/70 font-medium">
                    {formatDuration(block.durationMs)}
                  </span>
                )}
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeClip(block.clipId);
                }}
                className={cn(
                  "p-1.5 rounded-lg transition-all",
                  isTranscribing || hasError
                    ? "hover:bg-black/10 text-current opacity-50 hover:opacity-100"
                    : "hover:bg-white/20 text-white/50 hover:text-white"
                )}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Right trim handle */}
            {isReady && (
              <div
                className={cn(
                  "absolute right-1 top-2 bottom-2 w-1.5 rounded-full cursor-ew-resize z-10 transition-all duration-150",
                  isTrimming && trimSide === "right"
                    ? "bg-white shadow-lg"
                    : "bg-white/30 hover:bg-white hover:shadow-md"
                )}
                onMouseDown={(e) => handleTrimStart(e, block.clipId, "right", block)}
              />
            )}

            {/* Trim indicator badge - inside clip, top-right */}
            {isReady && isTrimmed && (
              <button
                onClick={(e) => handleResetTrim(e, block.clipId, block.fullDurationMs)}
                className="absolute top-1.5 right-8 z-20 flex items-center gap-1 px-1.5 py-0.5
                  bg-white/90 backdrop-blur-sm text-foreground text-[10px] font-semibold rounded-md
                  shadow-sm border border-white/50
                  transition-colors duration-100 cursor-pointer
                  hover:bg-white"
                title="Click to restore full clip"
              >
                <Scissors className="w-2.5 h-2.5" />
                <span>-{formatTrimmed(block.fullDurationMs - block.durationMs)}</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default TranscriptClipsTrack;
