import { useEffect, useRef, useMemo } from "react";
import Composition from "./composition";
import { Player as RemotionPlayer, PlayerRef } from "@remotion/player";
import useStore from "../store/use-store";
import useTranscriptStore from "../store/use-transcript-store";

const Player = () => {
  const playerRef = useRef<PlayerRef>(null);
  const { setPlayerRef, setState, duration, fps, size, background } = useStore();

  // Subscribe to actual state to trigger re-renders when transcription completes
  const clips = useTranscriptStore((state) => state.clips);
  const clipOrder = useTranscriptStore((state) => state.clipOrder);
  const getTotalDurationMs = useTranscriptStore((state) => state.getTotalDurationMs);
  const getRenderSegments = useTranscriptStore((state) => state.getRenderSegments);

  // Use transcript duration if available, otherwise fall back to timeline duration
  const effectiveDuration = useMemo(() => {
    const transcriptDuration = getTotalDurationMs();
    const renderSegments = getRenderSegments();

    // If we have transcript data, use transcript duration
    if (renderSegments.length > 0 && transcriptDuration > 0) {
      return transcriptDuration;
    }

    // Otherwise use timeline duration, with fallback to 1 second minimum
    return duration || 1000;
  }, [clips, clipOrder, getTotalDurationMs, getRenderSegments, duration]);

  // Use ceil to ensure we have enough frames for all content (avoid cutting off last segment)
  // Ensure we always have at least 1 frame and handle NaN/undefined
  const rawFrames = (effectiveDuration / 1000) * fps;
  const durationInFrames = Math.max(1, Math.ceil(Number.isFinite(rawFrames) ? rawFrames : 30));

  useEffect(() => {
    setPlayerRef(playerRef as React.RefObject<PlayerRef>);
  }, []);

  // Sync transcript duration to DesignCombo store so timeline UI matches
  useEffect(() => {
    const transcriptDuration = getTotalDurationMs();
    const renderSegments = getRenderSegments();

    if (renderSegments.length > 0 && transcriptDuration > 0) {
      // Update the main store's duration to match transcript
      setState({ duration: transcriptDuration });
    }
  }, [clips, clipOrder, getTotalDurationMs, getRenderSegments, setState]);

  return (
    <RemotionPlayer
      ref={playerRef}
      component={Composition}
      durationInFrames={durationInFrames}
      compositionWidth={size.width}
      compositionHeight={size.height}
      className={`h-full w-full bg-[${background.value}]`}
      fps={30}
      overflowVisible
    />
  );
};
export default Player;
