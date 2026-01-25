import { useMemo } from "react";
import { AbsoluteFill, Sequence, OffthreadVideo, useCurrentFrame } from "remotion";
import useTranscriptStore from "../store/use-transcript-store";
import useStore from "../store/use-store";
import { calculateSegmentFrames } from "../utils/segment-frames";

interface TranscriptCompositionProps {
  // Whether to show captions overlay
  showCaptions?: boolean;
}

/**
 * TranscriptComposition renders video based on transcript keep segments.
 * This is the core of transcript-driven editing - the video plays only
 * the parts where speech exists, automatically cutting silence and
 * deleted words.
 *
 * NOTE: Zoom transitions have been REMOVED as they were causing perceived
 * shakiness due to alternating scale values between segments.
 */
const TranscriptComposition = ({ showCaptions = false }: TranscriptCompositionProps) => {
  const { fps, size } = useStore();
  const frame = useCurrentFrame();

  // Subscribe to transcript store state for reactivity
  const clips = useTranscriptStore((state) => state.clips);
  const clipOrder = useTranscriptStore((state) => state.clipOrder);
  const getRenderSegments = useTranscriptStore((state) => state.getRenderSegments);
  const getCaptionsForRender = useTranscriptStore((state) => state.getCaptionsForRender);

  // Memoize render segments to avoid recalculating on every frame
  const renderSegments = useMemo(
    () => getRenderSegments(),
    [clips, clipOrder, getRenderSegments]
  );

  // Memoize captions
  const captions = useMemo(
    () => getCaptionsForRender(),
    [clips, clipOrder, getCaptionsForRender]
  );

  // Calculate current time in the edited timeline
  const currentTimeMs = (frame / fps) * 1000;

  // Find the current caption - use simple lookup without causing memoization issues
  const currentCaption = (() => {
    for (const caption of captions) {
      if (currentTimeMs >= caption.startMs && currentTimeMs < caption.endMs) {
        return caption;
      }
    }
    return null;
  })();

  // Pre-calculate frame positions using cumulative approach to avoid rounding drift
  const segmentFrames = useMemo(
    () => calculateSegmentFrames(renderSegments, fps),
    [renderSegments, fps]
  );

  if (renderSegments.length === 0) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#666",
          fontSize: 24,
        }}
      >
        No transcript segments to render
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Render each keep segment as a Remotion Sequence - NO zoom effects */}
      {segmentFrames.map(({ segment, startFrame, durationInFrames, videoStartFrame, videoEndFrame }, index) => (
        <Sequence
          key={`${segment.clipId}-${index}`}
          from={startFrame}
          durationInFrames={durationInFrames}
        >
          <AbsoluteFill>
            <OffthreadVideo
              src={segment.clipUrl}
              startFrom={videoStartFrame}
              endAt={videoEndFrame}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          </AbsoluteFill>
        </Sequence>
      ))}

      {/* Caption overlay - 3 words at a time */}
      {showCaptions && currentCaption && (
        <AbsoluteFill
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            paddingBottom: 120,
          }}
        >
          <div
            style={{
              color: "#fff",
              padding: "12px 24px",
              fontSize: 48,
              fontWeight: 800,
              textAlign: "center",
              maxWidth: "90%",
              textTransform: "uppercase",
              fontFamily: "Arial, Helvetica, sans-serif",
              textShadow: `-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000,
                -3px 0 0 #000, 3px 0 0 #000, 0 -3px 0 #000, 0 3px 0 #000`,
            }}
          >
            {currentCaption.text}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

export default TranscriptComposition;
