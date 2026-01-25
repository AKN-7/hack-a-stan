import { useMemo } from "react";
import { AbsoluteFill, Sequence, OffthreadVideo, useCurrentFrame, interpolate } from "remotion";
import useTranscriptStore from "../store/use-transcript-store";
import useStore from "../store/use-store";
import useEffectsStore from "../store/use-effects-store";
import { calculateSegmentFrames } from "../utils/segment-frames";

// Transition duration in frames (at 30fps, 4 frames ≈ 133ms)
const TRANSITION_FRAMES = 4;

interface TranscriptCompositionProps {
  // Whether to show captions overlay
  showCaptions?: boolean;
}

interface SegmentWithTransitionProps {
  src: string;
  videoStartFrame: number;
  videoEndFrame: number;
  durationInFrames: number;
  baseZoom: number;
  isFirst: boolean;
  isLast: boolean;
  smoothTransitions: boolean;
}

/**
 * Renders a video segment with smooth zoom transitions at boundaries.
 * This helps mask hard cuts by adding a subtle zoom in at the start
 * and zoom out at the end of each segment.
 */
const SegmentWithTransition = ({
  src,
  videoStartFrame,
  videoEndFrame,
  durationInFrames,
  baseZoom,
  isFirst,
  isLast,
  smoothTransitions,
}: SegmentWithTransitionProps) => {
  const frame = useCurrentFrame();

  // Calculate scale with transition effect
  let scale = baseZoom;

  if (smoothTransitions && durationInFrames > TRANSITION_FRAMES * 2) {
    // Zoom in slightly at the start of segment (masks the incoming cut)
    if (!isFirst && frame < TRANSITION_FRAMES) {
      const zoomIn = interpolate(
        frame,
        [0, TRANSITION_FRAMES],
        [1.08, 1], // Start slightly zoomed in, ease out to normal
        { extrapolateRight: "clamp" }
      );
      scale *= zoomIn;
    }

    // Zoom out slightly at the end of segment (masks the outgoing cut)
    if (!isLast && frame > durationInFrames - TRANSITION_FRAMES) {
      const zoomOut = interpolate(
        frame,
        [durationInFrames - TRANSITION_FRAMES, durationInFrames],
        [1, 1.08], // Ease from normal to slightly zoomed
        { extrapolateLeft: "clamp" }
      );
      scale *= zoomOut;
    }
  }

  return (
    <AbsoluteFill>
      <OffthreadVideo
        src={src}
        startFrom={videoStartFrame}
        endAt={videoEndFrame}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * TranscriptComposition renders video based on transcript keep segments.
 * This is the core of transcript-driven editing - the video plays only
 * the parts where speech exists, automatically cutting silence and
 * deleted words.
 */
const TranscriptComposition = ({ showCaptions = false }: TranscriptCompositionProps) => {
  const { fps, size } = useStore();
  const { getRenderSegments, getCaptionsForRender } = useTranscriptStore();
  const { segmentZoom } = useEffectsStore();
  const frame = useCurrentFrame();

  const renderSegments = getRenderSegments();
  const captions = getCaptionsForRender();

  // Check if smooth transitions are enabled
  const smoothTransitions = segmentZoom?.enabled ?? true;

  // Calculate current time in the edited timeline
  const currentTimeMs = (frame / fps) * 1000;

  // Find the current caption (3 words at a time)
  const currentCaption = useMemo(() => {
    for (const caption of captions) {
      if (currentTimeMs >= caption.startMs && currentTimeMs < caption.endMs) {
        return caption;
      }
    }
    return null;
  }, [captions, currentTimeMs]);

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
      {/* Render each keep segment as a Remotion Sequence with smooth transitions */}
      {segmentFrames.map(({ segment, startFrame, durationInFrames, videoStartFrame, videoEndFrame }, index) => {
        // Calculate zoom for this segment
        const isEvenSegment = index % 2 === 0;
        const baseZoom = segmentZoom?.enabled
          ? (isEvenSegment ? segmentZoom.amount : 1 / segmentZoom.amount)
          : 1;

        return (
          <Sequence
            key={`${segment.clipId}-${index}`}
            from={startFrame}
            durationInFrames={durationInFrames}
          >
            <SegmentWithTransition
              src={segment.clipUrl}
              videoStartFrame={videoStartFrame}
              videoEndFrame={videoEndFrame}
              durationInFrames={durationInFrames}
              baseZoom={baseZoom}
              isFirst={index === 0}
              isLast={index === segmentFrames.length - 1}
              smoothTransitions={smoothTransitions}
            />
          </Sequence>
        );
      })}

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
