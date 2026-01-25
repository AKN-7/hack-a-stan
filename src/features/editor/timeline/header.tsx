import { Button } from "@/components/ui/button";
import { dispatch } from "@designcombo/events";
import { PLAYER_PAUSE, PLAYER_PLAY } from "../constants/events";
import { frameToTimeString, timeToString } from "../utils/time";
import useStore from "../store/use-store";
import useTranscriptStore from "../store/use-transcript-store";
import { useCurrentPlayerFrame } from "../hooks/use-current-frame";
import { useEffect, useState, useMemo } from "react";
import { useIsMobile } from "@/hooks/use-media-query";

const IconPlayerPlayFilled = ({ size }: { size: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z" />
  </svg>
);

const IconPlayerPauseFilled = ({ size }: { size: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M9 4h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2z" />
    <path d="M17 4h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2z" />
  </svg>
);

const IconPlayerSkipBack = ({ size }: { size: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M20 5v14l-12 -7z" />
    <path d="M4 5l0 14" />
  </svg>
);

const IconPlayerSkipForward = ({ size }: { size: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M4 5v14l12 -7z" />
    <path d="M20 5l0 14" />
  </svg>
);

const Header = () => {
  const [playing, setPlaying] = useState(false);
  const isMobile = useIsMobile();
  const { fps, playerRef, duration: storeDurationMs } = useStore();

  // Subscribe to clips and clipOrder to trigger re-renders when they change
  const clips = useTranscriptStore((s) => s.clips);
  const clipOrder = useTranscriptStore((s) => s.clipOrder);
  const getTotalDurationMs = useTranscriptStore((s) => s.getTotalDurationMs);

  const currentFrame = useCurrentPlayerFrame(playerRef);

  // Get duration in milliseconds - prefer transcript duration, fallback to store duration
  // Store duration is synced by player.tsx when transcript is ready
  const durationMs = useMemo(() => {
    const transcriptDurationMs = getTotalDurationMs();
    // Use transcript duration if available (already edited)
    if (transcriptDurationMs > 0) {
      return transcriptDurationMs;
    }
    // Fallback to store duration (synced by player, in ms)
    return storeDurationMs;
  }, [clips, clipOrder, getTotalDurationMs, storeDurationMs]);

  // Duration in seconds for frame calculations
  const duration = durationMs / 1000;

  const handlePlay = () => {
    dispatch(PLAYER_PLAY);
  };

  const handlePause = () => {
    dispatch(PLAYER_PAUSE);
  };

  const handleSkipBack = () => {
    playerRef?.current?.seekTo(0);
  };

  const handleSkipForward = () => {
    const totalFrames = Math.ceil(duration * fps);
    playerRef?.current?.seekTo(totalFrames);
  };

  useEffect(() => {
    const player = playerRef?.current;
    if (!player) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);

    return () => {
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
    };
  }, [playerRef]);

  return (
    <div className={`h-12 md:h-14 flex items-center bg-white border-b border-border px-3 md:px-4 ${
      isMobile ? 'justify-between' : 'justify-center gap-3'
    }`}>
      {/* Time display - left on mobile, after controls on desktop */}
      {isMobile && (
        <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-muted font-mono">
          <span className="text-sm text-foreground font-semibold tabular-nums">
            {frameToTimeString({ frame: currentFrame }, { fps })}
          </span>
          <span className="text-sm text-muted-foreground">/</span>
          <span className="text-sm text-muted-foreground tabular-nums">
            {timeToString({ time: durationMs })}
          </span>
        </div>
      )}

      {/* Play controls */}
      <div className={`flex items-center ${isMobile ? 'gap-1' : 'gap-1 p-1 rounded-xl bg-muted'}`}>
        <Button
          onClick={handleSkipBack}
          variant="ghost"
          size="icon"
          className={`rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground ${
            isMobile ? 'h-10 w-10' : 'h-8 w-8 hover:bg-white'
          }`}
        >
          <IconPlayerSkipBack size={isMobile ? 18 : 16} />
        </Button>

        <Button
          onClick={() => (playing ? handlePause() : handlePlay())}
          size="icon"
          className={`bg-primary hover:bg-primary/90 text-white shadow-md shadow-primary/25 ${
            isMobile ? 'h-11 w-11 rounded-xl' : 'h-10 w-10 rounded-xl'
          }`}
        >
          {playing ? (
            <IconPlayerPauseFilled size={isMobile ? 20 : 18} />
          ) : (
            <IconPlayerPlayFilled size={isMobile ? 20 : 18} />
          )}
        </Button>

        <Button
          onClick={handleSkipForward}
          variant="ghost"
          size="icon"
          className={`rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground ${
            isMobile ? 'h-10 w-10' : 'h-8 w-8 hover:bg-white'
          }`}
        >
          <IconPlayerSkipForward size={isMobile ? 18 : 16} />
        </Button>
      </div>

      {/* Time display - desktop only (after controls) */}
      {!isMobile && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-sm font-mono">
          <span className="text-foreground font-semibold">
            {frameToTimeString({ frame: currentFrame }, { fps })}
          </span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground">
            {timeToString({ time: durationMs })}
          </span>
        </div>
      )}
    </div>
  );
};

export default Header;
