import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export interface EmphasisZoomPoint {
  startMs: number;
  endMs: number;
  reason: string;
}

interface EmphasisZoomProps {
  emphasisPoints: EmphasisZoomPoint[];
  /** Max zoom amount (1.0 = no zoom, 1.15 = 15% zoom) */
  maxZoom?: number;
  children: React.ReactNode;
}

/**
 * Applies a smooth zoom effect during AI-detected emphasis moments.
 * Zooms in slowly during the emphasis, then returns to normal.
 */
export const EmphasisZoom: React.FC<EmphasisZoomProps> = ({
  emphasisPoints,
  maxZoom = 1.12, // 12% zoom for emphasis
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const currentTimeMs = (frame / fps) * 1000;

  // Find if we're in an emphasis moment and calculate zoom
  let currentZoom = 1.0;

  for (const point of emphasisPoints) {
    // Check if current time is within this emphasis window
    if (currentTimeMs >= point.startMs && currentTimeMs <= point.endMs) {
      const duration = point.endMs - point.startMs;
      const elapsed = currentTimeMs - point.startMs;
      const progress = Math.min(1, Math.max(0, elapsed / duration));

      // Asymmetric zoom: quick in (20%), hold (50%), slow out (30%)
      let zoomAmount: number;
      if (progress < 0.2) {
        // Zoom in - first 20%
        const inProgress = progress / 0.2;
        zoomAmount = easeOutCubic(inProgress);
      } else if (progress < 0.7) {
        // Hold at max - middle 50%
        zoomAmount = 1.0;
      } else {
        // Zoom out slowly - last 30%
        const outProgress = (progress - 0.7) / 0.3;
        zoomAmount = 1.0 - easeInCubic(outProgress);
      }

      currentZoom = 1.0 + (maxZoom - 1.0) * zoomAmount;
      break; // Only apply one emphasis at a time
    }
  }

  return (
    <AbsoluteFill
      style={{
        transform: `scale(${currentZoom})`,
        transformOrigin: "center center",
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

// Easing functions
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t: number): number {
  return t * t * t;
}

export default EmphasisZoom;
