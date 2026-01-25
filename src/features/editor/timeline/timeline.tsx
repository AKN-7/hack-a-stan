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
  const hasTranscriptClips = clipOrder.length > 0 && clipOrder.some(
    (id) => clips[id] !== undefined
  );

  return (
    <div className="bg-gradient-to-b from-muted to-background h-full w-full flex flex-col border-t border-border">
      {/* Play controls + time */}
      <Header />

      {/* Timeline tracks area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {hasTranscriptClips ? (
          <>
            {/* Overlay tracks (B-roll, text, etc.) - auto-expand when items exist */}
            <OverlayTracks />

            {/* Main video track with integrated playhead */}
            <div className="flex items-center flex-1 min-h-[50px] md:min-h-[60px] mb-2 md:mb-4">
              {/* Track label - hidden on mobile for more space */}
              <div className="hidden md:flex items-center gap-1.5 px-3 w-20 shrink-0 text-xs font-medium text-muted-foreground">
                <Film className="w-3.5 h-3.5" />
                <span className="truncate">Main</span>
              </div>

              {/* Track content - full width on mobile */}
              <div className="flex-1 h-full py-1 px-2 md:px-0">
                <TranscriptClipsTrack />
              </div>
            </div>

            {/* Music track - shows background music clips */}
            <MusicTrack />
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
