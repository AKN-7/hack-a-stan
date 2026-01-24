// Generic segment interface for compatibility across different contexts
export interface SegmentTimingInfo {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface SegmentFrameData<T extends SegmentTimingInfo> {
  segment: T;
  startFrame: number;
  durationInFrames: number;
  videoStartFrame: number;
  videoEndFrame: number;
}

/**
 * Calculate frame positions for segments without accumulating rounding errors.
 *
 * Uses cumulative milliseconds converted to frames at boundaries, ensuring:
 * 1. No gaps between segments (next segment starts where previous ends)
 * 2. Total duration matches expected total (no drift)
 * 3. Each segment has at least 1 frame
 * 4. Segments overlap by 1 frame to prevent black flash at boundaries
 *
 * @param segments - Array of render segments with timing info
 * @param fps - Frames per second
 * @returns Array of segment frame data
 */
export function calculateSegmentFrames<T extends SegmentTimingInfo>(
  segments: T[],
  fps: number
): SegmentFrameData<T>[] {
  if (segments.length === 0) return [];

  const result: SegmentFrameData<T>[] = [];
  let cumulativeMs = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLastSegment = i === segments.length - 1;

    // Calculate frame boundaries from cumulative milliseconds
    // Using floor ensures frame boundaries align predictably
    const startFrame = Math.floor((cumulativeMs / 1000) * fps);
    cumulativeMs += segment.durationMs;
    const endFrame = Math.floor((cumulativeMs / 1000) * fps);

    // Duration is the difference (guaranteed no gaps/overlaps)
    // Add 1 frame overlap for non-last segments to prevent black flash at boundaries
    const baseDuration = Math.max(1, endFrame - startFrame);
    const durationInFrames = isLastSegment ? baseDuration : baseDuration + 1;

    // Video source frame positions (independent of timeline position)
    // Use floor for start to not skip content, ceil for end to not cut content
    // Add 1 frame to endAt for non-last segments so video plays through the overlap
    const videoStartFrame = Math.floor((segment.startMs / 1000) * fps);
    const baseVideoEndFrame = Math.ceil((segment.endMs / 1000) * fps);
    const videoEndFrame = isLastSegment ? baseVideoEndFrame : baseVideoEndFrame + 1;

    result.push({
      segment,
      startFrame,
      durationInFrames,
      videoStartFrame,
      videoEndFrame,
    });
  }

  return result;
}
