import { useMemo } from "react";
import Header from "./header";
import TranscriptClipsTrack from "./transcript-clips-track";
import MusicTrack from "./music-track";
import OverlayTracks from "./overlay-tracks";
import useTranscriptStore from "../store/use-transcript-store";
import { Film } from "lucide-react";

const Timeline = () => {
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
      <div className="flex-1 overflow-hidden flex flex-col">
        {hasTranscriptClips ? (
          <>
            {/* Overlay tracks (B-roll, text, etc.) - auto-expand when items exist */}
            <OverlayTracks totalDurationMs={totalDurationMs} />

            {/* Main video track with integrated playhead */}
            <div className="flex items-center flex-1 min-h-[50px] md:min-h-[60px] mb-2 md:mb-4">
              {/* Track label - hidden on mobile for more space */}
              <div className="hidden md:flex items-center gap-1.5 px-3 w-20 shrink-0 text-xs font-medium text-muted-foreground">
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
