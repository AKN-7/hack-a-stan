export const calculateFrames = (
  display: { from: number; to: number },
  fps: number
) => {
  // CRITICAL: Round frame values to integers - Remotion expects integer frames
  // Using floor for 'from' to not skip content, ceil for duration to not cut content
  const from = Math.max(0, Math.floor((display.from / 1000) * fps));
  const toFrame = Math.ceil((display.to / 1000) * fps);
  // Ensure duration is always positive (at least 1 frame)
  const durationInFrames = Math.max(1, toFrame - from);
  return { from, durationInFrames };
};
