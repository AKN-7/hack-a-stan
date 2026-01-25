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

// Schema for text overlays (simplified from IText)
const textOverlaySchema = z.object({
  id: z.string(),
  text: z.string(),
  fromMs: z.number(),
  toMs: z.number(),
  // Position
  top: z.number().optional(),
  left: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  // Text styling
  fontFamily: z.string().optional(),
  fontSize: z.string().optional(),
  fontWeight: z.union([z.string(), z.number()]).optional(),
  color: z.string().optional(),
  textAlign: z.string().optional(),
  lineHeight: z.string().optional(),
  letterSpacing: z.string().optional(),
  textTransform: z.string().optional(),
  // Effects
  opacity: z.number().optional(),
  rotate: z.string().optional(),
  borderWidth: z.number().optional(),
  borderColor: z.string().optional(),
  boxShadow: z.object({
    x: z.number(),
    y: z.number(),
    blur: z.number(),
    color: z.string(),
  }).optional(),
});

export type TextOverlay = z.infer<typeof textOverlaySchema>;

// Schema for the TranscriptVideo composition
export const transcriptVideoSchema = z.object({
  segments: z.array(renderSegmentSchema),
  durationMs: z.number(),
  captions: z.array(captionSchema).optional(),
  textOverlays: z.array(textOverlaySchema).optional(),
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
 * Renders a single text overlay with styling
 */
const TextOverlayItem: React.FC<{ overlay: TextOverlay; fps: number }> = ({ overlay, fps }) => {
  const fromFrame = Math.floor((overlay.fromMs / 1000) * fps);
  const toFrame = Math.ceil((overlay.toMs / 1000) * fps);
  const durationInFrames = Math.max(1, toFrame - fromFrame);

  const containerStyle: React.CSSProperties = {
    position: "absolute",
    top: overlay.top ?? 0,
    left: overlay.left ?? 0,
    width: overlay.width ?? "auto",
    height: overlay.height ?? "auto",
    opacity: overlay.opacity !== undefined ? overlay.opacity / 100 : 1,
    transform: overlay.rotate ? `rotate(${overlay.rotate})` : undefined,
    pointerEvents: "none",
  };

  const textStyle: React.CSSProperties = {
    fontFamily: overlay.fontFamily ?? "Arial",
    fontSize: overlay.fontSize ?? "16px",
    fontWeight: overlay.fontWeight ?? "normal",
    color: overlay.color ?? "#FFFFFF",
    textAlign: (overlay.textAlign as React.CSSProperties["textAlign"]) ?? "left",
    lineHeight: overlay.lineHeight ?? "normal",
    letterSpacing: overlay.letterSpacing ?? "normal",
    textTransform: (overlay.textTransform as React.CSSProperties["textTransform"]) ?? "none",
    WebkitTextStroke: overlay.borderWidth ? `${overlay.borderWidth}px ${overlay.borderColor ?? "#000"}` : undefined,
    paintOrder: overlay.borderWidth ? "stroke fill" : undefined,
    textShadow: overlay.boxShadow
      ? `${overlay.boxShadow.x}px ${overlay.boxShadow.y}px ${overlay.boxShadow.blur}px ${overlay.boxShadow.color}`
      : undefined,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };

  return (
    <Sequence from={fromFrame} durationInFrames={durationInFrames}>
      <div style={containerStyle}>
        <div style={textStyle}>{overlay.text}</div>
      </div>
    </Sequence>
  );
};

/**
 * TranscriptVideo composition for Lambda rendering.
 * Renders video based on transcript keep segments.
 */
export const TranscriptVideo: React.FC<TranscriptVideoProps> = ({
  segments,
  captions = [],
  textOverlays = [],
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
                transform: "scale(1.05)", // 5% zoom to hide edge shaking on jump cuts
              }}
            />
          </AbsoluteFill>
        </Sequence>
      ))}

      {/* Text overlays */}
      {textOverlays.length > 0 && (
        <AbsoluteFill style={{ zIndex: 1 }}>
          {textOverlays.map((overlay) => (
            <TextOverlayItem key={overlay.id} overlay={overlay} fps={fps} />
          ))}
        </AbsoluteFill>
      )}

      {/* Caption overlays */}
      {captions.length > 0 && <Captions captions={captions as Caption[]} />}
    </AbsoluteFill>
  );
};

export default TranscriptVideo;
