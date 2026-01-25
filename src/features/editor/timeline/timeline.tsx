import { useMemo, useCallback, useRef } from "react";
import Header from "./header";
import TranscriptClipsTrack from "./transcript-clips-track";
import MusicTrack from "./music-track";
import OverlayTracks from "./overlay-tracks";
import useTranscriptStore from "../store/use-transcript-store";
import useStore from "../store/use-store";
import { Film } from "lucide-react";

const Timeline = () => {
  const { playerRef, clearTimelineSelection, fps } = useStore();
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  
  // Check if we have transcript clips
  const clipOrder = useTranscriptStore((s) => s.clipOrder);
  const clips = useTranscriptStore((s) => s.clips);
  const getRenderSegments = useTranscriptStore((s) => s.getRenderSegments);
  const hasTranscriptClips = clipOrder.length > 0 && clipOrder.some(
    (id) => clips[id] !== undefined
  );

  // UNIFIED DURATION: Single source of truth for all tracks
  // This ensures overlay tracks and transcript clips track use the same time base
  const totalDurationMs = useMemo(() => {
    const clipDurations = new Map<string, number>();
    const renderSegments = getRenderSegments();

    // Build duration map from render segments (for ready clips)
    for (const segment of renderSegments) {
      const current = clipDurations.get(segment.clipId) || 0;
      clipDurations.set(segment.clipId, current + segment.durationMs);
    }

    // Sum up all clip durations (including placeholder for transcribing clips)
    let total = 0;
    for (const clipId of clipOrder) {
      const clip = clips[clipId];
      if (!clip) continue;

      // Ready clips: use calculated duration from render segments
      // Transcribing/pending clips: use 5000ms placeholder
      const durationMs = clip.status === "ready"
        ? (clipDurations.get(clipId) || 0)
        : 5000;

      if (clip.status === "ready" && durationMs <= 0) continue;
      total += durationMs;
    }

    return total;
  }, [clipOrder, clips, getRenderSegments]);

  // Handle click on Main label to seek to start (time 0)
  const handleMainLabelClick = useCallback(() => {
    if (!playerRef?.current) return;
    playerRef.current.seekTo(0);
    clearTimelineSelection();
  }, [playerRef, clearTimelineSelection]);

  // Handle click anywhere in timeline tracks area to seek
  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    // Don't interfere with clicks on interactive elements
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    if (target.closest('.trim-handle')) return;
    if (target.closest('[draggable]')) return;
    if (target.closest('.overlay-item')) return;
    if (target.closest('[data-delete-button]')) return;
    if (target.closest('input[type="range"]')) return;
    
    // Don't seek if clicking on track labels (they have their own handlers)
    const clickedLabel = target.closest('.cursor-pointer');
    if (clickedLabel && (clickedLabel.querySelector('svg') || clickedLabel.querySelector('span.truncate'))) {
      return; // Let label handler take over
    }

    // If clicking directly on track-content, let it handle its own click
    const clickedTrackContent = target.closest('.track-content');
    if (clickedTrackContent && target.closest('.track-content') === clickedTrackContent) {
      // Check if we're clicking on the actual content area (not a border/gap)
      const rect = clickedTrackContent.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // If click is within the track-content bounds, let it handle it
      if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
        return; // Let track-content handler take over
      }
    }
    
    if (!tracksContainerRef.current || !playerRef?.current || totalDurationMs <= 0) return;

    // Find the first track-content element to get the timeline width
    const firstTrackContent = tracksContainerRef.current.querySelector('.track-content') as HTMLElement;
    if (!firstTrackContent) return;

    const trackContentRect = firstTrackContent.getBoundingClientRect();
    const x = e.clientX - trackContentRect.left;
    const ratio = Math.max(0, Math.min(1, x / trackContentRect.width));
    const targetMs = ratio * totalDurationMs;
    const targetFrame = Math.round((targetMs / 1000) * fps);

    // Handle clicks on borders, margins, and gaps between tracks
    playerRef.current.seekTo(targetFrame);
    clearTimelineSelection();
  }, [playerRef, totalDurationMs, fps, clearTimelineSelection]);

  // Dot grid pattern for timeline editor aesthetic
  const dotGridStyle = {
    backgroundColor: '#e5e5e5',
    backgroundImage: `radial-gradient(circle, #c4c4c4 1px, transparent 1px)`,
    backgroundSize: '12px 12px',
  };

  return (
    <div data-timeline className="h-full w-full flex flex-col border-t border-border" style={dotGridStyle}>
      {/* Play controls + time */}
      <Header />

      {/* Timeline tracks area */}
      <div 
        ref={tracksContainerRef}
        className="flex-1 overflow-hidden flex flex-col cursor-pointer"
        onClick={handleTimelineClick}
      >
        {hasTranscriptClips ? (
          <>
            {/* Overlay tracks (B-roll, text, etc.) - auto-expand when items exist */}
            <OverlayTracks totalDurationMs={totalDurationMs} />

            {/* Main video track with integrated playhead */}
            <div 
              className="flex items-center flex-1 min-h-[50px] md:min-h-[60px] mb-2 md:mb-4 cursor-pointer"
              onClick={(e) => {
                // Handle clicks on margins/gaps below main track
                const target = e.target as HTMLElement;
                if (target.closest('button')) return;
                if (target.closest('.trim-handle')) return;
                if (target.closest('[draggable]')) return;
                if (target.closest('.track-content')) return; // Let track-content handle its own clicks
                if (target.closest('.cursor-pointer')?.querySelector('svg, span.truncate')) return; // Let label handle its own clicks
                
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
              {/* Track label - hidden on mobile for more space */}
              <div 
                className="hidden md:flex items-center gap-1.5 px-3 w-20 shrink-0 text-xs font-medium text-muted-foreground cursor-pointer hover:opacity-80 transition-opacity"
                onClick={handleMainLabelClick}
              >
                <Film className="w-3.5 h-3.5" />
                <span className="truncate">Main</span>
              </div>

              {/* Track content - full width on mobile */}
              <div className="flex-1 h-full py-1 px-2 md:px-0">
                <TranscriptClipsTrack totalDurationMs={totalDurationMs} />
              </div>
            </div>

            {/* Music track - shows background music clips */}
            <MusicTrack totalDurationMs={totalDurationMs} />
          </>
        ) : (
          <div className="h-full flex items-center justify-center px-4">
            <span className="text-xs md:text-sm text-muted-foreground px-3 md:px-4 py-2 rounded-xl bg-white shadow-sm border border-border text-center">
              Upload a video to get started
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default Timeline;
