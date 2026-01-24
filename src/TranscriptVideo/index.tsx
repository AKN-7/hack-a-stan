import { useMemo } from "react";
import { z } from "zod";
import {
  AbsoluteFill,
  CalculateMetadataFunction,
  OffthreadVideo,
  Sequence,
  useVideoConfig,
} from "remotion";
import { calculateSegmentFrames } from "../features/editor/utils/segment-frames";
import { Captions, Caption } from "./Captions";

// Schema for render segments
const renderSegmentSchema = z.object({
  clipId: z.string(),
  clipUrl: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  durationMs: z.number(),
  offsetMs: z.number(),
});

// Schema for captions
const captionSchema = z.object({
  text: z.string(),
  startMs: z.number(),
  endMs: z.number(),
});

// Schema for the TranscriptVideo composition
export const transcriptVideoSchema = z.object({
  segments: z.array(renderSegmentSchema),
  durationMs: z.number(),
  captions: z.array(captionSchema).optional(),
});

export type TranscriptVideoProps = z.infer<typeof transcriptVideoSchema>;

// Calculate metadata based on segments
export const calculateTranscriptVideoMetadata: CalculateMetadataFunction<
  TranscriptVideoProps
> = async ({ props }) => {
  const fps = 30;
  const durationInFrames = Math.ceil((props.durationMs / 1000) * fps);

  return {
    fps,
    durationInFrames: Math.max(1, durationInFrames),
  };
};

/**
 * TranscriptVideo composition for Lambda rendering.
 * Renders video based on transcript keep segments.
 */
export const TranscriptVideo: React.FC<TranscriptVideoProps> = ({
  segments,
  captions = [],
}) => {
  const { fps } = useVideoConfig();

  if (!segments || segments.length === 0) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 32,
        }}
      >
        No segments to render
      </AbsoluteFill>
    );
  }

  // Pre-calculate frame positions using cumulative approach to avoid rounding drift
  const segmentFrames = useMemo(
    () => calculateSegmentFrames(segments, fps),
    [segments, fps]
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Video segments */}
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

      {/* Caption overlays */}
      {captions.length > 0 && <Captions captions={captions as Caption[]} />}
    </AbsoluteFill>
  );
};

export default TranscriptVideo;
