import { useMemo, useState, useRef, useCallback } from "react";
import { Music, X, Volume2, GripVertical } from "lucide-react";
import useTranscriptStore from "../store/use-transcript-store";
import useStore from "../store/use-store";
import { cn } from "@/lib/utils";

interface MusicTrackProps {
  totalDurationMs: number; // Unified duration from parent Timeline
}

const MusicTrack = ({ totalDurationMs }: MusicTrackProps) => {
  const clips = useTranscriptStore((s) => s.clips);
  const getBackgroundMusicClips = useTranscriptStore((s) => s.getBackgroundMusicClips);
  const removeClip = useTranscriptStore((s) => s.removeClip);
  const setClipVolume = useTranscriptStore((s) => s.setClipVolume);
  const trimClip = useTranscriptStore((s) => s.trimClip);

  const musicClips = useMemo(() => getBackgroundMusicClips(), [clips]);
  // NOTE: totalDurationMs is now passed from parent Timeline as a prop
  // This ensures all tracks (overlay, transcript, music) use the same time base

  // Trim drag state
  const [dragging, setDragging] = useState<{
    clipId: string;
    edge: "start" | "end";
    initialTrimMs: number;
    initialMouseX: number;
  } | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // Calculate ms per pixel for dragging
  const getMsPerPixel = useCallback(() => {
    if (!trackRef.current || totalDurationMs <= 0) return 0;
    return totalDurationMs / trackRef.current.offsetWidth;
  }, [totalDurationMs]);

  // Handle trim drag start
  const handleTrimStart = useCallback((
    e: React.MouseEvent,
    clipId: string,
    edge: "start" | "end",
    currentTrimMs: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging({
      clipId,
      edge,
      initialTrimMs: currentTrimMs,
      initialMouseX: e.clientX,
    });
  }, []);

  // Handle trim drag
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;

    const msPerPixel = getMsPerPixel();
    if (msPerPixel <= 0) return;

    const deltaX = e.clientX - dragging.initialMouseX;
    const deltaMs = deltaX * msPerPixel;

    const clip = clips[dragging.clipId];
    if (!clip) return;

    const clipDuration = clip.durationMs || totalDurationMs;
    const currentStart = clip.trim?.startMs ?? 0;
    const currentEnd = clip.trim?.endMs ?? clipDuration;

    if (dragging.edge === "start") {
      const newStart = Math.max(0, Math.min(currentEnd - 500, dragging.initialTrimMs + deltaMs));
      trimClip(dragging.clipId, newStart, currentEnd);
    } else {
      const newEnd = Math.min(clipDuration, Math.max(currentStart + 500, dragging.initialTrimMs + deltaMs));
      trimClip(dragging.clipId, currentStart, newEnd);
    }
  }, [dragging, clips, totalDurationMs, getMsPerPixel, trimClip]);

  // Handle trim drag end
  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  // Don't render if no music
  if (musicClips.length === 0) return null;

  const { playerRef, fps, clearTimelineSelection } = useStore();

  return (
    <div
      className="flex items-center h-12 mb-2 cursor-pointer"
      onMouseMove={dragging ? handleMouseMove : undefined}
      onMouseUp={dragging ? handleMouseUp : undefined}
      onMouseLeave={dragging ? handleMouseUp : undefined}
      onClick={(e) => {
        // Handle clicks on margins/gaps
        const target = e.target as HTMLElement;
        if (dragging) return;
        if (target.closest('button')) return;
        if (target.closest('.trim-handle')) return;
        if (target.closest('input[type="range"]')) return;
        if (target.closest('.track-content')) return; // Let track-content handle its own clicks
        
        // Calculate time based on track-content position
        const trackContent = e.currentTarget.querySelector('.track-content') as HTMLElement;
        if (!trackContent || !playerRef?.current || totalDurationMs <= 0) return;
        
        const rect = trackContent.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const ratio = Math.max(0, Math.min(1, x / rect.width));
        const targetMs = ratio * totalDurationMs;
        const targetFrame = Math.round((targetMs / 1000) * fps);
        
        playerRef.current.seekTo(targetFrame);
        clearTimelineSelection();
      }}
    >
      {/* Track label */}
      <div className="hidden md:flex items-center gap-1.5 px-3 w-20 shrink-0 text-xs font-medium text-muted-foreground">
        <Music className="w-3.5 h-3.5" />
        <span className="truncate">Music</span>
      </div>

      {/* Track content */}
      <div className="flex-1 h-full py-1 px-2 md:px-0" ref={trackRef}>
        <div className="relative h-full w-full rounded-lg overflow-visible">
          {musicClips.map((clip) => {
            const clipDuration = clip.durationMs || totalDurationMs;
            const trimStart = clip.trim?.startMs ?? 0;
            const trimEnd = clip.trim?.endMs ?? clipDuration;
            const trimmedDuration = trimEnd - trimStart;

            // Position and width based on trim relative to total timeline
            const leftPercent = 0; // Music always starts at beginning (for now)
            const widthPercent = totalDurationMs > 0
              ? Math.min((trimmedDuration / totalDurationMs) * 100, 100)
              : 100;

            const volume = clip.volume ?? 0.12;
            const isDragging = dragging?.clipId === clip.clipId;

            // Format duration for display
            const formatTime = (ms: number) => {
              const secs = Math.floor(ms / 1000);
              const mins = Math.floor(secs / 60);
              const remainSecs = secs % 60;
              return `${mins}:${remainSecs.toString().padStart(2, "0")}`;
            };

            return (
              <div
                key={clip.clipId}
                className={cn(
                  "absolute top-0 h-full rounded-lg",
                  "bg-gradient-to-r from-purple-500 to-pink-500",
                  "flex items-center gap-1",
                  "border border-purple-400/50",
                  isDragging && "ring-2 ring-white/50"
                )}
                style={{
                  left: `${leftPercent}%`,
                  width: `${widthPercent}%`,
                  minWidth: 120,
                }}
              >
                {/* Left trim handle */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize flex items-center justify-center hover:bg-white/20 rounded-l-lg transition-colors group"
                  onMouseDown={(e) => handleTrimStart(e, clip.clipId, "start", trimStart)}
                >
                  <GripVertical className="w-3 h-3 text-white/50 group-hover:text-white/80" />
                </div>

                {/* Main content - centered between handles */}
                <div className="flex-1 flex items-center gap-2 px-4 min-w-0">
                  <Music className="w-3.5 h-3.5 text-white shrink-0" />
                  <span className="text-xs text-white font-medium truncate flex-1 min-w-0">
                    {clip.url.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Music'}
                  </span>

                  {/* Duration display */}
                  <span className="text-[10px] text-white/70 shrink-0">
                    {formatTime(trimmedDuration)}
                  </span>

                  {/* Volume slider */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Volume2 className="w-3 h-3 text-white/80" />
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round(volume * 100)}
                      onChange={(e) => {
                        e.stopPropagation();
                        setClipVolume(clip.clipId, parseInt(e.target.value) / 100);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-12 h-1 bg-white/30 rounded-full appearance-none cursor-pointer
                        [&::-webkit-slider-thumb]:appearance-none
                        [&::-webkit-slider-thumb]:w-2.5
                        [&::-webkit-slider-thumb]:h-2.5
                        [&::-webkit-slider-thumb]:rounded-full
                        [&::-webkit-slider-thumb]:bg-white
                        [&::-webkit-slider-thumb]:cursor-pointer
                        [&::-moz-range-thumb]:w-2.5
                        [&::-moz-range-thumb]:h-2.5
                        [&::-moz-range-thumb]:rounded-full
                        [&::-moz-range-thumb]:bg-white
                        [&::-moz-range-thumb]:border-0
                        [&::-moz-range-thumb]:cursor-pointer"
                    />
                    <span className="text-[10px] text-white/70 w-6">
                      {Math.round(volume * 100)}%
                    </span>
                  </div>

                  {/* Remove button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeClip(clip.clipId, "Removed by user");
                    }}
                    className="w-5 h-5 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center shrink-0 transition-colors"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>

                {/* Right trim handle */}
                <div
                  className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize flex items-center justify-center hover:bg-white/20 rounded-r-lg transition-colors group"
                  onMouseDown={(e) => handleTrimStart(e, clip.clipId, "end", trimEnd)}
                >
                  <GripVertical className="w-3 h-3 text-white/50 group-hover:text-white/80" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default MusicTrack;
