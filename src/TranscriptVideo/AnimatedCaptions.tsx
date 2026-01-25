import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export interface WordCaption {
  text: string;
  startMs: number;
  endMs: number;
}

export interface EmphasisPoint {
  startMs: number;
  endMs: number;
}

interface AnimatedCaptionsProps {
  words: WordCaption[];
  /** Number of words to show at once (default: 3) */
  windowSize?: number;
  /** Animation style */
  style?: "pop" | "slide" | "fade";
  /** Color scheme */
  activeColor?: string;
  inactiveColor?: string;
  /** Emphasis points for combo effects (extra pop on key moments) */
  emphasisPoints?: EmphasisPoint[];
}

/**
 * Clean, TikTok-style animated captions.
 * Shows chunks of N words, highlights each word in sequence, then moves to next chunk.
 */
export const AnimatedCaptions: React.FC<AnimatedCaptionsProps> = ({
  words,
  windowSize = 3,
  style = "pop",
  activeColor = "#FFFF00",  // Yellow for active word
  inactiveColor = "#FFFFFF", // White for other words
  emphasisPoints = [],
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!words || words.length === 0) {
    return null;
  }

  const currentTimeMs = (frame / fps) * 1000;

  // Find the current word index based on time
  let currentWordIndex = -1;
  for (let i = 0; i < words.length; i++) {
    if (currentTimeMs >= words[i].startMs && currentTimeMs < words[i].endMs) {
      currentWordIndex = i;
      break;
    }
    // If we're past this word but before the next, still show it
    if (currentTimeMs >= words[i].startMs && (i === words.length - 1 || currentTimeMs < words[i + 1].startMs)) {
      currentWordIndex = i;
      break;
    }
  }

  if (currentWordIndex === -1) {
    return null;
  }

  // Calculate which chunk we're in (groups of windowSize words)
  const chunkIndex = Math.floor(currentWordIndex / windowSize);
  const chunkStart = chunkIndex * windowSize;
  const chunkEnd = Math.min(words.length, chunkStart + windowSize);

  // Get the words in this chunk
  const chunkWords = words.slice(chunkStart, chunkEnd);

  // Which word within the chunk is currently active
  const activeIndexInChunk = currentWordIndex - chunkStart;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          bottom: "8%",
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "0 40px",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        {chunkWords.map((word, idx) => {
          const isCurrent = idx === activeIndexInChunk;
          const wordStartFrame = Math.floor((word.startMs / 1000) * fps);
          const framesSinceStart = frame - wordStartFrame;
          // For words not yet spoken in this chunk, they should appear but not animate
          const hasAppeared = currentTimeMs >= word.startMs;

          // Check if this word is during an emphasis moment (combo effect)
          const isEmphasis = emphasisPoints.some(
            (ep) => word.startMs >= ep.startMs && word.startMs <= ep.endMs
          );

          return (
            <AnimatedWord
              key={`${word.text}-${word.startMs}`}
              text={word.text}
              isCurrent={isCurrent}
              framesSinceStart={hasAppeared ? framesSinceStart : 0}
              fps={fps}
              animationStyle={style}
              activeColor={activeColor}
              inactiveColor={inactiveColor}
              hasAppeared={hasAppeared}
              isEmphasis={isEmphasis && isCurrent}
            />
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

interface AnimatedWordProps {
  text: string;
  isCurrent: boolean;
  framesSinceStart: number;
  fps: number;
  animationStyle: "pop" | "slide" | "fade";
  activeColor: string;
  inactiveColor: string;
  hasAppeared: boolean;
  isEmphasis?: boolean; // Extra pop for emphasis moments (combo effect)
}

const AnimatedWord: React.FC<AnimatedWordProps> = ({
  text,
  isCurrent,
  framesSinceStart,
  fps,
  animationStyle,
  activeColor,
  inactiveColor,
  hasAppeared,
  isEmphasis = false,
}) => {
  // Subtle pop animation on entrance (scale 0.85 -> 1.0)
  const entranceProgress = hasAppeared
    ? spring({
        fps,
        frame: framesSinceStart,
        config: {
          damping: 15,
          stiffness: 150,
          mass: 0.8,
        },
        durationInFrames: 10,
      })
    : 0;

  // Subtle scale animation on entrance only
  // Emphasis moments get extra scale boost (1.15x instead of 1.0x)
  const baseScale = animationStyle === "pop" && hasAppeared
    ? interpolate(entranceProgress, [0, 1], [0.85, 1], { extrapolateRight: "clamp" })
    : 1;
  const scale = isEmphasis ? baseScale * 1.15 : baseScale;

  // Y offset for slide animation
  const translateY = animationStyle === "slide" && hasAppeared
    ? interpolate(entranceProgress, [0, 1], [15, 0], { extrapolateRight: "clamp" })
    : 0;

  // Color logic:
  // - Emphasis word: special glow color (cyan/electric)
  // - Current word (being spoken): activeColor (yellow)
  // - Already spoken: inactiveColor (white)
  // - Not yet spoken: dimmed gray
  let textColor: string;
  let opacity: number;

  if (isEmphasis) {
    // Emphasis moments get electric cyan color
    textColor = "#00FFFF";
    opacity = 1;
  } else if (isCurrent) {
    textColor = activeColor;
    opacity = 1;
  } else if (hasAppeared) {
    textColor = inactiveColor;
    opacity = 1;
  } else {
    // Not yet spoken - show dimmed
    textColor = inactiveColor;
    opacity = 0.4;
  }

  // Text stroke for readability (black outline)
  // Emphasis words get extra glow effect
  const textShadow = isEmphasis
    ? [
        "-2px -2px 0 #000",
        "2px -2px 0 #000",
        "-2px 2px 0 #000",
        "2px 2px 0 #000",
        "0 0 20px rgba(0,255,255,0.8)", // Cyan glow
        "0 0 40px rgba(0,255,255,0.5)", // Outer glow
      ].join(", ")
    : [
        "-2px -2px 0 #000",
        "2px -2px 0 #000",
        "-2px 2px 0 #000",
        "2px 2px 0 #000",
        "0 0 10px rgba(0,0,0,0.8)",
      ].join(", ");

  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 68,
        fontWeight: 900,
        color: textColor,
        textTransform: "uppercase",
        textShadow,
        transform: `scale(${scale}) translateY(${translateY}px)`,
        opacity,
      }}
    >
      {text}
    </span>
  );
};

export default AnimatedCaptions;
