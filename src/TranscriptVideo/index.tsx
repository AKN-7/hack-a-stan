import { useMemo } from "react";
import { z } from "zod";
import {
  AbsoluteFill,
  Audio,
  CalculateMetadataFunction,
  OffthreadVideo,
  Sequence,
  useVideoConfig,
} from "remotion";
import { calculateSegmentFrames } from "../features/editor/utils/segment-frames";
import { Captions, Caption } from "./Captions";
import { AnimatedCaptions, WordCaption } from "./AnimatedCaptions";
import { EmphasisZoom, EmphasisZoomPoint } from "./EmphasisZoom";
import { TransitionSeries, linearTiming, fade, slide, wipe } from "../features/editor/player/transitions";

// Schema for render segments
const renderSegmentSchema = z.object({
  clipId: z.string(),
  clipUrl: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  durationMs: z.number(),
  offsetMs: z.number(),
  clipType: z.enum(["video_with_audio", "audio_only", "video_only", "background_music"]).optional(),
  volume: z.number().optional(),
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

// Schema for transition settings
const transitionSettingsSchema = z.object({
  enabled: z.boolean(),
  type: z.enum(["fade", "crossfade", "slide", "none"]),
  durationMs: z.number(),
});

// Schema for caption settings
const captionSettingsSchema = z.object({
  style: z.enum(["animated", "static", "none"]).default("animated"),
  animationType: z.enum(["pop", "slide", "fade"]).default("pop"),
  windowSize: z.number().default(4),
});

// Schema for emphasis zoom points (AI-detected important moments)
const emphasisPointSchema = z.object({
  startMs: z.number(),
  endMs: z.number(),
  reason: z.string(),
});

// Schema for background music clips
const backgroundMusicSchema = z.object({
  clipId: z.string(),
  url: z.string(),
  volume: z.number().optional(),
  durationMs: z.number().optional(),
  trim: z.object({
    startMs: z.number(),
    endMs: z.number(),
  }).optional(),
});

// Schema for B-roll assignments
const brollAssignmentSchema = z.object({
  clipId: z.string(),
  clipUrl: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  durationMs: z.number(),
  timelineStartMs: z.number(),
  timelineEndMs: z.number(),
});

// Schema for audio segments (for audio+broll mode)
const audioSegmentSchema = z.object({
  clipId: z.string(),
  clipUrl: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  durationMs: z.number(),
  offsetMs: z.number(),
  volume: z.number().optional(),
});

// Schema for per-clip transitions
const clipTransitionSchema = z.object({
  fromClipId: z.string(),
  toClipId: z.string(),
  type: z.enum(["fade", "slide", "wipe", "flip", "clockWipe", "circle", "star", "rectangle", "none"]),
  durationMs: z.number(),
  direction: z.string().optional(),
});

// Schema for the TranscriptVideo composition
export const transcriptVideoSchema = z.object({
  segments: z.array(renderSegmentSchema),
  durationMs: z.number(),
  captions: z.array(captionSchema).optional(),
  textOverlays: z.array(textOverlaySchema).optional(),
  transitionSettings: transitionSettingsSchema.optional(),
  captionSettings: captionSettingsSchema.optional(),
  emphasisPoints: z.array(emphasisPointSchema).optional(),
  textHook: z.string().optional(),
  // New props for full export support
  backgroundMusicClips: z.array(backgroundMusicSchema).optional(),
  brollAssignments: z.array(brollAssignmentSchema).optional(),
  audioSegments: z.array(audioSegmentSchema).optional(),
  clipTransitions: z.array(clipTransitionSchema).optional(),
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
    minWidth: (overlay as any).minWidth,
    height: overlay.height ?? "auto",
    opacity: overlay.opacity !== undefined ? overlay.opacity / 100 : 1,
    transform: [
      overlay.rotate ? `rotate(${overlay.rotate})` : null,
      (overlay as any).transform,
    ].filter(Boolean).join(" ") || undefined,
    pointerEvents: "none",
    // Background styling for text boxes
    backgroundColor: (overlay as any).backgroundColor,
    borderRadius: (overlay as any).borderRadius,
    paddingTop: (overlay as any).paddingTop,
    paddingBottom: (overlay as any).paddingBottom,
    paddingLeft: (overlay as any).paddingLeft,
    paddingRight: (overlay as any).paddingRight,
    boxShadow: overlay.boxShadow
      ? `${overlay.boxShadow.x}px ${overlay.boxShadow.y}px ${overlay.boxShadow.blur}px ${overlay.boxShadow.color}`
      : undefined,
  };

  const textStyle: React.CSSProperties = {
    fontFamily: overlay.fontFamily ?? "Arial",
    fontSize: overlay.fontSize ?? "16px",
    fontWeight: overlay.fontWeight ?? "normal",
    color: overlay.color ?? "#FFFFFF",
    textAlign: (overlay.textAlign as React.CSSProperties["textAlign"]) ?? "center",
    lineHeight: overlay.lineHeight ?? "normal",
    letterSpacing: overlay.letterSpacing ?? "normal",
    textTransform: (overlay.textTransform as React.CSSProperties["textTransform"]) ?? "none",
    WebkitTextStroke: overlay.borderWidth ? `${overlay.borderWidth}px ${overlay.borderColor ?? "#000"}` : undefined,
    paintOrder: overlay.borderWidth ? "stroke fill" : undefined,
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
 * Renders the text hook overlay at the top of the video
 */
const TextHookOverlay: React.FC<{ text: string; fps: number }> = ({ text, fps }) => {
  const { width, height } = useVideoConfig();
  const durationInFrames = Math.ceil((4000 / 1000) * fps);

  return (
    <Sequence from={0} durationInFrames={durationInFrames}>
      <AbsoluteFill style={{ pointerEvents: "none", zIndex: 10 }}>
        <div
          style={{
            position: "absolute",
            top: height * 0.05,
            left: "50%",
            transform: "translateX(-50%)",
            width: width * 0.7,
            backgroundColor: "#ffffff",
            borderRadius: 16,
            paddingTop: 32,
            paddingBottom: 32,
            paddingLeft: 24,
            paddingRight: 24,
            boxShadow: "0px 4px 12px rgba(0,0,0,0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 64,
              fontWeight: 900,
              color: "#000000",
              textAlign: "center",
              lineHeight: 1.2,
            }}
          >
            {text}
          </span>
        </div>
      </AbsoluteFill>
    </Sequence>
  );
};

/**
 * TranscriptVideo composition for Lambda rendering.
 * Renders video based on transcript keep segments.
 */
export const TranscriptVideo: React.FC<TranscriptVideoProps> = ({
  segments,
  durationMs,
  captions = [],
  textOverlays = [],
  transitionSettings,
  captionSettings,
  emphasisPoints = [],
  textHook,
  backgroundMusicClips = [],
  brollAssignments = [],
  audioSegments = [],
  clipTransitions = [],
}) => {
  const { fps } = useVideoConfig();

  // Calculate total duration frames for background music
  const totalDurationFrames = Math.ceil((durationMs / 1000) * fps);

  // Check if we're in audio+broll mode
  const isAudioBrollMode = brollAssignments.length > 0 && audioSegments.length > 0;

  // Helper to get transition presentation based on type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getTransitionPresentation = (type: string, direction?: string): any => {
    switch (type) {
      case "slide":
        return slide({ direction: (direction as any) || "from-left" });
      case "wipe":
        return wipe({ direction: (direction as any) || "from-left" });
      case "fade":
      default:
        return fade();
    }
  };

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

  // Calculate transition frames
  const transitionFrames = useMemo(() => {
    if (!transitionSettings?.enabled || transitionSettings.type === "none") return 0;
    return Math.round((transitionSettings.durationMs / 1000) * fps);
  }, [transitionSettings, fps]);

  // Video content (may be wrapped with emphasis zoom)
  const videoContent = (
    <>
      {transitionFrames > 0 && segmentFrames.length > 1 ? (
        <TransitionSeries>
          {segmentFrames.flatMap(({ segment, durationInFrames, videoStartFrame, videoEndFrame }, index) => {
            // Check if this is an audio_only segment - render as Audio, not Video
            const isAudioOnly = segment.clipType === "audio_only";

            const elements: React.ReactNode[] = [
              <TransitionSeries.Sequence
                key={`seq-${segment.clipId}-${index}`}
                durationInFrames={durationInFrames}
              >
                {isAudioOnly ? (
                  // Audio-only clip: render just the audio (black screen)
                  <AbsoluteFill style={{ backgroundColor: "#000" }}>
                    <Audio
                      src={segment.clipUrl}
                      startFrom={videoStartFrame}
                      endAt={videoEndFrame}
                      volume={segment.volume ?? 1}
                    />
                  </AbsoluteFill>
                ) : (
                  // Video with audio: render as normal video
                  <AbsoluteFill>
                    <OffthreadVideo
                      src={segment.clipUrl}
                      startFrom={videoStartFrame}
                      endAt={videoEndFrame}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        transform: "scale(1.05)",
                      }}
                    />
                  </AbsoluteFill>
                )}
              </TransitionSeries.Sequence>
            ];

            // Add transition after each segment except the last
            if (index < segmentFrames.length - 1) {
              // Check for per-clip transition
              const nextSegment = segmentFrames[index + 1]?.segment;
              const perClipTransition = nextSegment
                ? clipTransitions.find(t => t.fromClipId === segment.clipId && t.toClipId === nextSegment.clipId)
                : null;

              // Use per-clip transition if available, otherwise use global transition settings
              const effectiveTransitionFrames = perClipTransition
                ? Math.round((perClipTransition.durationMs / 1000) * fps)
                : transitionFrames;
              const transitionType = perClipTransition?.type || transitionSettings?.type || "fade";
              const transitionDirection = perClipTransition?.direction;

              elements.push(
                <TransitionSeries.Transition
                  key={`trans-${index}`}
                  presentation={getTransitionPresentation(transitionType, transitionDirection)}
                  timing={linearTiming({ durationInFrames: effectiveTransitionFrames })}
                />
              );
            }

            return elements;
          })}
        </TransitionSeries>
      ) : (
        // Standard rendering without transitions
        segmentFrames.map(({ segment, startFrame, durationInFrames, videoStartFrame, videoEndFrame }, index) => {
          // Check if this is an audio_only segment
          const isAudioOnly = segment.clipType === "audio_only";

          return (
            <Sequence
              key={`${segment.clipId}-${index}`}
              from={startFrame}
              durationInFrames={durationInFrames}
            >
              {isAudioOnly ? (
                // Audio-only clip: render just the audio (black screen)
                <AbsoluteFill style={{ backgroundColor: "#000" }}>
                  <Audio
                    src={segment.clipUrl}
                    startFrom={videoStartFrame}
                    endAt={videoEndFrame}
                    volume={segment.volume ?? 1}
                  />
                </AbsoluteFill>
              ) : (
                // Video with audio: render as normal video
                <AbsoluteFill>
                  <OffthreadVideo
                    src={segment.clipUrl}
                    startFrom={videoStartFrame}
                    endAt={videoEndFrame}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      transform: "scale(1.05)",
                    }}
                  />
                </AbsoluteFill>
              )}
            </Sequence>
          );
        })
      )}
    </>
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Video segments with optional emphasis zoom */}
      {emphasisPoints.length > 0 ? (
        <EmphasisZoom emphasisPoints={emphasisPoints as EmphasisZoomPoint[]}>
          {videoContent}
        </EmphasisZoom>
      ) : (
        videoContent
      )}

      {/* Text overlays */}
      {textOverlays.length > 0 && (
        <AbsoluteFill style={{ zIndex: 1 }}>
          {textOverlays.map((overlay) => (
            <TextOverlayItem key={overlay.id} overlay={overlay} fps={fps} />
          ))}
        </AbsoluteFill>
      )}

      {/* Caption overlays - animated by default */}
      {captions.length > 0 && (
        captionSettings?.style === "static" ? (
          <Captions captions={captions as Caption[]} />
        ) : captionSettings?.style === "none" ? null : (
          <AnimatedCaptions
            words={captions as WordCaption[]}
            windowSize={captionSettings?.windowSize ?? 4}
            style={captionSettings?.animationType ?? "pop"}
          />
        )
      )}

      {/* Text hook rendered directly */}
      {textHook && (
        <TextHookOverlay text={textHook} fps={fps} />
      )}

      {/* Background music - plays for duration of video */}
      {backgroundMusicClips.length > 0 && backgroundMusicClips.map((music, index) => {
        const musicDurationMs = music.durationMs || durationMs;
        const trimStart = music.trim?.startMs ?? 0;
        const trimEnd = music.trim?.endMs ?? musicDurationMs;
        const trimmedDurationMs = trimEnd - trimStart;

        // Music plays for its trimmed duration or until video ends
        const effectiveDurationMs = Math.min(trimmedDurationMs, durationMs);
        const musicDurationInFrames = Math.ceil((effectiveDurationMs / 1000) * fps);

        // Audio start/end within the source file
        const audioStartFrame = Math.floor((trimStart / 1000) * fps);
        const audioEndFrame = Math.floor((trimEnd / 1000) * fps);

        return (
          <Sequence
            key={`music-${music.clipId}-${index}`}
            from={0}
            durationInFrames={musicDurationInFrames}
          >
            <Audio
              src={music.url}
              startFrom={audioStartFrame}
              endAt={audioEndFrame}
              volume={music.volume ?? 0.12}
            />
          </Sequence>
        );
      })}

      {/* B-roll video rendering for audio+broll mode */}
      {isAudioBrollMode && brollAssignments.map((assignment, index) => {
        const startFrame = Math.floor((assignment.timelineStartMs / 1000) * fps);
        const brollDurationInFrames = Math.ceil((assignment.durationMs / 1000) * fps);
        const videoStartFrame = Math.floor((assignment.startMs / 1000) * fps);
        const videoEndFrame = Math.floor((assignment.endMs / 1000) * fps);

        return (
          <Sequence
            key={`broll-${assignment.clipId}-${index}`}
            from={startFrame}
            durationInFrames={brollDurationInFrames}
          >
            <AbsoluteFill style={{ overflow: "hidden" }}>
              <OffthreadVideo
                src={assignment.clipUrl}
                startFrom={videoStartFrame}
                endAt={videoEndFrame}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  transform: "scale(1.05)",
                }}
                muted
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}

      {/* Audio track for audio+broll mode */}
      {isAudioBrollMode && audioSegments.map((segment, index) => {
        const startFrame = Math.floor((segment.offsetMs / 1000) * fps);
        const audioDurationInFrames = Math.ceil((segment.durationMs / 1000) * fps);
        const audioStartFrame = Math.floor((segment.startMs / 1000) * fps);
        const audioEndFrame = Math.floor((segment.endMs / 1000) * fps);

        return (
          <Sequence
            key={`audio-${segment.clipId}-${index}`}
            from={startFrame}
            durationInFrames={audioDurationInFrames}
          >
            <Audio
              src={segment.clipUrl}
              startFrom={audioStartFrame}
              endAt={audioEndFrame}
              volume={segment.volume ?? 1}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export default TranscriptVideo;
