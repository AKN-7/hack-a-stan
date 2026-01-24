export const calculateFrames = (
  display: { from: number; to: number },
  fps: number
) => {
  const from = Math.max(0, (display.from / 1000) * fps);
  const toFrame = (display.to / 1000) * fps;
  // Ensure duration is always positive (at least 1 frame)
  const durationInFrames = Math.max(1, Math.ceil(toFrame - from));
  return { from, durationInFrames };
};
